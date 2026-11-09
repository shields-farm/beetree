// server/adviceCoverage.ts — measure whether predictive advice is entering the
// outcome ledger. This is a coverage heuristic, not a claim that every matched
// sentence required a prediction.

import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BeetreeDb } from './db.js';

// Intentionally broad: the report is a review queue, and its denominator is
// labeled heuristic rather than "advice" to avoid false precision.
const PREDICTIVE_OR_ACTIONABLE = /\b(inspect|inspection|check|recommend|should|needs?|overdue|urgent|risk|likely|expect|predict|will|watch|replace|feed|feeding|treat|treatment|ventilat\w*|super|queenless|swarm)\b/i;

interface ChatMessageRow {
  id: string;
  role: string;
  content: string;
  tool_calls_json: string | null;
  lane: string;
  created_at: string;
}

export interface AdviceCoverageReport {
  generatedAt: string;
  messages: {
    assistant: number;
    actionableOrPredictive: number;
    withRecordedClaimTool: number;
    coverageRate: number | null;
    heuristic: string;
  };
  claims: {
    total: number;
    open: number;
    graded: number;
    void: number;
    linkedToChatMessage: number;
    grades: Record<string, number>;
  };
  recentGaps: { id: string; createdAt: string; lane: string; excerpt: string }[];
  note: string;
}

function hasRecordedClaim(toolJson: string | null): boolean {
  if (!toolJson) return false;
  try {
    const calls = JSON.parse(toolJson);
    if (!Array.isArray(calls)) return false;
    return calls.some(call => {
      const name = call?.name ?? call?.function?.name;
      if (name !== 'record_advice_claim') return false;
      const result = call?.result;
      // Old log shapes may not carry a result. The call still proves the model
      // attempted the ledger write; failed validation remains visible in the
      // tool result when that field exists.
      if (typeof result !== 'string') return true;
      try {
        const parsed = JSON.parse(result);
        return parsed?.ok === true || typeof parsed?.claimId === 'string';
      } catch {
        return !result.includes('"error"');
      }
    });
  } catch {
    return false;
  }
}

export function adviceCoverage(database: BeetreeDb, nowIso = new Date().toISOString()): AdviceCoverageReport {
  const messages = database.prepare(
    `SELECT id, role, content, tool_calls_json, lane, created_at
       FROM chat_messages WHERE role = 'assistant' ORDER BY created_at DESC`,
  ).all() as ChatMessageRow[];
  const actionable = messages.filter(m => PREDICTIVE_OR_ACTIONABLE.test(m.content));
  const withClaim = actionable.filter(m => hasRecordedClaim(m.tool_calls_json));
  const claimRows = database.prepare(
    'SELECT status, grade, chatMessageId FROM advice_claims',
  ).all() as { status: string; grade: string | null; chatMessageId: string | null }[];
  const grades: Record<string, number> = {};
  for (const row of claimRows) {
    if (row.grade) grades[row.grade] = (grades[row.grade] ?? 0) + 1;
  }

  return {
    generatedAt: nowIso,
    messages: {
      assistant: messages.length,
      actionableOrPredictive: actionable.length,
      withRecordedClaimTool: withClaim.length,
      coverageRate: actionable.length > 0
        ? Math.round((withClaim.length / actionable.length) * 1000) / 1000
        : null,
      heuristic: 'Keyword review queue over assistant messages; a match does not prove a claim was required.',
    },
    claims: {
      total: claimRows.length,
      open: claimRows.filter(c => c.status === 'open').length,
      graded: claimRows.filter(c => c.status === 'graded').length,
      void: claimRows.filter(c => c.status === 'void').length,
      linkedToChatMessage: claimRows.filter(c => c.chatMessageId != null).length,
      grades,
    },
    recentGaps: actionable.filter(m => !hasRecordedClaim(m.tool_calls_json)).slice(0, 10).map(m => ({
      id: m.id,
      createdAt: m.created_at,
      lane: m.lane,
      excerpt: m.content.replace(/\s+/g, ' ').slice(0, 220),
    })),
    note: claimRows.length === 0
      ? 'No advice claims have been recorded. Outcome training data does not exist yet.'
      : 'Review recent gaps before treating coverage as a quality metric; the message matcher is deliberately heuristic.',
  };
}

async function main(): Promise<void> {
  const dbArgIndex = process.argv.indexOf('--db');
  const dbPath = resolve(dbArgIndex >= 0 ? process.argv[dbArgIndex + 1] : 'data/beetree.db');
  const database = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    console.log(JSON.stringify(adviceCoverage(database as unknown as BeetreeDb), null, 2));
  } finally {
    database.close();
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(error => {
    console.error('[adviceCoverage] failed:', error);
    process.exit(1);
  });
}
