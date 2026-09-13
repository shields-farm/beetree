import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared fixtures.
 *
 * The API key is read from server/.env (or /api/key on localhost) so tests
 * don't carry a hardcoded copy — the key rotates and a stale literal in a test
 * file is worse than no test.
 */

// This project is ESM ("type": "module"), so there is no `__dirname`.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/**
 * Base URL, written by global-setup after it boots the scratch server.
 * Falls back to the production port when running a single spec without setup.
 */
function testBaseUrl(): string {
  if (process.env.BEETREE_URL) return process.env.BEETREE_URL;
  try {
    return readFileSync(resolve(HERE, '.test-server-url'), 'utf8').trim();
  } catch {
    return 'http://127.0.0.1:3001';
  }
}
export const BASE_URL = testBaseUrl();

export function apiKey(): string {
  if (process.env.BEETREE_API_KEY) return process.env.BEETREE_API_KEY;
  try {
    const env = readFileSync(resolve(ROOT, 'server/.env'), 'utf8');
    const m = /^BEETREE_API_KEY=(.+)$/m.exec(env);
    if (m) return m[1].trim();
  } catch { /* fall through */ }
  throw new Error(
    'No BeeTree API key. Set BEETREE_API_KEY or create server/.env with BEETREE_API_KEY=...',
  );
}

/** Seed the key before the app boots, or App.tsx renders the Setup Wizard. */
export async function seedKey(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try { window.localStorage.setItem('beetree-api-key', key); } catch { /* ignore */ }
  }, apiKey());
}

export interface Api {
  get: <T = any>(path: string) => Promise<T>;
  post: <T = any>(path: string, body?: unknown) => Promise<T>;
  put: <T = any>(path: string, body?: unknown) => Promise<T>;
  del: (path: string) => Promise<number>;
}

export function makeApi(request: APIRequestContext): Api {
  const headers = { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' };
  const url = (p: string) => `${BASE_URL}/api${p}`;
  return {
    get: async <T,>(p: string) => {
      const r = await request.get(url(p), { headers });
      expect(r.ok(), `GET ${p} -> ${r.status()}`).toBeTruthy();
      return (await r.json()) as T;
    },
    post: async <T,>(p: string, body: unknown = {}) => {
      const r = await request.post(url(p), { headers, data: body });
      expect(r.ok(), `POST ${p} -> ${r.status()} ${await r.text()}`).toBeTruthy();
      return (await r.json()) as T;
    },
    put: async <T,>(p: string, body: unknown = {}) => {
      const r = await request.put(url(p), { headers, data: body });
      expect(r.ok(), `PUT ${p} -> ${r.status()}`).toBeTruthy();
      return (await r.json()) as T;
    },
    del: async (p: string) => {
      const r = await request.delete(url(p), { headers });
      return r.status();
    },
  };
}

/**
 * Collect console errors and failed requests.
 *
 * A React crash renders a blank page without throwing anything Playwright would
 * fail on by itself — the route just looks empty. Catching console errors here
 * is what turns "the page is blank" into a named failure.
 */
export interface Diagnostics {
  consoleErrors: string[];
  failedRequests: string[];
}

export function watchForErrors(page: Page): Diagnostics {
  const d: Diagnostics = { consoleErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') d.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => d.consoleErrors.push(String(err)));
  page.on('response', (res) => {
    if (res.status() >= 400) d.failedRequests.push(`${res.status()} ${res.url()}`);
  });
  return d;
}

/** Navigate to a hash route and wait for the app shell to settle. */
export async function gotoRoute(page: Page, route: string): Promise<void> {
  await page.goto(`/#${route}`);
  await expect(page.locator('main')).toBeVisible();
}

/** innerText of <main> — empty string means the route rendered nothing. */
export async function mainText(page: Page): Promise<string> {
  return (await page.locator('main').innerText()).trim();
}

/** Poll the server until it answers, so a slow restart doesn't fail the suite. */
export async function waitForServer(request: APIRequestContext, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await request.get(`${BASE_URL}/api/health`);
      if (r.ok()) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('BeeTree server did not become healthy');
}

export const test = base.extend<{ api: Api }>({
  api: async ({ request }, use) => {
    await waitForServer(request);
    await use(makeApi(request));
  },
});

export { expect };
