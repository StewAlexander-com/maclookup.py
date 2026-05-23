/* MAC Vendor Lookup PWA — client logic.
 *
 *  - Loads the bundled registry.json (built by scripts/build_web_data.py).
 *  - Hex input → longest-prefix lookup (MA-S 9 hex → MA-M 7 hex → MA-L 6 hex).
 *  - Text input → deterministic fuzzy vendor search.
 *  - Caches the parsed structure in IndexedDB so cold loads don't re-parse the
 *    4-5 MB JSON; the service worker caches the raw file for offline use.
 *  - On startup (and on demand via "Refresh data") the app fetches the small
 *    metadata.json sidecar with `cache: no-store`, compares content_hash with
 *    the persisted copy, and only downloads the full registry when the deploy
 *    is newer. Failures (offline, 404, parse error) keep the last good copy.
 *
 * Defensive posture (every operation that can fail in a weird browser is
 * either feature-detected, timeout-bound, or wrapped so it can't take down
 * the page):
 *   - IndexedDB: feature-detected; private-mode/quota failures degrade to
 *     in-memory only with a visible "no persistence" notice.
 *   - Service worker / Cache API: registration is fire-and-forget; absence
 *     just means no offline.
 *   - fetch(): every network call is wrapped in withTimeout() which uses
 *     AbortController when available and a Promise.race() fallback otherwise.
 *   - Payload validation: rejects corrupt/partial responses but tolerates
 *     extra/unknown fields.
 *   - Parsing: chunked via async yields so the input stays responsive on
 *     low-end devices.
 */

const DATA_URL = 'data/registry.json';
const META_URL = 'data/metadata.json';
const IDB_NAME = 'maclookup';
const IDB_STORE = 'registry';
const IDB_KEY = 'parsed-v2';
const IDB_LEGACY_KEYS = ['parsed-v1'];

const PREFIX_LEN = { 'MA-S': 9, 'MA-M': 7, 'MA-L': 6 };
const REGISTRY_ORDER = ['MA-S', 'MA-M', 'MA-L'];

// Network timeouts (ms). Generous enough for slow mobile data, tight enough
// that a hung server can't lock up startup.
const META_TIMEOUT_MS = 8000;
const DATA_TIMEOUT_MS = 30000;
const IDB_OPEN_TIMEOUT_MS = 4000;

const $ = (sel) => document.querySelector(sel);

const els = {
  query: $('#query'),
  results: $('#results'),
  statusText: $('#status-text'),
  refresh: $('#refresh'),
  dataVersion: $('#data-version'),
};

let state = {
  loaded: false,
  version: null,
  contentHash: null,
  counts: { 'MA-L': 0, 'MA-M': 0, 'MA-S': 0 },
  registries: {},
  searchIndex: [],
  persistent: true, // false if IndexedDB is unavailable / broken
  degradedReason: null,
};

// Outstanding refresh, so we can cancel mid-flight and stay idempotent.
let activeRefresh = null;

// ----------------------- Feature detection -----------------------

const HAS_IDB = (() => {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB; }
  catch (_) { return false; }
})();

const HAS_ABORT = (() => {
  try { return typeof AbortController !== 'undefined'; }
  catch (_) { return false; }
})();

const HAS_SW = (() => {
  try { return typeof navigator !== 'undefined' && 'serviceWorker' in navigator; }
  catch (_) { return false; }
})();

// navigator.onLine is famously lying (returns true on captive portals,
// false on some VPNs). We use it as a hint, never as a hard gate.
function probablyOffline() {
  try { return navigator && navigator.onLine === false; }
  catch (_) { return false; }
}

// ----------------------- Generic helpers -----------------------

