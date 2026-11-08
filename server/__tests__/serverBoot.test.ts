// server/__tests__/serverBoot.test.ts
//
// Boot smoke test: start the real server against a throwaway database and hit
// it over HTTP. Everything else in `server/__tests__/` imports modules directly,
// which means nothing in the suite proves that the process starts, that the
// Express app mounts, that migrations run on a fresh DB, or that the ontology
// file parses.
//
// That gap matters because `server/package.json` holds the production API's
// dependency tree and Renovate bumps it: express, better-sqlite3, js-yaml and
// the OpenTelemetry stack. A dependency can typecheck fine and still fail at
// import or listen time — an express middleware signature change, an otel init
// that throws, a js-yaml API change that breaks the ontology loader. Typecheck
// cannot see any of that. This test can.
//
// It deliberately asserts through the four dependency classes that actually get
// bumped:
//
//   /api/health            express is up and routing
//   /api/migrations        better-sqlite3 opened the DB and the runner executed
//   /api/ontology/summary  js-yaml parsed the vocabulary and entities loaded
//   /api/hives             auth middleware + a real DB query, with and without a token
//
// The spawn recipe mirrors scripts/verify-app.mjs, which already relies on
// BEETREE_DB / PORT / BEETREE_API_KEY being overridable. Nothing here touches
// data/beetree.db.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const API_KEY = 'boot-smoke-test-key-not-a-secret';

// Generous: a cold `tsx` compile plus migrations is seconds, but a loaded CI
// runner is slower than a laptop and a flaky boot test is worse than none.
const BOOT_TIMEOUT_MS = 90_000;

let child: ChildProcess | undefined;
let base = '';
let workDir = '';
let output = '';

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`server exited with code ${child.exitCode} before listening\n--- output ---\n${output.slice(-3000)}`);
    }
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server never became healthy within ${BOOT_TIMEOUT_MS}ms\n--- output ---\n${output.slice(-3000)}`);
}

function stop(): void {
  if (!child?.pid) return;
  // Negative pid: kill the whole detached process group, or `npm` leaves `tsx`
  // holding the port and the next run collides.
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'beetree-boot-'));
  // Random port rather than a fixed one: vitest runs files in parallel workers
  // and a fixed port would make two workers fight over it.
  const port = 3900 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${port}`;

  child = spawn('npm', ['start'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      BEETREE_DB: join(workDir, 'beetree.db'),
      BEETREE_MEDIA_DIR: join(workDir, 'media'),
      BEETREE_API_KEY: API_KEY,
      // The suite hits a handful of routes; leave no chance of tripping the limiter.
      BEETREE_RATE_LIMIT: '100000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  child.stdout?.on('data', (d) => { output += String(d); });
  child.stderr?.on('data', (d) => { output += String(d); });

  await waitForHealth(base);
}, BOOT_TIMEOUT_MS);

afterAll(() => {
  stop();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('server boots against a fresh database', () => {
  it('answers /api/health without auth', async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('ok');
  });

  it('ran the migrations on the new database', async () => {
    const r = await fetch(`${base}/api/migrations`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    // A fresh DB means every migration file executed; an empty list would mean
    // the directory was not found or the runner silently no-opped.
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('parsed the ontology vocabulary', async () => {
    const r = await fetch(`${base}/api/ontology/summary`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    // Proves the YAML loaded (vocab name/version come straight out of the file)
    // and that predicates parsed — the js-yaml path.
    expect(typeof body.vocab?.name).toBe('string');
    expect(body.vocab.name.length).toBeGreaterThan(0);
    expect(Array.isArray(body.predicates)).toBe(true);
    expect(body.predicates.length).toBeGreaterThan(0);
  });

  it('queries the database through the auth middleware', async () => {
    const r = await fetch(`${base}/api/hives`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
  });

  it('rejects an unauthenticated request', async () => {
    const r = await fetch(`${base}/api/hives`);
    expect([401, 403]).toContain(r.status);
  });
});
