/* Service worker for the MAC Vendor Lookup PWA.
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS/manifest/icons): cache-first with background
 *     revalidation so updates land on the next load.
 *   - Registry data (data/registry.json) and metadata sidecar
 *     (data/metadata.json): network-first with a hard timeout when online so
 *     a slow server doesn't hang the page; falls back to the cached copy on
 *     timeout, failure, or offline. A `?refresh=1` query (added by the PWA
 *     manual refresh) bypasses every cache layer (cache: no-store).
 *
 * Defensive notes:
 *   - install / activate cache operations are best-effort: a single failing
 *     URL doesn't block install, and stale-cache cleanup never throws.
 *   - All cache.put() calls are wrapped — Safari and private modes can throw
 *     QuotaExceededError or "operation is insecure" at any time.
 *   - No unhandled promise rejections: every async path has a catch.
 *   - Bump *_CACHE names when the on-disk format changes so older clients
 *     evict stale entries on activate.
 */
const APP_SHELL_CACHE = 'maclookup-shell-v5';
const DATA_CACHE = 'maclookup-data-v4';

// Hard ceiling on network-first data requests inside the SW. The browser
// cache fallback path needs to fire well before the PWA's own fetch timeout.
const DATA_NETWORK_TIMEOUT_MS = 12000;

const SHELL_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './i18n.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(APP_SHELL_CACHE);
      // Best-effort: don't let one missing icon fail install entirely.
      await Promise.all(SHELL_URLS.map((u) =>
        cache.add(u).catch((e) => {
          try { console.info('[sw] failed to precache', u, e && e.message); } catch (_) {}
        })
      ));
    } catch (e) {
      try { console.info('[sw] install error:', e && e.message); } catch (_) {}
    }
    try { await self.skipWaiting(); } catch (_) {}
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== APP_SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k).catch(() => false))
      );
    } catch (_) { /* cache cleanup is best-effort */ }
    try { await self.clients.claim(); } catch (_) {}
  })());
});

function isDataRequest(url) {
  return url.pathname.endsWith('/data/registry.json')
      || url.pathname.endsWith('data/registry.json')
      || url.pathname.endsWith('/data/metadata.json')
      || url.pathname.endsWith('data/metadata.json');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); }
  catch (_) { return; } // malformed URL — let the browser handle it

  if (url.origin !== self.location.origin) return; // pass-through cross-origin

  if (isDataRequest(url)) {
    event.respondWith(handleData(req, url).catch(() => offlineResponse()));
    return;
  }

  event.respondWith(handleShell(req).catch(() => offlineResponse()));
});

function offlineResponse() {
  return new Response('offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// Safely open a cache, returning null if Cache API is broken (rare, but
// happens in some embedded/WebView contexts).
async function safeCache(name) {
  try { return await caches.open(name); }
  catch (_) { return null; }
}

async function safeCachePut(cache, key, response) {
  if (!cache || !response) return;
  try {
    // Some response types (opaque, error) can't be cached. Clone first so
    // the original can still be returned to the page.
    await cache.put(key, response.clone());
  } catch (_) { /* quota / opaque / insecure — swallow */ }
}

async function safeCacheMatch(cache, key, opts) {
  if (!cache) return null;
  try { return (await cache.match(key, opts)) || null; }
  catch (_) { return null; }
}

async function handleShell(req) {
  const cache = await safeCache(APP_SHELL_CACHE);
  const cached = await safeCacheMatch(cache, req, { ignoreSearch: true });
  const network = fetch(req).then((resp) => {
    if (resp && resp.ok) safeCachePut(cache, req, resp);
    return resp;
  }).catch(() => null);
  // Prefer cache if we have it (instant), fall back to network, then offline.
  return cached || (await network) || offlineResponse();
}

// Race a network fetch against a timeout so a hung connection doesn't make
// the page wait forever for data that has a perfectly good cached fallback.
function fetchWithTimeout(req, init, ms) {
  let timer;
  let ctrl;
  let withSignal = init || {};
  if (typeof AbortController !== 'undefined') {
    ctrl = new AbortController();
    withSignal = { ...withSignal, signal: ctrl.signal };
  }
  const fetchP = fetch(req, withSignal);
  const timeoutP = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (ctrl) { try { ctrl.abort(); } catch (_) {} }
      reject(new Error('sw-network-timeout'));
    }, ms);
  });
  return Promise.race([fetchP, timeoutP]).finally(() => clearTimeout(timer));
}

// Network-first for data files: pick up new pipeline deploys when online,
// fall back to the cached copy on failure. The cache write happens under the
// "clean" URL (sans cache-bust query) so subsequent reads hit the new copy.
async function handleData(req, url) {
  const cache = await safeCache(DATA_CACHE);
  const wantsFresh = url.searchParams.get('refresh') === '1';
  const cleanUrl = new URL(url);
  cleanUrl.search = '';
  const cleanKey = cleanUrl.toString();

  try {
    const init = wantsFresh ? { cache: 'no-store' } : {};
    const resp = await fetchWithTimeout(req, init, DATA_NETWORK_TIMEOUT_MS);
    if (resp && resp.ok) {
      // Store under the canonical key so cache-busted requests still update
      // the cached copy other readers will see.
      safeCachePut(cache, cleanKey, resp);
      return resp;
    }
    // Non-OK response — try the cache before propagating.
    const fallback =
      (await safeCacheMatch(cache, cleanKey)) ||
      (await safeCacheMatch(cache, req, { ignoreSearch: true }));
    return fallback || resp || offlineResponse();
  } catch (_) {
    const cached =
      (await safeCacheMatch(cache, cleanKey)) ||
      (await safeCacheMatch(cache, req, { ignoreSearch: true }));
    return cached || offlineResponse();
  }
}

// Silence unhandled rejections in the SW context (some browsers log loudly).
self.addEventListener('unhandledrejection', (ev) => {
  try { ev.preventDefault && ev.preventDefault(); } catch (_) {}
});