// Wrap a promise with a timeout. Uses AbortController when supported so the
// underlying fetch is actually cancelled; otherwise falls back to a passive
// timeout where the original request keeps running but the caller gets
// control back. Returns { signal, run(promiseFactory) } so callers can pass
// the signal directly into fetch() when possible.
function withTimeout(ms, label) {
  let timer;
  let aborted = false;

  if (HAS_ABORT) {
    const ctrl = new AbortController();
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        aborted = true;
        try { ctrl.abort(); } catch (_) {}
        reject(new Error(`${label || 'request'} timed out after ${ms}ms`));
      }, ms);
    });
    return {
      signal: ctrl.signal,
      cancel: () => { try { ctrl.abort(); } catch (_) {} clearTimeout(timer); },
      run(p) {
        return Promise.race([p, timeoutPromise])
          .finally(() => clearTimeout(timer));
      },
      didAbort: () => aborted,
    };
  }

  // Fallback: passive timeout via Promise.race.
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      aborted = true;
      reject(new Error(`${label || 'request'} timed out after ${ms}ms`));
    }, ms);
  });
  return {
    signal: undefined,
    cancel: () => clearTimeout(timer),
    run(p) {
      return Promise.race([p, timeoutPromise])
        .finally(() => clearTimeout(timer));
    },
    didAbort: () => aborted,
  };
}

// Yield control to the event loop so big work doesn't freeze the input.
function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// requestIdleCallback shim (Safari).
const ric = (typeof requestIdleCallback === 'function')
  ? requestIdleCallback
  : (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1);

// ----------------------- IndexedDB cache helpers -----------------------
//
// Every operation:
//   * resolves to a "best effort" value (null on read failure, no-op on write)
//   * is bounded by a timeout so a hung open() doesn't block startup
//   * survives totally absent IndexedDB (HAS_IDB === false)

function idbOpen() {
  if (!HAS_IDB) return Promise.reject(new Error('indexedDB unavailable'));
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(IDB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      try { req.result.createObjectStore(IDB_STORE); }
      catch (e) { /* createObjectStore can throw in private mode */ }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
    req.onblocked = () => reject(new Error('idb open blocked'));
  });
}

function timedIdb(promise) {
  const t = withTimeout(IDB_OPEN_TIMEOUT_MS, 'IndexedDB');
  return t.run(promise);
}

async function idbGet(key = IDB_KEY) {
  if (!HAS_IDB) return null;
  try {
    const db = await timedIdb(idbOpen());
    return await new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, 'readonly'); }
      catch (e) { reject(e); return; }
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    markNoPersistence(e);
    return null;
  }
}

async function idbPut(value, key = IDB_KEY) {
  if (!HAS_IDB || !state.persistent) return;
  try {
    const db = await timedIdb(idbOpen());
    await new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, 'readwrite'); }
      catch (e) { reject(e); return; }
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('idb tx aborted'));
    });
  } catch (e) {
    // Most likely quota exceeded (private mode / disk full). We keep the
    // in-memory copy and warn the user once.
    markNoPersistence(e);
  }
}

async function idbDelete(key) {
  if (!HAS_IDB || !state.persistent) return;
  try {
    const db = await timedIdb(idbOpen());
    await new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, 'readwrite'); }
      catch (e) { reject(e); return; }
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { /* non-fatal */ }
}

let warnedNoPersistence = false;
function markNoPersistence(err) {
  state.persistent = false;
  if (!warnedNoPersistence) {
    warnedNoPersistence = true;
    state.degradedReason = 'storage';
    // Don't blow up the console with stack traces from expected private-mode
    // failures; a single info line is enough for debugging.
    try { console.info('[maclookup] persistence disabled:', err && err.message || err); }
    catch (_) {}
  }
}

// ----------------------- Data loading & parsing -----------------------

// Parse the registry payload. Each registry can have tens of thousands of
// rows, so we yield to the event loop periodically to keep input responsive.
async function parsePayload(payload) {
  const registries = {};
  const searchIndex = [];

  for (const label of REGISTRY_ORDER) {
    const raw = (payload.registries && payload.registries[label]) || '';
    const lookupMap = new Map();
    const list = [];
    if (raw) {
      const lines = raw.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const tab1 = line.indexOf('\t');
        if (tab1 < 0) continue;
        const tab2 = line.indexOf('\t', tab1 + 1);
        const assignment = line.slice(0, tab1);
        const name = tab2 < 0 ? line.slice(tab1 + 1) : line.slice(tab1 + 1, tab2);
        const address = tab2 < 0 ? '' : line.slice(tab2 + 1);
        const entry = {
          registry: label,
          assignment,
          name,
          address,
          _key: name.toLowerCase(),
        };
        lookupMap.set(assignment, entry);
        list.push(entry);
        searchIndex.push(entry);
        // Yield every ~10k rows so we don't block the main thread.
        if ((i & 0x3fff) === 0x3fff) await yieldToEventLoop();
      }
    }
    registries[label] = { lookupMap, list };
  }
  return {
    version: payload.version || null,
    contentHash: payload.content_hash || null,
    counts: payload.counts || {},
    registries,
    searchIndex,
  };
}

