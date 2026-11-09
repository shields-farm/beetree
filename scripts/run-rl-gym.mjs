#!/usr/bin/env node
// scripts/run-rl-gym.mjs — safe driver for BeeTree replay tasks.
//
// build: online-backup the live DB, then mine tasks from the copy
// run:   make cutoff/label DBs per episode and spawn an isolated worker
// report: aggregate result JSONL files; never touches the live DB

import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(join(ROOT, 'server', 'package.json'));
const Database = require('better-sqlite3');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) out[key] = 'true';
    else { out[key] = value; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(3));
const command = process.argv[2] ?? 'help';
const outDir = resolve(args.out ?? join(homedir(), '.hermes', 'cache', 'scratch', 'beetree-rl-gym'));
const liveDb = resolve(args.db ?? join(ROOT, 'data', 'beetree.db'));
const sourceDb = join(outDir, 'source.db');
const tasksPath = join(outDir, 'tasks.jsonl');

function loadServerEnv() {
  const path = join(ROOT, 'server', '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function backupLiveDb() {
  mkdirSync(outDir, { recursive: true });
  const db = new Database(liveDb, { readonly: true, fileMustExist: true });
  try {
    await db.backup(sourceDb);
  } finally {
    db.close();
  }
}

function tableColumns(db, table) {
  const safe = table.replace(/[^a-zA-Z0-9_]/g, '');
  return new Set(db.prepare(`PRAGMA table_info(${safe})`).all().map(r => r.name));
}

function deleteAfter(db, table, column, cutoff) {
  const columns = tableColumns(db, table);
  if (!columns.has(column)) return 0;
  return db.prepare(`DELETE FROM ${table} WHERE ${column} > ?`).run(cutoff).changes;
}

function pruneSnapshot(cutoff, destination) {
  copyFileSync(sourceDb, destination);
  const db = new Database(destination);
  try {
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    deleteAfter(db, 'telemetry_cache', 'time', cutoff);
    deleteAfter(db, 'inspections', 'date', cutoff);
    deleteAfter(db, 'feeding_events', 'date', cutoff);
    deleteAfter(db, 'agentic_log', 'timestamp', cutoff);
    deleteAfter(db, 'chat_messages', 'created_at', cutoff);
    deleteAfter(db, 'advice_claims', 'createdAt', cutoff);
    deleteAfter(db, 'advice_claim_grades', 'gradedAt', cutoff);
    deleteAfter(db, 'onto_evidence', 'recorded_at', cutoff);
    deleteAfter(db, 'onto_event', 'occurred_at', cutoff);
    deleteAfter(db, 'onto_instantiation', 'valid_from', cutoff);
    // Tasks have no createdAt. Future-dated tasks are removed conservatively;
    // this avoids obvious leakage but makes task history a known replay limit.
    deleteAfter(db, 'tasks', 'dueDate', cutoff);

    // latestReading is denormalized "now" state. Rebuild it from the pruned
    // telemetry or get_sensors would leak the real present into a past episode.
    const sensors = db.prepare(
      'SELECT id, deviceId FROM sensors WHERE superseded_by IS NULL',
    ).all();
    const latest = db.prepare(
      `SELECT time, temperature, humidity, batteryVoltage, signal
         FROM telemetry_cache
        WHERE lower(replace(deviceId, ':', '')) = ? AND time <= ?
          AND (temperature IS NOT NULL OR humidity IS NOT NULL)
        ORDER BY time DESC LIMIT 1`,
    );
    const update = db.prepare('UPDATE sensors SET latestReading = ? WHERE id = ?');
    for (const sensor of sensors) {
      const device = String(sensor.deviceId).replace(/:/g, '').toLowerCase();
      const row = latest.get(device, cutoff);
      const payload = row ? JSON.stringify({
        timestamp: row.time,
        temperature: row.temperature,
        humidity: row.humidity,
        batteryVoltage: row.batteryVoltage,
        signal: row.signal,
      }) : null;
      update.run(payload, sensor.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  } finally {
    db.close();
  }
}

function runTsx(script, scriptArgs, env = {}) {
  const result = spawnSync('npx', ['--no-install', 'tsx', script, ...scriptArgs], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 180_000,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function readTasks() {
  if (!existsSync(tasksPath)) throw new Error(`no tasks at ${tasksPath}; run build first`);
  return readFileSync(tasksPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function readResults(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function build() {
  console.log(`Backing up ${basename(liveDb)} to ${sourceDb} (live DB is opened read-only)`);
  await backupLiveDb();
  const status = runTsx('server/rlGym.ts', [
    'build', '--db', sourceDb, '--out', tasksPath,
    '--limit', String(args.limit ?? 40),
    '--step-days', String(args['step-days'] ?? 3),
    '--context-days', String(args['context-days'] ?? 14),
    '--horizon-days', String(args['horizon-days'] ?? 7),
  ]);
  if (status !== 0) process.exitCode = status;
}

function run() {
  const policy = args.policy ?? 'rules';
  const requestedTask = args.task;
  let tasks = requestedTask ? readTasks().filter(t => t.id === requestedTask) : readTasks();
  if (requestedTask && tasks.length === 0) throw new Error(`task not found: ${requestedTask}`);
  tasks = tasks.slice(0, Number(args.limit ?? 40));
  const episodesDir = join(outDir, 'episodes');
  mkdirSync(episodesDir, { recursive: true });
  loadServerEnv();
  const results = [];
  for (const task of tasks) {
    const dir = join(episodesDir, task.id);
    mkdirSync(dir, { recursive: true });
    const taskPath = join(dir, 'task.json');
    const actDb = join(dir, 'act.db');
    const labelDb = join(dir, 'label.db');
    const resultPath = join(dir, `result-${policy}.json`);
    writeFileSync(taskPath, JSON.stringify(task, null, 2) + '\n');
    console.log(`\n[${task.id}] ${task.kind}; acting cutoff ${task.cutoff}; label horizon ${task.labelEnd}`);
    pruneSnapshot(task.cutoff, actDb);
    pruneSnapshot(task.labelEnd, labelDb);
    const status = runTsx('server/rlEpisodeWorker.ts', [], {
      BEETREE_DB: actDb,
      BEETREE_RL_LABEL_DB: labelDb,
      BEETREE_RL_TASK_PATH: taskPath,
      BEETREE_RL_RESULT_PATH: resultPath,
      BEETREE_RL_POLICY: policy,
      ...(args.model ? { BEETREE_RL_MODEL: args.model } : {}),
    });
    if (existsSync(resultPath)) results.push(JSON.parse(readFileSync(resultPath, 'utf8')));
    if (status !== 0) console.error(`[${task.id}] worker exited ${status}; continuing remaining tasks`);
  }
  const resultFile = join(outDir, `results-${policy}.jsonl`);
  const existing = readResults(resultFile).filter(old => !results.some(current => current.taskId === old.taskId));
  const combined = [...existing, ...results];
  writeFileSync(resultFile, combined.map(r => JSON.stringify(r)).join('\n') + (combined.length ? '\n' : ''));
  console.log(`\nWrote ${combined.length} result(s) to ${resultFile} (${results.length} refreshed)`);
  report();
}

function report() {
  const tasks = new Map(readTasks().map(t => [t.id, t]));
  const files = readdirSync(outDir).filter(f => /^results-.+\.jsonl$/.test(f));
  const results = files.flatMap(f => readResults(join(outDir, f)));
  const groups = new Map();
  for (const result of results) {
    const task = tasks.get(result.taskId);
    const key = `${result.policy}/${task?.kind ?? 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }
  const output = {};
  for (const [key, rows] of [...groups.entries()].sort()) {
    const successful = rows.filter(r => r.score && r.action);
    const grades = {};
    const flags = {};
    for (const row of successful) {
      for (const claim of row.claims ?? []) grades[claim.grade] = (grades[claim.grade] ?? 0) + 1;
      for (const flag of row.score.flags ?? []) flags[flag] = (flags[flag] ?? 0) + 1;
    }
    output[key] = {
      episodes: rows.length,
      errors: rows.length - successful.length,
      meanReward: successful.length ? Math.round((successful.reduce((a, r) => a + r.score.total, 0) / successful.length) * 1000) / 1000 : null,
      decisionAccuracy: successful.length ? Math.round((successful.filter(r => r.action.decision === tasks.get(r.taskId)?.label.expectedDecision).length / successful.length) * 1000) / 1000 : null,
      claims: successful.reduce((a, r) => a + (r.claims?.length ?? 0), 0),
      grades,
      flags,
      errorMessages: rows.filter(r => r.error).map(r => ({ taskId: r.taskId, error: r.error })),
    };
  }
  console.log(JSON.stringify({ results: results.length, byPolicyAndKind: output }, null, 2));
}

try {
  if (command === 'build') await build();
  else if (command === 'run') run();
  else if (command === 'report') report();
  else {
    console.log('usage: node scripts/run-rl-gym.mjs build|run|report [--out DIR] [--limit N] [--policy null|rules|model] [--model NAME]');
  }
} catch (error) {
  console.error('[rl-gym] failed:', error);
  process.exit(1);
}
