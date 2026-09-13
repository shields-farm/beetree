import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Playwright config for BeeTree.
 *
 * These tests exist because every bug found in the Sep 2026 UX pass was
 * end-to-end detectable and invisible to the existing unit suite: unregistered
 * routes rendering an empty shell, copy-on-write queries keyed on the wrong
 * column, store mutations that never reached the server, partial PUTs blanking
 * fields, and a POST whose INSERT had the wrong arity. None of those are
 * reachable from a pure-function test — they need a browser and a real DB.
 *
 * `globalSetup` boots a throwaway server on its own port against a COPY of the
 * database, so the suite never mutates the beekeeper's real records.
 */
function resolvedBaseUrl(): string {
  if (process.env.BEETREE_URL) return process.env.BEETREE_URL;
  // Written by global-setup before the browser projects start.
  const marker = resolve(HERE, 'e2e', '.test-server-url');
  if (existsSync(marker)) return readFileSync(marker, 'utf8').trim();
  return 'http://127.0.0.1:3001';
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Serial: one server, one scratch DB, and the app is phone-first — parallel
  // contexts add flake without adding signal here.
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: resolvedBaseUrl(),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  timeout: 30_000,
  expect: { timeout: 10_000 },

  projects: [
    {
      name: 'chromium',
      // A real phone viewport — the app is phone-first and several defects
      // (clipped tab rows, six-item bottom nav) only appear at this width.
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
});
