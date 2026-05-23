/* Service worker for the MAC Vendor Lookup PWA.
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS/manifest/icons): cache-first, revalidate in
 *     background so updates land on the next load.
 *   - Registry data file (data/registry.json): cache-first too, so the app
 *     works fully offline. The page UI exposes a "Refresh data" button which
 *     calls skipCache=true via a query param, letting the user pull the
 *     freshest registry on demand when online.
 */
const APP_SHELL_CACHE = 'maclookup-shell-v1';
const DATA_CACHE = 'maclookup-data-v1';

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
      || url.pathname.endsWith('data/registry.json');
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

async function handleData(req, url) {
  const cache = await caches.open(DATA_CACHE);
  const wantsFresh = url.searchParams.get('refresh') === '1';

  if (wantsFresh) {
    try {
      const resp = await fetch(req, { cache: 'no-store' });
      if (resp && resp.ok) {
        // Cache under the clean URL so subsequent reads hit the new copy.
        const cleanUrl = new URL(url);
        cleanUrl.search = '';
        await cache.put(cleanUrl.toString(), resp.clone());
      }
      return resp;
    } catch (e) {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      throw e;
    }
  }

  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  const resp = await fetch(req);
  if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
  return resp;
}
