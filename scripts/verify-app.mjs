#!/usr/bin/env node
/**
 * verify-app.mjs — one command that answers "does BeeTree still work?"
 *
 * WHY THIS EXISTS
 *   Unit tests prove pure functions. The Playwright suite proves routing and
 *   persistence. Neither answers the question a beekeeper actually asks after a
 *   change: does the app come up, does the console stay clean, and did the
 *   layout move under my thumb. This is that gate:
 *
 *       npm run verify
 *
 *   It boots the real server against a scratch copy of the database, drives
 *   every nav route in headless Chromium at phone width, and reports PASS/FAIL
 *   with per-route evidence. Exit 0 = pass, 1 = fail, 2 = environment failure.
 *
 * WHAT IT CATCHES THAT THE E2E SUITE DOES NOT
 *   Geometry is sampled twice — at first paint and after the late data settles —
 *   so a route that renders correctly and *then* shifts is a number, not a
 *   surprise on the phone. A blank shell (a route registered in the router but
 *   not rendering) also fails here, per route.
 *
 * WHAT IT DOES NOT COVER
 *   It does not drive Buzz chat (needs a model provider) and it does not replace
 *   `npm run test:e2e` — run both. This is the fast post-change gate; that is
 *   the thorough suite. Absolute row counts are never asserted: the scratch DB
 *   is copied from live data, so checks stay about structure and stability.
 *
 * The scratch DB is a copy, so a verify run can never mutate real records.
 */
import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PORT = Number(process.env.VERIFY_PORT || 3899);
const BASE = process.env.BEETREE_URL || `http://127.0.0.1:${PORT}`;
const SCRATCH = resolve(tmpdir(), 'beetree-verify');
const DB_SRC = resolve(ROOT, 'data', 'beetree.db');
const DB_TMP = resolve(SCRATCH, 'verify.db');

/** How long to wait for late data before the last geometry sample. */
const SETTLE_MS = 2300;
/**
 * Movement under this many pixels is not something a person notices.
 *
 * Calibrated against the app as it stands: the dashboard header reflows 4px
 * when `DataFreshness` mounts (it renders null until the first sync, then the
 * chip appears beside the h1). That is real but imperceptible. Lower this to 2
 * to have it flagged; the structural shift this gate exists for — a banner or
 * late panel pushing content down — is tens of pixels.
 */
const DRIFT_TOLERANCE_PX = Number(process.env.VERIFY_DRIFT_PX || 5);

/** Routes the nav exposes. A page you cannot reach does not exist for a user. */
/**
 * Every static nav route, derived from the router in `src/App.tsx`.
 *
 * Keep this in step with the router. A route missing here is a route this gate
 * silently certifies as fine because it never looked — which is the same false
 * PASS the stale-build check exists to prevent, arriving by a different door.
 * Detail routes (`/hives/:id`, `/sensors/:id`, `/inspections/:id`) need a real
 * record id, so they are not listed; drive those through `npm run test:e2e`.
 */
const ROUTES = [
  '/', '/acoustics', '/activity', '/apiaries', '/buzz', '/chat', '/colony-map',
  '/equipment', '/forage', '/hardware', '/hives', '/inspections',
  '/inspections/new', '/omi', '/outliers', '/pests', '/queen', '/schedule',
  '/sensors', '/settings', '/swarm', '/tasks', '/treatments', '/trends', '/world',
];

/** Sampled before and after settle — the elements that historically jumped. */
const GEOMETRY = ['main', 'nav', 'h1'];

/** Console noise that is not the app's fault (each entry is a blind spot; keep short). */
const BENIGN = ['favicon', 'manifest.json', 'serviceworker', 'sw.js', 'the server responded with a status of 404'];

const log = (m) => console.log(`[verify] ${m}`);

function apiKey() {
  if (process.env.BEETREE_API_KEY) return process.env.BEETREE_API_KEY;
  const env = resolve(ROOT, 'server/.env');
  if (existsSync(env)) {
    const m = /^BEETREE_API_KEY=(.+)$/m.exec(readFileSync(env, 'utf8'));
    if (m) return m[1].trim();
  }
  throw new Error('No BeeTree API key (set BEETREE_API_KEY or create server/.env)');
}

