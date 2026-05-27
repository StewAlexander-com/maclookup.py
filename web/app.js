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
  lastSyncError: null,  // string — surfaces in console/UI when load actually fails
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
// control back.
//
// Important: `disarm()` clears the timer WITHOUT aborting the signal — call
// this once the operation has succeeded so any downstream consumers of the
// same signal (e.g. response body streaming) aren't torn down. `abort()` is
// the explicit cancel and tears everything down.
function withTimeout(ms, label) {
  let timer;
  let aborted = false;
  let disarmed = false;

  if (HAS_ABORT) {
    const ctrl = new AbortController();
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (disarmed) return;
        aborted = true;
        try { ctrl.abort(); } catch (_) {}
        reject(new Error(`${label || 'request'} timed out after ${ms}ms`));
      }, ms);
    });
    return {
      signal: ctrl.signal,
      disarm: () => { disarmed = true; clearTimeout(timer); },
      abort: () => { try { ctrl.abort(); } catch (_) {} clearTimeout(timer); },
      run(p) { return Promise.race([p, timeoutPromise]); },
      didAbort: () => aborted,
    };
  }

  // Fallback: passive timeout via Promise.race.
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (disarmed) return;
      aborted = true;
      reject(new Error(`${label || 'request'} timed out after ${ms}ms`));
    }, ms);
  });
  return {
    signal: undefined,
    disarm: () => { disarmed = true; clearTimeout(timer); },
    abort: () => clearTimeout(timer),
    run(p) { return Promise.race([p, timeoutPromise]); },
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
  return t.run(promise).then(
    (v) => { t.disarm(); return v; },
    (e) => { t.disarm(); throw e; }
  );
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

// Record sync failures so the UI/console can show *why* a load failed
// instead of silently degrading. Logs at warn level so it actually shows up
// in the devtools default view (info is filtered out by default in some
// browsers).
function recordSyncError(stage, err) {
  const msg = (err && err.message) || String(err);
  state.lastSyncError = `${stage}: ${msg}`;
  try { console.warn('[maclookup] sync failed —', state.lastSyncError); } catch (_) {}
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
  // One timeout covers both the request AND the body read: in the browser,
  // `fetch()` resolves with headers only; the body is still streaming and
  // aborting the controller between fetch() and resp.json() throws AbortError
  // when the JSON parser tries to read the body. So we keep the timer armed
  // until we have the parsed value, then `disarm()` (leave signal alone).
  const t = withTimeout(timeoutMs, label);
  const init = {};
  if (noStore) init.cache = 'no-store';
  if (t.signal) init.signal = t.signal;

  let resp;
  try {
    resp = await t.run(fetch(url, init));
  } catch (e) {
    t.abort();
    throw e;
  }
  if (!resp || !resp.ok) {
    t.abort();
    const code = resp ? resp.status : 'no-response';
    throw new Error(`${label} HTTP ${code}`);
  }
  // Parsing JSON can itself throw on malformed responses (truncated, HTML
  // error page, etc.). Wrap so the caller gets one consistent error.
  let parsed;
  try {
    parsed = await t.run(resp.json());
  } catch (e) {
    t.abort();
    throw new Error(`${label} parse error: ${(e && e.message) || e}`);
  }
  t.disarm();
  return parsed;
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
    recordSyncError('metadata fetch', e);
    return 'failed';
  }
  if (!metadataIsValid(remoteMeta)) {
    recordSyncError('metadata validation', new Error('metadata missing required fields'));
    return 'failed';
  }
  if (signal && signal.aborted) return 'cancelled';

  const sameHash =
    state.loaded && state.contentHash && remoteMeta.content_hash &&
    state.contentHash === remoteMeta.content_hash;

  if (sameHash && !force) return 'fresh';

  let payload;
  try {
    payload = await fetchRegistry({ force: true });
  } catch (e) {
    recordSyncError('registry fetch', e);
    return 'failed';
  }
  if (signal && signal.aborted) return 'cancelled';
  if (!payloadIsValid(payload)) {
    recordSyncError('registry validation', new Error('registry payload rejected as invalid'));
    return 'failed';
  }
  // Clear the last error on success so stale messages don't linger.
  state.lastSyncError = null;

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

const SEPARATORS_RE = /[-:.\s]/g;
// Label prefixes shipped by switches/routers/OS dialogs that wrap a MAC.
// Stripped before extraction so "MAC Address: 00:1a:..." normalizes cleanly.
const LABEL_RE =
  /\b(?:mac(?:\s*address)?|hardware\s*address|hwaddr|ether(?:net)?(?:\s*address)?|physical\s*address|bia|burned[- ]?in[- ]?address)\s*[:=]?\s*/gi;
// Common wrapping characters around a MAC in CLI output / pasted text.
const WRAPPER_CHARS_RE = /[()\[\]<>{}"'`,;]/g;
// A contiguous run of hex characters and the common separators.
const HEX_RUN_RE = /[0-9A-Fa-f]+(?:[-:.\s][0-9A-Fa-f]+)*/g;

function normalizeMac(input) {
  return input.replace(SEPARATORS_RE, '').toUpperCase();
}

// Pull a MAC-shaped hex run out of free-form text. Mirrors the Python
// extract_mac_candidate(): returns the longest plausibly-MAC-sized
// (6-12 hex chars) run found, uppercased and stripped of separators, or
// null if nothing qualifies.
function extractMacCandidate(text) {
  if (!text) return null;
  const stripped = text
    .replace(LABEL_RE, ' ')
    .replace(WRAPPER_CHARS_RE, ' ');
  let best = '';
  let m;
  HEX_RUN_RE.lastIndex = 0;
  while ((m = HEX_RUN_RE.exec(stripped)) !== null) {
    const hexOnly = m[0].replace(SEPARATORS_RE, '');
    if (hexOnly.length >= 6 && hexOnly.length <= 12 && hexOnly.length > best.length) {
      best = hexOnly;
    }
  }
  return best ? best.toUpperCase() : null;
}

const HEX_RE = /^[0-9A-F]+$/;

// Treat input as a MAC lookup if either (a) it's pure hex-with-separators
// matching a MAC/prefix size, or (b) it has a labelled/wrapped MAC inside
// it (e.g. "MAC Address: 00:1a:2b:3c:4d:5e", "(00-1A-...)", "ether 001a...").
// The second branch is gated on the label/wrapper actually being present so
// genuine vendor queries like "3com" or "Apple" stay in the fuzzy path.
function isHexish(input) {
  const stripped = input.replace(SEPARATORS_RE, '');
  if (stripped.length >= 6 && stripped.length <= 12 && HEX_RE.test(stripped.toUpperCase())) {
    return true;
  }
  const hasLabel = LABEL_RE.test(input);
  LABEL_RE.lastIndex = 0; // reset because /g state is sticky
  const hasWrapper = WRAPPER_CHARS_RE.test(input);
  WRAPPER_CHARS_RE.lastIndex = 0;
  if (hasLabel || hasWrapper) {
    return extractMacCandidate(input) !== null;
  }
  return false;
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

// Translate via i18n module if available, otherwise return the fallback as-is.
// Keeping a thin local wrapper means status calls don't have to check for
// window.i18n every time.
function tr(key, fallback, ...args) {
  try {
    if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
      const out = window.i18n.t(key, ...args);
      if (out && out !== key) return out;
    }
  } catch (_) { /* ignore */ }
  // Local fallback formatting matches i18n.js {0}, {1}…
  let s = fallback;
  for (let i = 0; i < args.length; i++) {
    s = s.split('{' + i + '}').join(String(args[i]));
  }
  return s;
}

function setStatus(text, cls = '') {
  els.statusText.textContent = text;
  els.statusText.className = cls;
  // Remember the last status so we can re-render on language change.
  state.lastStatus = { text, cls };
}

// For status calls that should be re-translatable when the user switches
// languages, pass a render function instead of pre-computed text.
function setStatusRender(fn, cls = '') {
  state.lastStatusRender = { fn, cls };
  setStatus(fn(), cls);
}

function statusSuffix() {
  // Append a "no persistence" badge to status messages when running in a
  // degraded storage mode, so the user knows refreshing won't stick.
  if (!state.persistent) return ' · ' + tr('in_memory_only', 'in-memory only');
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
    renderEmpty(tr('no_matches', 'No matches.'));
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
    renderEmpty(tr('registry_loading', 'Registry still loading…'));
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    renderEmpty(null);
    return;
  }

  if (isHexish(trimmed)) {
    // If the raw input had a label/wrapper, normalizeMac alone would leave
    // non-hex letters (e.g. "MACADDRESS001A2B"); prefer the extracted
    // candidate so labelled inputs round-trip correctly.
    let hex = normalizeMac(trimmed);
    if (!HEX_RE.test(hex)) {
      const candidate = extractMacCandidate(trimmed);
      if (candidate) hex = candidate;
    }
    const hit = longestPrefixLookup(hex);
    if (hit) {
      renderResults([hit], { exact: true });
    } else {
      renderEmpty(tr('no_prefix', 'No registry entry for prefix {0}.', hex.slice(0, 9)));
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
    setStatus(tr('offline_cannot_refresh', 'Offline — cannot refresh.'), 'warn');
    return;
  }
  els.refresh.disabled = true;

  const ctrl = HAS_ABORT ? new AbortController() : null;
  const job = {
    cancel: () => { if (ctrl) try { ctrl.abort(); } catch (_) {} },
  };
  activeRefresh = job;

  setStatus(tr('checking_updates', 'Checking for updates…'));
  try {
    const result = await syncWithRemote({ force: true, signal: ctrl && ctrl.signal });
    if (activeRefresh !== job) return; // superseded
    if (result === 'updated') {
      setStatus(tr('refreshed', 'Refreshed — {0} entries.', totalCount()) + statusSuffix(), 'ok');
    } else if (result === 'fresh') {
      setStatus(tr('already_up_to_date', 'Already up to date — {0} entries.', totalCount()) + statusSuffix(), 'ok');
    } else if (result === 'cancelled') {
      setStatus(tr('refresh_cancelled', 'Refresh cancelled.'), 'warn');
    } else {
      // 'failed' or 'offline' — never clobber existing data.
      setStatus(tr('refresh_failed_keeping', 'Refresh failed — keeping cached data.') + statusSuffix(), 'warn');
    }
    if (els.query.value) handleQuery(els.query.value);
  } catch (e) {
    setStatus(tr('refresh_failed', 'Refresh failed: {0}', (e && e.message) || e), 'err');
  } finally {
    if (activeRefresh === job) activeRefresh = null;
    els.refresh.disabled = false;
  }
});

window.addEventListener('online', () => {
  if (!state.loaded) return;
  setStatus(tr('entries_online', '{0} entries · online', totalCount()) + statusSuffix(), 'ok');
  // Opportunistic background sync when connectivity returns. We don't await
  // here — the page stays responsive and any failure is silent.
  syncWithRemote().then((result) => {
    if (result === 'updated') {
      setStatus(tr('updated_latest', 'Updated to latest — {0} entries.', totalCount()) + statusSuffix(), 'ok');
      if (els.query.value) handleQuery(els.query.value);
    }
  }).catch(() => { /* keep cached data */ });
});

window.addEventListener('offline', () => {
  if (state.loaded) setStatus(tr('entries_offline', '{0} entries · offline', totalCount()) + statusSuffix(), 'warn');
});

// Re-render the last status message when the user switches languages so the
// visible text updates immediately. We re-evaluate translation rather than
// keep raw English around.
try {
  window.addEventListener('i18n:changed', () => {
    if (state.lastStatusRender && typeof state.lastStatusRender.fn === 'function') {
      setStatus(state.lastStatusRender.fn(), state.lastStatusRender.cls);
    }
  });
} catch (_) {}

// Catch otherwise-unhandled promise rejections so they don't dump raw stack
// traces but DO show up in the console at warn level — we want to hear about
// these in dev/QA, not silently swallow them.
window.addEventListener('unhandledrejection', (ev) => {
  try { console.warn('[maclookup] unhandled rejection:', (ev.reason && ev.reason.message) || ev.reason); }
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
      setStatus(tr('loaded_from_cache', 'Loaded {0} entries from cache.', totalCount()) + statusSuffix(), 'ok');
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
    if (!state.loaded) setStatus(tr('downloading', 'Downloading registry…'));
    let result;
    try {
      result = await syncWithRemote();
    } catch (_) {
      result = 'failed';
    }

    if (result === 'updated') {
      setStatus(tr('loaded_latest', 'Loaded {0} entries (latest).', totalCount()) + statusSuffix(), 'ok');
    } else if (result === 'failed' && !state.loaded) {
      const reason = state.lastSyncError ? ` (${state.lastSyncError})` : '';
      setStatus(tr('could_not_load', 'Could not load registry data{0}.', reason), 'err');
      renderEmpty(tr('could_not_load_reload', 'Could not load registry data{0}. Connect to the network and reload.', reason));
      els.refresh.disabled = false; // let the user retry
      return;
    } else if (result === 'fresh' && state.loaded) {
      setStatus(tr('up_to_date', '{0} entries · up to date', totalCount()) + statusSuffix(), 'ok');
    } else if (result === 'failed' && state.loaded) {
      // Stale-but-usable: we have a cached copy, but the live check failed.
      setStatus(tr('using_cached', '{0} entries · using cached data', totalCount()) + statusSuffix(), 'warn');
    }
    if (els.query.value) handleQuery(els.query.value);
  } else if (!state.loaded) {
    setStatus(tr('offline_no_cache', 'Offline and no cached data.'), 'err');
    renderEmpty(tr('offline_no_cache_reload', 'Offline and no cached data. Connect to the network and reload.'));
    els.refresh.disabled = false; // user might come back online
  }
}

// Boot. Wrap so any synchronous throw doesn't kill the whole script load —
// the user still sees the page chrome and the refresh button.
try {
  boot().catch((e) => {
    try { console.info('[maclookup] boot failed:', e && e.message || e); } catch (_) {}
    if (!state.loaded) {
      setStatus(tr('failed_startup', 'Failed to start up.'), 'err');
      renderEmpty(tr('failed_load_refresh', 'Failed to load. Try refreshing the page.'));
      els.refresh.disabled = false;
    }
  });
} catch (e) {
  try { console.info('[maclookup] boot threw:', e && e.message || e); } catch (_) {}
  setStatus(tr('failed_startup', 'Failed to start up.'), 'err');
}
