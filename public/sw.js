/**
 * BeeTree Service Worker
 *
 * Caching strategy:
 *   - Static assets (JS, CSS, fonts, images): cache-first with network fallback
 *   - GET API responses (/api/*): stale-while-revalidate with bounded cache
 *   - Navigation requests: network-first, fall back to cached shell
 *
 * The SW versions its caches with CACHE_VERSION so a new deploy auto-invalidates.
 */

const CACHE_VERSION = 'beetree-v3';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Max entries in API cache to prevent unbounded growth
const API_CACHE_MAX = 100;

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

// ─── Cache-first (for static assets) ────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Revalidate in background
    fetch(request).then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
    }).catch(() => {});
    return cached;
  }
  const networkRes = await fetch(request);
  if (networkRes && networkRes.ok) {
    cache.put(request, networkRes.clone());
  }
  return networkRes;
}

// ─── Stale-while-revalidate (for API GETs) ──────────────────────────────────
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then((networkRes) => {
    if (networkRes && networkRes.ok) {
      cache.put(request, networkRes.clone());
    }
    return networkRes;
  }).catch(() => cached);

  // Return cached immediately if available, otherwise wait for network
  return cached || networkFetch;
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

  // Only handle GET; let everything else pass through
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

  // API GET requests → stale-while-revalidate
  if (isApiRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
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

  // Other same-origin GETs → runtime cache (stale-while-revalidate)
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ─── Message: skip waiting (for update flow) ─────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
