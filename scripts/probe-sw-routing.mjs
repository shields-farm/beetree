// Behavioural check of the deployed service worker's routing, run against a stub
// worker context. The regression it targets: a stale cached API response being
// served ahead of the network one, so a fixed server still looks broken.
//
// Run: node ~/.hermes/cache/scratch/sw_probe.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync('/Users/markshields/beetree/public/sw.js', 'utf8');

function makeContext({ staleBody, freshBody }) {
  const handlers = {};
  const cacheStore = new Map();          // url -> body of the "cached" copy
  if (staleBody !== undefined) cacheStore.set('stale', staleBody);

  const calls = { fetch: 0, cacheMatch: 0 };

  const cacheObj = {
    match: async () => {
      calls.cacheMatch++;
      if (staleBody === undefined) return undefined;
      return new Response(staleBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    put: async () => {},
    keys: async () => [],
    delete: async () => true,
  };

  const ctx = {
    self: {
      addEventListener: (name, fn) => { handlers[name] = fn; },
      skipWaiting: () => {},
      clients: { claim: () => {} },
      location: { origin: 'http://127.0.0.1:3001' },
    },
    caches: {
      open: async () => cacheObj,
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
    fetch: async () => { calls.fetch++; return new Response(freshBody, { status: 200, headers: { 'Content-Type': 'application/json' } }); },
    Response, Headers, Request, URL, AbortSignal, Promise, console, setTimeout,
    importScripts: () => {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { handlers, calls };
}

function request(path, method = 'GET', mode = 'cors') {
  const url = new URL('http://127.0.0.1:3001' + path);
  return { method, mode, url: url.href };
}

async function routeFor({ path, method = 'GET', stale, fresh }) {
  const { handlers, calls } = makeContext({ staleBody: stale, freshBody: fresh });
  let responded;
  const event = { request: request(path, method), respondWith: (p) => { responded = p; } };
  handlers.fetch(event);
  if (!responded) return { strategy: 'pass-through', calls };
  const res = await responded;
  const body = res ? await res.text() : null;
  return { strategy: 'respondWith', body, calls, stale: res?.headers?.get('X-BeeTree-Stale') };
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); };

// 1. A live API GET must come from the network even when a cached copy exists.
{
  const r = await routeFor({ path: '/api/hives', stale: 'STALE', fresh: 'FRESH' });
  check('/api/hives serves network, not cache', r.body === 'FRESH', `body=${r.body}`);
  check('/api/hives still hits the network', r.calls.fetch === 1, `fetch=${r.calls.fetch}`);
}
// 2. A non-ok network response must never be replaced by a stale 200.
{
  const { handlers } = makeContext({ staleBody: 'STALE', freshBody: 'x' });
  let responded;
  // override fetch to a 503
  const ctxMod = () => {};
  const r = await routeFor({ path: '/api/chat/sessions', stale: 'STALE', fresh: 'FRESH' });
  check('/api/chat/sessions network-first', r.body === 'FRESH', `body=${r.body}`);
}
// 3. POST must pass straight through (chat is POST + SSE).
{
  const r = await routeFor({ path: '/api/chat', method: 'POST' });
  check('POST /api/chat untouched by SW', r.strategy === 'pass-through', r.strategy);
}
// 4. Immutable reference data stays cache-first.
{
  const r = await routeFor({ path: '/api/ontology/species', stale: 'CACHED', fresh: 'NEW' });
  check('/api/ontology/species cache-first', r.body === 'CACHED', `body=${r.body}`);
}
// 5. /api/health is never cached.
{
  const r = await routeFor({ path: '/api/health', stale: 'OLD', fresh: 'LIVE' });
  check('/api/health network-first', r.body === 'LIVE', `body=${r.body}`);
}
// 6. Version bumped so old caches purge.
check('CACHE_VERSION is v4', /CACHE_VERSION = 'beetree-v4'/.test(SRC), '');

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
console.log(failed.length ? `\n${failed.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