function prepareScratchDb() {
  mkdirSync(SCRATCH, { recursive: true });
  if (!existsSync(DB_SRC)) throw new Error(`No database at ${DB_SRC}`);
  for (const suffix of ['', '-wal', '-shm']) {
    const src = DB_SRC + suffix;
    const dst = DB_TMP + suffix;
    if (existsSync(src)) copyFileSync(src, dst);
    else if (existsSync(dst)) rmSync(dst);   // never inherit a stale WAL
  }
}

async function waitHealthy(url, ms = 45_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function startServer(key) {
  const logPath = resolve(SCRATCH, 'server.log');
  const out = spawn('npm', ['start'], {
    cwd: resolve(ROOT, 'server'),
    env: {
      ...process.env,
      PORT: String(PORT),
      BEETREE_DB: DB_TMP,
      BEETREE_API_KEY: key,
      // Browsing many routes would otherwise trip the limiter and look like app failures.
      BEETREE_RATE_LIMIT: '100000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let buf = '';
  out.stdout.on('data', (d) => { buf += d; });
  out.stderr.on('data', (d) => { buf += d; });
  writeFileSync(logPath, '');
  return { proc: out, tail: () => buf.slice(-2000) };
}

function stopServer({ proc }) {
  if (!proc?.pid) return;
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { proc.kill('SIGTERM'); } catch { /* already gone */ }
}

/** Geometry in the page, sampled on demand. */
const PROBE = () => {
  window.__verifyErrors = [];
  window.addEventListener('error', (e) => window.__verifyErrors.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => window.__verifyErrors.push(`rejection: ${e.reason}`));
  const orig = console.error;
  console.error = function (...a) {
    window.__verifyErrors.push(`console.error: ${a.join(' ')}`);
    return orig.apply(console, a);
  };
  window.__geom = (sels) => {
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      out[s] = el ? Math.round(el.getBoundingClientRect().top * 100) / 100 : null;
    }
    return out;
  };
};

function isBenign(text) {
  const t = String(text).toLowerCase();
  return BENIGN.some((p) => t.includes(p));
}

/** Newest mtime under a directory, so we can spot a dist/ older than the source. */
function newestMtime(dir, exts) {
  let newest = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const p = resolve(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (exts.some((e) => entry.name.endsWith(e))) {
        const m = statSync(p).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
}

/**
 * Refuse to verify a stale build.
 *
 * server/index.ts serves `dist/`, so source edits are invisible until
 * `npm run build`. Without this guard the gate happily reports PASS for changes
 * that were never compiled — the exact false-green this script exists to
 * prevent. Set VERIFY_ALLOW_STALE=1 to check the running build as-is.
 */
async function guardAgainstStaleBuild() {
  if (process.env.BEETREE_URL || process.env.VERIFY_ALLOW_STALE === '1') return;
  const distIndex = resolve(ROOT, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    console.error('SETUP FAIL: no dist/ build. Run `npm run build` first '
      + '(or `npm run verify:build`).');
    process.exit(2);
  }
  const built = statSync(distIndex).mtimeMs;
  const src = newestMtime(resolve(ROOT, 'src'), ['.ts', '.tsx', '.css']);
  if (src > built) {
    const age = Math.round((src - built) / 1000);
    console.error(`SETUP FAIL: dist/ is ${age}s older than src/ — the server would serve ` +
      `stale code and report a false PASS.\n  Fix: npm run build  (or use npm run verify:build)`);
    process.exit(2);
  }
}

async function checkRoute(context, route) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.addInitScript(PROBE);
  await page.goto(`/#${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 15_000 }).catch(() => {});

  // Sample as EARLY as the shell exists, then repeatedly while the page
  // settles. Sampling only twice, late, silently misses any shift that lands
  // before the first sample — the check would pass a page that visibly jumps.
  await page.waitForTimeout(50);
  const samples = [];
  for (const wait of [0, 700, 1300, 2300]) {
    if (wait) await page.waitForTimeout(wait);
    samples.push(await page.evaluate((sels) => window.__geom(sels), GEOMETRY));
  }
  const mainText = await page.evaluate(
    () => (document.querySelector('main')?.innerText || '').trim().slice(0, 400),
  ).catch(() => '');
  const inPageErrors = await page.evaluate(() => window.__verifyErrors || []).catch(() => []);

  const drift = {};
  const lateAppearing = [];
  for (const sel of GEOMETRY) {
    const values = samples.map((s) => s[sel]).filter((v) => v != null);
    if (!values.length) { drift[sel] = 'absent'; continue; }
    if (values.length < samples.length) {
      // An element that renders late (a loading state resolving into content)
      // is progressive rendering, not a shift. It only hurts if it moves
      // something else — which shows up as another selector's movement below.
      lateAppearing.push(sel);
      drift[sel] = 'late';
      continue;
    }
    // Movement across the settle window, not just first-vs-last.
    drift[sel] = Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10;
  }

  const errors = [...consoleErrors, ...inPageErrors].filter((e) => !isBenign(e));
  const problems = [];
  if (errors.length) problems.push(`${errors.length} console error(s): ${errors.slice(0, 2).join(' | ')}`);
  if (!mainText) problems.push('main rendered empty (a blank shell is not a rendered route)');
  for (const [sel, d] of Object.entries(drift)) {
    if (typeof d === 'number' && Math.abs(d) > DRIFT_TOLERANCE_PX) {
      problems.push(`${sel} shifted ${d}px after load`);
    }
  }

  // Notes are informational — progressive render is normal and must not fail
  // the route. Only measurable movement is a problem.
  const notes = [];
  if (lateAppearing.length) {
    notes.push(`${lateAppearing.join(', ')} rendered after first paint (normal)`);
  }

  await page.close();
  return { route, drift, lateAppearing, mainTextLength: mainText.length, errors, problems, notes };
}

async function main() {
  const key = apiKey();
  let server = null;

  // A stale dist/ silently invalidates the whole run: the server serves the
  // built bundle, so checking source changes against an old build reports PASS
  // for code that was never executed. Refuse to run against a build older than
  // the newest source file.
  await guardAgainstStaleBuild();

  if (!process.env.BEETREE_URL) {
    prepareScratchDb();
    log(`booting server on :${PORT} against a scratch copy of the DB`);
    server = startServer(key);
    if (!(await waitHealthy(BASE))) {
      console.error('SETUP FAIL: server never became healthy. Last output:');
      console.error(server.tail());
      stopServer(server);
      return 2;
    }
  } else {
    log(`checking the already-running server at ${BASE}`);
  }

  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    // Phone viewport: the app is phone-first and the layout defects that matter
    // (clipped tab rows, six-item bottom nav) only appear at this width.
    const context = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
    await context.addInitScript((k) => {
      try { localStorage.setItem('beetree-api-key', k); } catch { /* ignore */ }
    }, key);

    for (const route of ROUTES) {
      const r = await checkRoute(context, route);
      results.push(r);
      const status = r.problems.length ? 'FAIL' : 'OK  ';
      const note = r.notes.length ? `  (${r.notes.join('; ')})` : '';
      log(`  ${status} ${route}${r.problems.length ? `  — ${r.problems.join('; ')}` : note}`);
    }
  } finally {
    if (browser) await browser.close();
    if (server) {
      stopServer(server);
      for (const suffix of ['', '-wal', '-shm']) {
        const p = DB_TMP + suffix;
        if (existsSync(p)) rmSync(p);
      }
    }
  }

  const failed = results.filter((r) => r.problems.length);
  console.log();
  if (failed.length) {
    console.error(`VERIFY FAILED — ${failed.length}/${results.length} routes need attention:`);
    for (const r of failed) console.error(`  ${r.route}: ${r.problems.join('; ')}`);
    console.error('\nEvidence per route is above. Fix, then re-run `npm run verify`.');
    return 1;
  }
  log(`VERIFY PASSED — ${results.length}/${results.length} routes loaded clean, `
    + `no console errors, no drift over ${DRIFT_TOLERANCE_PX}px`);
  return 0;
}

process.exitCode = await main();