function bustUrl(url) {
  // Force a fresh trip through every cache layer (service worker, HTTP, browser).
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}refresh=1&t=${Date.now()}`;
}

async function fetchJson(url, { timeoutMs, noStore = true, label = 'fetch' } = {}) {
  const t = withTimeout(timeoutMs, label);
  const init = {};
  if (noStore) init.cache = 'no-store';
  if (t.signal) init.signal = t.signal;
  let resp;
  try {
    resp = await t.run(fetch(url, init));
  } finally {
    // The race may resolve first; cancel the underlying timer either way.
    t.cancel();
  }
  if (!resp || !resp.ok) {
    const code = resp ? resp.status : 'no-response';
    throw new Error(`${label} HTTP ${code}`);
  }
  // Parsing JSON can itself throw on malformed responses (truncated, HTML
  // error page, etc.). Wrap so the caller gets one consistent error.
  try {
    return await resp.json();
  } catch (e) {
    throw new Error(`${label} parse error: ${e.message || e}`);
  }
}

async function fetchMetadata({ force = false } = {}) {
  const url = force ? bustUrl(META_URL) : META_URL;
  return fetchJson(url, { timeoutMs: META_TIMEOUT_MS, noStore: true, label: 'metadata' });
}

async function fetchRegistry({ force = false } = {}) {
  const url = force ? bustUrl(DATA_URL) : DATA_URL;
  return fetchJson(url, { timeoutMs: DATA_TIMEOUT_MS, noStore: force, label: 'registry' });
}

// Strict-but-tolerant validation. Rejects clearly corrupt/partial payloads
// but allows unknown extra fields so future schema additions don't break old
// clients.
function payloadIsValid(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.registries || typeof payload.registries !== 'object') return false;
  if (!payload.counts || typeof payload.counts !== 'object') return false;

  // counts must be numeric for each known label that's present.
  let total = 0;
  for (const label of REGISTRY_ORDER) {
    const n = payload.counts[label];
    if (n != null && (typeof n !== 'number' || !isFinite(n) || n < 0)) return false;
    total += n || 0;
  }
  if (total <= 0) return false;

  // registries blobs must be strings (or absent → 0 entries).
  for (const label of REGISTRY_ORDER) {
    const blob = payload.registries[label];
    if (blob != null && typeof blob !== 'string') return false;
  }

  // version / content_hash are optional in old caches but should be strings.
  if (payload.version != null && typeof payload.version !== 'string') return false;
  if (payload.content_hash != null && typeof payload.content_hash !== 'string') return false;
  return true;
}

function metadataIsValid(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.content_hash != null && typeof meta.content_hash !== 'string') return false;
  if (meta.version != null && typeof meta.version !== 'string') return false;
  if (meta.counts != null && typeof meta.counts !== 'object') return false;
  // At least one of these must be present for the comparison to be meaningful.
  return !!(meta.content_hash || meta.version || meta.counts);
}

async function loadCachedPayload() {
  let cached = await idbGet(IDB_KEY);
  if (!cached) {
    for (const k of IDB_LEGACY_KEYS) {
      const legacy = await idbGet(k);
      if (legacy) {
        cached = legacy;
        await idbPut(cached, IDB_KEY);
        await idbDelete(k);
        break;
      }
    }
  }
  return cached;
}

async function applyPayload(payload) {
  const parsed = await parsePayload(payload);
  state = { ...state, ...parsed, loaded: true };
  els.dataVersion.textContent = parsed.version || '—';
  els.refresh.disabled = false;
}

function totalCount() {
  return Object.values(state.counts).reduce((a, b) => a + (b || 0), 0);
}

// ----------------------- Sync / freshness -----------------------

/**
 * Compare local persisted data against the deployed bundle and update if
 * different. Never wipes the cached copy on failure.
 *
 * @returns {Promise<'updated'|'fresh'|'offline'|'failed'|'cancelled'>}
 */
async function syncWithRemote({ force = false, signal } = {}) {
  if (probablyOffline()) return 'offline';
  if (signal && signal.aborted) return 'cancelled';

  let remoteMeta;
  try {
    remoteMeta = await fetchMetadata({ force });
  } catch (e) {
    return 'failed';
  }
  if (!metadataIsValid(remoteMeta)) return 'failed';
  if (signal && signal.aborted) return 'cancelled';

  const sameHash =
    state.loaded && state.contentHash && remoteMeta.content_hash &&
    state.contentHash === remoteMeta.content_hash;

  if (sameHash && !force) return 'fresh';

  let payload;
  try {
    payload = await fetchRegistry({ force: true });
  } catch (e) {
    return 'failed';
  }
  if (signal && signal.aborted) return 'cancelled';
  if (!payloadIsValid(payload)) return 'failed';

  // Sanity-check that the registry payload matches the metadata we fetched.
  // If the deploy is mid-flight we might get mismatching files — fall back to
  // the registry's own hash (it's self-describing) and don't trust the meta.
  if (
    remoteMeta.content_hash &&
    payload.content_hash &&
    remoteMeta.content_hash !== payload.content_hash &&
    !force
  ) {
    if (state.contentHash && payload.content_hash === state.contentHash) {
      return 'fresh';
    }
  }

  await applyPayload(payload);
  // Persistence is best-effort: if IDB is broken we still have the new copy
  // in memory and the service worker has the raw bytes cached.
  idbPut(payload).catch(() => {});
  return 'updated';
}

// ----------------------- Lookup & search -----------------------

function normalizeMac(input) {
  return input.replace(/[-:.\s]/g, '').toUpperCase();
}

const HEX_RE = /^[0-9A-F]+$/;

function isHexish(input) {
  const stripped = input.replace(/[-:.\s]/g, '');
  return stripped.length >= 6 && stripped.length <= 12 && HEX_RE.test(stripped.toUpperCase());
}

function longestPrefixLookup(hex) {
  for (const label of REGISTRY_ORDER) {
    const len = PREFIX_LEN[label];
    if (hex.length < len) continue;
    const reg = state.registries[label];
    if (!reg) continue;
    const hit = reg.lookupMap.get(hex.slice(0, len));
    if (hit) return hit;
  }
  return null;
}

// Deterministic fuzzy vendor search.
//   - exact substring: heavy boost, position-weighted
//   - subsequence match: lighter boost
//   - token-prefix boost (each space-separated token)
// Returns top N entries sorted by score, ties broken by name.
function fuzzyVendorSearch(query, limit = 50) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const out = [];

  for (const entry of state.searchIndex) {
    const k = entry._key;
    let score = 0;

    const idx = k.indexOf(q);
    if (idx === 0) score += 1000;
    else if (idx > 0) score += 500 - Math.min(idx, 400);

    if (tokens.length > 1) {
      let allTokensFound = true;
      for (const t of tokens) {
        const ti = k.indexOf(t);
        if (ti < 0) { allTokensFound = false; break; }
        score += 100 - Math.min(ti, 90);
      }
      if (allTokensFound) score += 200;
    }

    if (score === 0 && subsequenceMatch(k, q)) {
      score += 50;
    }

    if (score > 0) {
      if (entry.assignment.toLowerCase() === q) score += 2000;
      out.push({ entry, score });
    }
    if (out.length > 5000) break; // guard
  }

  out.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return out.slice(0, limit).map((x) => x.entry);
}

function subsequenceMatch(haystack, needle) {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

// ----------------------- UI rendering -----------------------

function setStatus(text, cls = '') {
  els.statusText.textContent = text;
  els.statusText.className = cls;
}

function statusSuffix() {
  // Append a "no persistence" badge to status messages when running in a
  // degraded storage mode, so the user knows refreshing won't stick.
  if (!state.persistent) return ' · in-memory only';
  return '';
}

function renderEmpty(msg) {
  els.results.innerHTML = '';
  if (!msg) return;
  const div = document.createElement('div');
  div.className = 'empty';
  div.textContent = msg;
  els.results.appendChild(div);
}

function renderResults(entries, { exact = false } = {}) {
  els.results.innerHTML = '';
  if (entries.length === 0) {
    renderEmpty('No matches.');
    return;
  }
  const frag = document.createDocumentFragment();
  if (exact) {
    frag.appendChild(buildCard(entries[0], true));
  } else {
    for (const e of entries) frag.appendChild(buildCard(e, false));
  }
  els.results.appendChild(frag);
}

function buildCard(entry, exact) {
  const card = document.createElement('article');
  card.className = 'card';

  const tag = document.createElement('span');
  tag.className = `tag ${entry.registry}`;
  tag.textContent = entry.registry;
  card.appendChild(tag);

  const org = document.createElement('div');
  org.className = 'org';
  org.textContent = entry.name;
  card.appendChild(org);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = exact
    ? `Assignment ${entry.assignment} · matched longest prefix`
    : `Assignment ${entry.assignment}`;
  card.appendChild(meta);

  if (entry.address) {
    const addr = document.createElement('div');
    addr.className = 'addr';
    addr.textContent = entry.address;
    card.appendChild(addr);
  }
  return card;
}

function handleQuery(value) {
  if (!state.loaded) {
    renderEmpty('Registry still loading…');
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    renderEmpty(null);
    return;
  }

  if (isHexish(trimmed)) {
    const hex = normalizeMac(trimmed);
    const hit = longestPrefixLookup(hex);
    if (hit) {
      renderResults([hit], { exact: true });
    } else {
      renderEmpty(`No registry entry for prefix ${hex.slice(0, 9)}.`);
    }
    return;
  }

  const matches = fuzzyVendorSearch(trimmed, 50);
  renderResults(matches);
}

// ----------------------- Wire-up -----------------------

let queryTimer = null;
els.query.addEventListener('input', (e) => {
  clearTimeout(queryTimer);
  const v = e.target.value;
  // Debounce a little, then defer the actual search to an idle callback so a
  // heavy keystroke can't drop a frame on low-end devices.
  queryTimer = setTimeout(() => ric(() => handleQuery(v)), 60);
});

els.refresh.addEventListener('click', async () => {
  // Idempotent: clicking again while a refresh is in flight cancels the
  // previous one rather than stacking duplicate fetches.
  if (activeRefresh) {
    try { activeRefresh.cancel(); } catch (_) {}
  }
  if (probablyOffline()) {
    setStatus('Offline — cannot refresh.', 'warn');
    return;
  }
  els.refresh.disabled = true;

  const ctrl = HAS_ABORT ? new AbortController() : null;
  const job = {
    cancel: () => { if (ctrl) try { ctrl.abort(); } catch (_) {} },
  };
  activeRefresh = job;

  setStatus('Checking for updates…');
  try {
    const result = await syncWithRemote({ force: true, signal: ctrl && ctrl.signal });
    if (activeRefresh !== job) return; // superseded
    if (result === 'updated') {
      setStatus(`Refreshed — ${totalCount()} entries.${statusSuffix()}`, 'ok');
    } else if (result === 'fresh') {
      setStatus(`Already up to date — ${totalCount()} entries.${statusSuffix()}`, 'ok');
    } else if (result === 'cancelled') {
      setStatus('Refresh cancelled.', 'warn');
    } else {
      // 'failed' or 'offline' — never clobber existing data.
      setStatus(`Refresh failed — keeping cached data.${statusSuffix()}`, 'warn');
    }
    if (els.query.value) handleQuery(els.query.value);
  } catch (e) {
    setStatus(`Refresh failed: ${(e && e.message) || e}`, 'err');
  } finally {
    if (activeRefresh === job) activeRefresh = null;
    els.refresh.disabled = false;
  }
});

window.addEventListener('online', () => {
  if (!state.loaded) return;
  setStatus(`${totalCount()} entries · online${statusSuffix()}`, 'ok');
  // Opportunistic background sync when connectivity returns. We don't await
  // here — the page stays responsive and any failure is silent.
  syncWithRemote().then((result) => {
    if (result === 'updated') {
      setStatus(`Updated to latest — ${totalCount()} entries.${statusSuffix()}`, 'ok');
      if (els.query.value) handleQuery(els.query.value);
    }
  }).catch(() => { /* keep cached data */ });
});

window.addEventListener('offline', () => {
  if (state.loaded) setStatus(`${totalCount()} entries · offline${statusSuffix()}`, 'warn');
});

// Catch otherwise-unhandled promise rejections so we don't dump red stack
// traces in the console of users on flaky networks.
window.addEventListener('unhandledrejection', (ev) => {
  try { console.info('[maclookup] unhandled rejection:', ev.reason && ev.reason.message || ev.reason); }
  catch (_) {}
});

async function boot() {
  // Service worker registration is fire-and-forget. We never await it: a slow
  // or broken SW must not delay the first paint or the lookup UI.
  if (HAS_SW) {
    try {
      navigator.serviceWorker.register('sw.js').catch(() => { /* no offline */ });
    } catch (_) { /* very old browsers throw synchronously */ }
  }

  // If IDB isn't available at all, surface the degraded mode early.
  if (!HAS_IDB) markNoPersistence(new Error('IndexedDB not supported'));

  // Phase 1: load cached copy for instant cold start. Bounded by IDB timeout.
  let cached = null;
  try {
    cached = await loadCachedPayload();
  } catch (_) { /* idbGet already handles its own errors */ }

  if (cached && payloadIsValid(cached)) {
    try {
      await applyPayload(cached);
      setStatus(`Loaded ${totalCount()} entries from cache.${statusSuffix()}`, 'ok');
      if (els.query.value) handleQuery(els.query.value);
    } catch (e) {
      // Corrupt cache that passed validation but failed during parse — wipe
      // and continue to the network phase.
      try { await idbDelete(IDB_KEY); } catch (_) {}
      state.loaded = false;
    }
  }

  // Phase 2: if online, check the deployed metadata sidecar and update if
  // the content_hash differs from what we have locally. Failures here are
  // non-fatal — we keep whatever we just loaded from cache.
  if (!probablyOffline()) {
    if (!state.loaded) setStatus('Downloading registry…');
    let result;
    try {
      result = await syncWithRemote();
    } catch (_) {
      result = 'failed';
    }

    if (result === 'updated') {
      setStatus(`Loaded ${totalCount()} entries (latest).${statusSuffix()}`, 'ok');
    } else if (result === 'failed' && !state.loaded) {
      setStatus('Could not load registry data.', 'err');
      renderEmpty('Could not load registry data. Connect to the network and reload.');
      els.refresh.disabled = false; // let the user retry
      return;
    } else if (result === 'fresh' && state.loaded) {
      setStatus(`${totalCount()} entries · up to date${statusSuffix()}`, 'ok');
    } else if (result === 'failed' && state.loaded) {
      // Stale-but-usable: we have a cached copy, but the live check failed.
      setStatus(`${totalCount()} entries · using cached data${statusSuffix()}`, 'warn');
    }
    if (els.query.value) handleQuery(els.query.value);
  } else if (!state.loaded) {
    setStatus('Offline and no cached data.', 'err');
    renderEmpty('Offline and no cached data. Connect to the network and reload.');
    els.refresh.disabled = false; // user might come back online
  }
}

// Boot. Wrap so any synchronous throw doesn't kill the whole script load —
// the user still sees the page chrome and the refresh button.
try {
  boot().catch((e) => {
    try { console.info('[maclookup] boot failed:', e && e.message || e); } catch (_) {}
    if (!state.loaded) {
      setStatus('Failed to start up.', 'err');
      renderEmpty('Failed to load. Try refreshing the page.');
      els.refresh.disabled = false;
    }
  });
} catch (e) {
  try { console.info('[maclookup] boot threw:', e && e.message || e); } catch (_) {}
  setStatus('Failed to start up.', 'err');
}
