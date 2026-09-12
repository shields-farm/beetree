import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest picks this up instead of vite.config.ts (which carries the dev-server
// proxy + TLS config that tests don't need).
//
// Default environment is `node` — most tests here are pure logic. Tests that
// need a DOM (the markdown renderer, because DOMPurify sanitizes against a real
// document) opt in per file with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
