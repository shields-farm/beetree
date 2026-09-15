import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest picks this up instead of vite.config.ts (which carries the dev-server
// proxy + TLS config that tests don't need).
//
// Default environment is `node` — most tests here are pure logic. Tests that
// need a DOM (the markdown renderer, because DOMPurify sanitizes against a real
// document) opt in per file with a `// @vitest-environment jsdom` docblock.
//
// Scope is unit tests only: `e2e/` holds Playwright specs and must be excluded,
// or Vitest collects them and dies on "Playwright Test did not expect
// test.describe() to be called here".
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'server/**/*.{test,spec}.{ts,tsx}'],
    // `server/node_modules` is a separate install; without the glob it
    // collects third-party test files from inside it.
    exclude: ['**/node_modules/**', 'dist/**', 'e2e/**'],
    // Point every worker at its own throwaway DB + media dir before server/db.ts
    // is imported. Without this the suite runs migrations against the live
    // database, and parallel workers race each other applying them.
    setupFiles: ['server/__tests__/setup-test-db.ts'],
  },
});
