/**
 * BeeTree Service Worker
 *
 * Caching strategy:
 *   - Static assets (hashed JS, CSS, fonts, images): cache-first, revalidate behind
 *   - GET API responses: NETWORK-FIRST, cache used only when the network fails
 *   - Navigation requests: network-first, fall back to cached shell
 *   - A short allowlist of immutable reference data: cache-first
 *
 * Why API GETs are not stale-while-revalidate any more: this is an apiary
 * dashboard. A colony's temperature, its last inspection date and its weight are
 * the inputs to a decision — open it today or wait, feed it or not. Serving the
 * previous answer first, with no indicator that it is old, means the beekeeper can
 * act on a hive reading that was true an hour (or a week) ago and never know. Under
 * SWR a stale payload also survives every reload, so a fixed server still looks
 * broken from the browser: the request never leaves the page. Network-first with a
 * short timeout keeps the offline story (a dropped connection still renders the
 * last known good data) without letting staleness masquerade as live data.
 *
 * The SW versions its caches with CACHE_VERSION, so a new deploy purges the old
 * ones on activate.
 */

const CACHE_VERSION = 'beetree-v4';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Max entries in API cache to prevent unbounded growth
const API_CACHE_MAX = 100;

// How long a GET API call may take before the cached copy is served instead.
// Long enough for a slow tool round, short enough that a hung request does not
// leave the dashboard blank.
const API_NETWORK_TIMEOUT_MS = 8000;

// Reference data that does not change between deploys. Everything else under
// /api/ is live state and must come from the network.
const CACHEABLE_API_PATHS = new Set([
  '/api/ontology/species',
  '/api/forage/species',
]);

// Static assets pre-cached on install
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons.svg',
];

// ─── Install: pre-cache shell ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => {
        // Pre-cache failure is non-fatal; runtime caching will fill in
      })
  );
});

// ─── Activate: clean old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('beetree-') && !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Helper: is this a GET API request? ─────────────────────────────────────
function isApiRequest(url) {
  return url.pathname.startsWith('/api/') && url.pathname !== '/api/setup/status';
}

function isCacheableApiRequest(url) {
  return CACHEABLE_API_PATHS.has(url.pathname);
}

// ─── Helper: is this a static asset? ────────────────────────────────────────
function isStaticAsset(url) {
  const path = url.pathname;
  return (
    /\.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|wasm)(\?.*)?$/.test(path) ||
    path === '/manifest.webmanifest' ||
    path === '/favicon.svg' ||
    path === '/icons.svg'
  );
}

// ─── Trim a cache to API_CACHE_MAX entries (oldest first) ───────────────────
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    await cache.delete(key);
  }
}

// ─── Cache-first (static assets and immutable reference data) ───────────────
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Revalidate in background so a rebuilt asset is not served forever
    fetch(request).then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
    }).catch(() => {});
    return cached;
  }
  const networkRes = await fetch(request);
  if (networkRes && networkRes.ok) {
    await cache.put(request, networkRes.clone());
    await trimCache(cacheName, API_CACHE_MAX);
  }
  return networkRes;
}

// ─── Network-first (live API state) ─────────────────────────────────────────
//
// The cache is a fallback for a failed network, never a substitute for a
// successful one. `AbortSignal.timeout` bounds a hung request so the dashboard
// degrades to last-known data instead of hanging.
async function networkFirstApi(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const networkRes = await fetch(request, { signal: AbortSignal.timeout(API_NETWORK_TIMEOUT_MS) });
    if (networkRes && networkRes.ok) {
      await cache.put(request, networkRes.clone());
      await trimCache(cacheName, API_CACHE_MAX);
    }
    // A non-ok response is returned as-is: the caller must see the real status
    // (401, 429, 503) rather than a stale 200 for a different question.
    return networkRes;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      // Mark the response so the UI can say "last known" instead of implying live
      const headers = new Headers(cached.headers);
      headers.set('X-BeeTree-Stale', '1');
      const body = await cached.blob();
      return new Response(body, { status: cached.status, statusText: cached.statusText, headers });
    }
    throw new Error('offline and nothing cached');
  }
}

// ─── Network-first (for navigations) ───────────────────────────────────────
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const networkRes = await fetch(request);
    if (networkRes && networkRes.ok) {
      cache.put(request, networkRes.clone());
    }
    return networkRes;
  } catch {
    // Offline: try cache, then fall back to cached root (app shell)
    const cached = await cache.match(request);
    if (cached) return cached;
    return cache.match('/');
  }
}

// ─── Main fetch handler ──────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET; let everything else pass through (chat is POST + SSE)
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return; // Invalid URL, skip
  }

  // Skip cross-origin requests (e.g. external APIs, CDN)
  if (url.origin !== self.location.origin) return;

  // Skip WebSocket and non-http(s) schemes
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Immutable reference data → cache-first
  if (isApiRequest(url) && isCacheableApiRequest(url)) {
    event.respondWith(cacheFirst(request, API_CACHE));
    return;
  }

  // Anything else under /api/ is live state → network-first
  if (isApiRequest(url)) {
    event.respondWith(networkFirstApi(request, API_CACHE));
    return;
  }

  // Navigation requests → network-first
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // Static assets → cache-first
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Other same-origin GETs → runtime cache (stale-while-revalidate is fine here:
  // these are not hive readings)
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ─── Stale-while-revalidate, for non-API same-origin GETs only ──────────────
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then((networkRes) => {
    if (networkRes && networkRes.ok) {
      cache.put(request, networkRes.clone());
    }
    return networkRes;
  }).catch(() => cached);
  return cached || networkFetch;
}

// ─── Message: skip waiting (for update flow) ─────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
