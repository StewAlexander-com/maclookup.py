/* Service worker for the MAC Vendor Lookup PWA.
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS/manifest/icons): cache-first, revalidate in
 *     background so updates land on the next load.
 *   - Registry data (data/registry.json) and metadata sidecar
 *     (data/metadata.json): network-first when online so the app picks up new
 *     pipeline deploys, falling back to the cached copy when the network
 *     fails or the user is offline. A `?refresh=1` query (added by the PWA
 *     manual refresh) bypasses every cache layer (cache: no-store).
 *
 * Bump *_CACHE names when the on-disk format changes so older clients evict
 * stale entries on activate.
 */
const APP_SHELL_CACHE = 'maclookup-shell-v2';
const DATA_CACHE = 'maclookup-data-v2';

const SHELL_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((c) => c.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
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

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // pass-through cross-origin

  if (isDataRequest(url)) {
    event.respondWith(handleData(req, url));
    return;
  }

  event.respondWith(handleShell(req));
});

async function handleShell(req) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((resp) => {
    if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
    return resp;
  }).catch(() => null);
  return cached || (await network) || new Response('offline', { status: 503 });
}

// Network-first for data files: pick up new pipeline deploys when online,
// fall back to the cached copy on failure. The cache write happens under the
// "clean" URL (sans cache-bust query) so subsequent reads hit the new copy.
async function handleData(req, url) {
  const cache = await caches.open(DATA_CACHE);
  const wantsFresh = url.searchParams.get('refresh') === '1';
  const cleanUrl = new URL(url);
  cleanUrl.search = '';
  const cleanKey = cleanUrl.toString();

  try {
    const resp = await fetch(req, wantsFresh ? { cache: 'no-store' } : {});
    if (resp && resp.ok) {
      // Store under the canonical key so cache-busted requests still update
      // the cached copy other readers will see.
      cache.put(cleanKey, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (e) {
    const cached =
      (await cache.match(cleanKey)) ||
      (await cache.match(req, { ignoreSearch: true }));
    if (cached) return cached;
    throw e;
  }
}
