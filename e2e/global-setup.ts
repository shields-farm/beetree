import type { FullConfig } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Boot an isolated BeeTree server for the suite.
 *
 * The tests mutate data (create tasks, inspections, change box content). Running
 * them against the live database would corrupt the beekeeper's real records, so
 * this copies the DB to a scratch path, starts the server against the copy on a
 * spare port with a raised rate limit, and tears it all down afterwards.
 *
 * The copy is seeded from the real DB so the tests run against realistic data
 * (6 hives, stale sensors, an overdue inspection) rather than an empty schema.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PORT = 3999;
const DB_SRC = resolve(ROOT, 'data', 'beetree.db');
const DB_TMP = resolve(ROOT, 'data', 'e2e.db');

let server: ChildProcess | null = null;

function apiKey(): string {
  if (process.env.BEETREE_API_KEY) return process.env.BEETREE_API_KEY;
  const env = resolve(ROOT, 'server/.env');
  if (existsSync(env)) {
    const m = /^BEETREE_API_KEY=(.+)$/m.exec(readFileSync(env, 'utf8'));
    if (m) return m[1].trim();
  }
  throw new Error('No BeeTree API key found for e2e setup');
}

async function waitHealthy(url: string, ms = 45_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`test server never became healthy at ${url}`);
}

export default async function globalSetup(_config: FullConfig) {
  // Fresh scratch DB from the real one (schema + realistic seed data).
  mkdirSync(dirname(DB_TMP), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DB_SRC + suffix)) copyFileSync(DB_SRC + suffix, DB_TMP + suffix);
  }
  // Never let a scratch run leave WAL behind for the next one.
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(DB_TMP + suffix)) rmSync(DB_TMP + suffix);
  }

  const key = apiKey();

  server = spawn('npm', ['start'], {
    cwd: resolve(ROOT, 'server'),
    env: {
      ...process.env,
      PORT: String(PORT),
      BEETREE_DB: DB_TMP,
      BEETREE_API_KEY: key,
      // Browsing many routes in parallel would otherwise trip the limiter and
      // look like app failures.
      BEETREE_RATE_LIMIT: '100000',
    },
    stdio: 'ignore',
    detached: true,
  });

  const url = `http://127.0.0.1:${PORT}`;
  await waitHealthy(`${url}/api/health`);

  // Playwright reads this to point the browser at the scratch server.
  process.env.BEETREE_URL = url;
  writeFileSync(resolve(ROOT, 'e2e', '.test-server-url'), url);

  return async () => {
    // Kill the child we spawned directly — no shell, no lsof, no injection
    // surface. `npm start` spawns tsx as a grandchild, so signal the process
    // group we created.
    if (server?.pid) {
      try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
      try { server.kill('SIGTERM'); } catch { /* already gone */ }
    }
    await new Promise((r) => setTimeout(r, 1500));
    if (server?.pid) {
      try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(DB_TMP + suffix)) rmSync(DB_TMP + suffix);
    }
  };
}
