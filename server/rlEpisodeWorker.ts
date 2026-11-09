// server/rlEpisodeWorker.ts — one isolated BeeTree replay episode.
//
// The orchestrator supplies two DB copies:
//   BEETREE_DB           pruned at task.cutoff; the agent and tools see this one
//   BEETREE_RL_LABEL_DB  pruned at task.labelEnd; only the scorer reads this one
//
// Date.now()/new Date() are pinned to the cutoff before any BeeTree module is
// imported, so schedule/season tools do not accidentally answer in real time.

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  gradeClaimsForTask, nullPolicy, rulesPolicy, scoreEpisode,
  type RlAction, type RlEpisodeResult, type RlTask, type RlToolCall,
} from './rlGym.js';
import type { BeetreeDb } from './db.js';
import type { AdviceClaim } from './adviceClaims.js';

const WALL_DATE = Date;

const ALLOWED_TOOLS = new Set([
  'get_hives', 'get_sensors', 'get_tasks', 'get_inspection_schedule',
  'get_swarm_risk', 'get_outlier_report', 'get_health_trends',
  'get_treatment_recs', 'get_forage_forecast', 'get_queen_status',
  'get_inspections', 'get_weight_trends', 'get_feeding_status',
  'get_syrup_recommendation', 'get_inference_calibration',
  'create_task', 'record_advice_claim', 'get_advice_accuracy',
  'onto_current_season', 'onto_list_threats', 'onto_lookup_pest',
  'onto_lookup_species_detail', 'onto_get_graph', 'onto_current_state',
]);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function freezeClock(cutoff: string): void {
  const RealDate = Date;
  const fixed = RealDate.parse(cutoff);
  function ReplayDate(this: unknown, ...args: any[]): Date {
    if (args.length === 0) return new RealDate(fixed);
    return Reflect.construct(RealDate, args) as Date;
  }
  ReplayDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(ReplayDate, RealDate);
  ReplayDate.now = () => fixed;
  // The replay worker deliberately replaces the process-global clock.
  globalThis.Date = ReplayDate as unknown as DateConstructor;
}

function extractJson(content: string): any {
  const cleaned = content.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* find an embedded object below */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model did not return a JSON action');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function parseAction(content: string): RlAction {
  const parsed = extractJson(content);
  const decision = parsed?.decision;
  const urgency = parsed?.urgency ?? 'routine';
  if (!['inspect', 'wait', 'ask'].includes(decision)) {
    throw new Error(`invalid decision: ${String(decision)}`);
  }
  if (!['routine', 'soon', 'urgent'].includes(urgency)) {
    throw new Error(`invalid urgency: ${String(urgency)}`);
  }
  return {
    decision,
    urgency,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    // Claims are read from record_advice_claim in the acting DB, not trusted
    // from final text. A model that only writes claims in prose gets no credit.
    claims: [],
  };
}

async function callModel(
  url: string,
  key: string,
  model: string,
  messages: any[],
  tools: any[],
): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, tools, stream: false, temperature: 0.2 }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`model HTTP ${response.status}: ${text.slice(0, 300)}`);
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`model returned non-JSON HTTP 200: ${text.slice(0, 200)}`); }
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error(`model returned no choices: ${text.slice(0, 300)}`);
  return message;
}

