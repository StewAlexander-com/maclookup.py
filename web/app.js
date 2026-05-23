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
 */

const DATA_URL = 'data/registry.json';
const META_URL = 'data/metadata.json';
const IDB_NAME = 'maclookup';
const IDB_STORE = 'registry';
const IDB_KEY = 'parsed-v2';
const IDB_LEGACY_KEYS = ['parsed-v1'];

const PREFIX_LEN = { 'MA-S': 9, 'MA-M': 7, 'MA-L': 6 };
const REGISTRY_ORDER = ['MA-S', 'MA-M', 'MA-L'];

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
};

// ----------------------- IndexedDB cache helpers -----------------------

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key = IDB_KEY) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

async function idbPut(value, key = IDB_KEY) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* non-fatal */ }
}

async function idbDelete(key) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* non-fatal */ }
}

// ----------------------- Data loading & parsing -----------------------

function parsePayload(payload) {
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

async function fetchMetadata({ force = false } = {}) {
  const url = force ? bustUrl(META_URL) : META_URL;
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`metadata HTTP ${resp.status}`);
  return await resp.json();
}

async function fetchRegistry({ force = false } = {}) {
  const url = force ? bustUrl(DATA_URL) : DATA_URL;
  const resp = await fetch(url, force ? { cache: 'no-store' } : {});
  if (!resp.ok) throw new Error(`registry HTTP ${resp.status}`);
  return await resp.json();
}

function payloadIsValid(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.registries || typeof payload.registries !== 'object') return false;
  if (!payload.counts || typeof payload.counts !== 'object') return false;
  // At least one registry must have rows; otherwise reject as corrupt.
  const total = Object.values(payload.counts).reduce((a, b) => a + (b || 0), 0);
  return total > 0;
}

async function loadCachedPayload() {
  let cached = await idbGet(IDB_KEY);
  if (!cached) {
    // Migrate from previous cache key(s).
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
  const parsed = parsePayload(payload);
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
 * @param {{force?: boolean}} opts force=true bypasses every cache layer.
 * @returns {Promise<'updated'|'fresh'|'offline'|'failed'>}
 */
async function syncWithRemote({ force = false } = {}) {
  if (!navigator.onLine) return 'offline';

  let remoteMeta;
  try {
    remoteMeta = await fetchMetadata({ force });
  } catch (e) {
    return 'failed';
  }

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
    // Mid-deploy: only persist if this is a real change from what we have.
    if (state.contentHash && payload.content_hash === state.contentHash) {
      return 'fresh';
    }
  }

  await applyPayload(payload);
  await idbPut(payload);
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
  queryTimer = setTimeout(() => handleQuery(v), 60);
});

els.refresh.addEventListener('click', async () => {
  if (!navigator.onLine) {
    setStatus('Offline — cannot refresh.', 'warn');
    return;
  }
  els.refresh.disabled = true;
  setStatus('Checking for updates…');
  try {
    const result = await syncWithRemote({ force: true });
    if (result === 'updated') {
      setStatus(`Refreshed — ${totalCount()} entries.`, 'ok');
    } else if (result === 'fresh') {
      setStatus(`Already up to date — ${totalCount()} entries.`, 'ok');
    } else {
      setStatus('Refresh failed — keeping cached data.', 'warn');
    }
    if (els.query.value) handleQuery(els.query.value);
  } catch (e) {
    setStatus(`Refresh failed: ${e.message}`, 'err');
  } finally {
    els.refresh.disabled = false;
  }
});

window.addEventListener('online', async () => {
  if (!state.loaded) return;
  setStatus(`${totalCount()} entries · online`, 'ok');
  // Opportunistic background sync when connectivity returns.
  try {
    const result = await syncWithRemote();
    if (result === 'updated') {
      setStatus(`Updated to latest — ${totalCount()} entries.`, 'ok');
      if (els.query.value) handleQuery(els.query.value);
    }
  } catch (e) { /* keep cached data */ }
});
window.addEventListener('offline', () => {
  if (state.loaded) setStatus(`${totalCount()} entries · offline`, 'warn');
});

async function boot() {
  // Register service worker (PWA install + offline).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Phase 1: load cached copy for instant cold start.
  const cached = await loadCachedPayload();
  if (cached && payloadIsValid(cached)) {
    await applyPayload(cached);
    setStatus(`Loaded ${totalCount()} entries from cache.`, 'ok');
    if (els.query.value) handleQuery(els.query.value);
  }

  // Phase 2: if online, check the deployed metadata sidecar and update if
  // the content_hash differs from what we have locally. Failures here are
  // non-fatal — we keep whatever we just loaded from cache.
  if (navigator.onLine) {
    if (!state.loaded) setStatus('Downloading registry…');
    const result = await syncWithRemote();
    if (result === 'updated') {
      setStatus(`Loaded ${totalCount()} entries (latest).`, 'ok');
    } else if (result === 'failed' && !state.loaded) {
      setStatus('Could not load registry data.', 'err');
      renderEmpty('Could not load registry data. Connect to the network and reload.');
      return;
    } else if (result === 'fresh' && state.loaded) {
      setStatus(`${totalCount()} entries · up to date`, 'ok');
    }
    if (els.query.value) handleQuery(els.query.value);
  } else if (!state.loaded) {
    setStatus('Offline and no cached data.', 'err');
    renderEmpty('Offline and no cached data. Connect to the network and reload.');
  }
}

boot();