async function main(): Promise<void> {
  const task = JSON.parse(readFileSync(requiredEnv('BEETREE_RL_TASK_PATH'), 'utf8')) as RlTask;
  const policy = process.env.BEETREE_RL_POLICY ?? 'rules';
  const resultPath = requiredEnv('BEETREE_RL_RESULT_PATH');
  const startedAt = new WALL_DATE().toISOString();

  freezeClock(task.cutoff);

  // These imports must follow freezeClock and the orchestrator's BEETREE_DB.
  const { db } = await import('./db.js');
  const { listClaims } = await import('./adviceClaims.js');
  const { buzzToolSchemas, dispatchBuzzTool } = await import('./buzzTools.js');
  const beforeClaimIds = new Set(listClaims({ limit: 200 }).map(c => c.id));
  const toolCalls: RlToolCall[] = [];

  const dispatch = async (name: string, args: Record<string, any>): Promise<string> => {
    const allowed = ALLOWED_TOOLS.has(name);
    let result: string;
    if (!allowed) {
      result = JSON.stringify({ error: `tool ${name} is not available in this replay` });
    } else {
      result = await dispatchBuzzTool(name, args);
    }
    let parsed: any = null;
    try { parsed = JSON.parse(result); } catch { /* plain-text tool result */ }
    const error = !allowed || (parsed && typeof parsed === 'object' && typeof parsed.error === 'string');
    toolCalls.push({ name, args, result: result.slice(0, 4000), error, allowed });
    return result;
  };

  let action: RlAction;
  let modelName: string | null = null;
  if (policy === 'null') {
    action = nullPolicy(task);
  } else if (policy === 'rules') {
    action = rulesPolicy(task);
    for (const claim of action.claims) await dispatch('record_advice_claim', { ...claim });
  } else if (policy === 'model') {
    modelName = process.env.BEETREE_RL_MODEL ?? process.env.HERMES_MODEL ?? 'deepseek-v4.1-flash';
    const url = process.env.HERMES_API_URL ?? 'http://127.0.0.1:8642/v1/chat/completions';
    const key = process.env.HERMES_API_KEY ?? 'dev-hermes-api-key-replace-me';
    const tools = (buzzToolSchemas as any[]).filter(s => ALLOWED_TOOLS.has(s.function.name));
    const system = `You are Buzz, BeeTree's beekeeping advisor, inside a historical replay evaluation.
The current time is ${task.cutoff}. The acting database contains no records after that time.
Use the available BeeTree tools when they would improve the decision. Live weather is deliberately unavailable because it cannot be replayed from this snapshot.
If you give predictive advice, call record_advice_claim before your final response. Use a windowEnd no later than ${task.labelEnd}; this task has a ${task.horizonDays}-day outcome horizon. Do not record claims for a quiet no-action decision.
Your final response must be ONLY one JSON object:
{"decision":"inspect"|"wait"|"ask","urgency":"routine"|"soon"|"urgent","summary":"one or two sentences for the beekeeper"}
Do not put claims in the JSON; the replay scorer reads them from the tool ledger.`;
    const user = `${task.prompt}\n\nSnapshot context (all timestamps are at or before the cutoff):\n${JSON.stringify(task.context)}`;
    const messages: any[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    let finalContent = '';
    for (let round = 0; round < 5; round++) {
      const message = await callModel(url, key, modelName, messages, tools);
      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });
        for (const call of message.tool_calls) {
          let args: Record<string, any> = {};
          let parseError: string | null = null;
          try { args = JSON.parse(call.function.arguments || '{}'); }
          catch { parseError = 'invalid tool argument JSON'; }
          const result = parseError
            ? JSON.stringify({ error: parseError })
            : await dispatch(call.function.name, args);
          if (parseError) {
            toolCalls.push({ name: call.function.name, args: {}, result, error: true, allowed: ALLOWED_TOOLS.has(call.function.name) });
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
        continue;
      }
      finalContent = message.content ?? '';
      break;
    }
    if (!finalContent) throw new Error('model exhausted five tool rounds without a final action');
    action = parseAction(finalContent);
  } else {
    throw new Error(`unknown policy: ${policy}`);
  }

  const recorded = listClaims({ limit: 200 }).filter(c => !beforeClaimIds.has(c.id));
  const labelRaw = new Database(requiredEnv('BEETREE_RL_LABEL_DB'), { readonly: true, fileMustExist: true });
  let claimGrades;
  try {
    claimGrades = await gradeClaimsForTask(task, recorded as AdviceClaim[], labelRaw as unknown as BeetreeDb);
  } finally {
    labelRaw.close();
  }
  const score = scoreEpisode(task, action, toolCalls, claimGrades);
  const finishedAt = new WALL_DATE().toISOString();
  const result: RlEpisodeResult = {
    taskId: task.id,
    policy,
    model: modelName,
    action,
    toolCalls,
    claims: claimGrades,
    score,
    startedAt,
    finishedAt,
  };
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ taskId: task.id, policy, reward: score.total, flags: score.flags, claims: claimGrades.length }));
  db.close();
}

main().catch(error => {
  const resultPath = process.env.BEETREE_RL_RESULT_PATH;
  const taskPath = process.env.BEETREE_RL_TASK_PATH;
  if (resultPath) {
    let taskId = 'unknown';
    try { if (taskPath) taskId = (JSON.parse(readFileSync(taskPath, 'utf8')) as RlTask).id; } catch { /* retain unknown */ }
    writeFileSync(resultPath, JSON.stringify({
      taskId,
      policy: process.env.BEETREE_RL_POLICY ?? 'unknown',
      error: error instanceof Error ? error.message : String(error),
    }, null, 2) + '\n');
  }
  console.error('[rlEpisode] failed:', error);
  process.exit(1);
});
