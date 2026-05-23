/* Fresh-load smoke test for web/app.js.
 *
 * Simulates the exact path that regressed in PR #4: a Playwright fresh
 * context with no IndexedDB cache, both data files served by HTTP (so
 * Response bodies are real streams, not pre-resolved objects). The bug we
 * caught: fetchJson() was aborting the AbortController after the fetch()
 * resolved but before resp.json() read the body — which works in Node-with-
 * pre-resolved-stubs but fails in real browsers/undici because aborting tears
 * down the body stream. The test below would have caught it.
 *
 * Run:  node tests/web/fresh_load.mjs
 * Exits non-zero on failure.
 */
import { readFileSync, createReadStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const APP_JS = resolve(REPO, 'web/app.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// Start a local HTTP server that streams the real web/data/*.json files so
// Response bodies behave the way they do in a browser (chunked, signal-tied).
async function startServer() {
  const server = http.createServer((req, res) => {
    let path;
    if (req.url.includes('metadata.json')) path = resolve(REPO, 'web/data/metadata.json');
    else if (req.url.includes('registry.json')) path = resolve(REPO, 'web/data/registry.json');
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    createReadStream(path).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${server.address().port}/` };
}

// Minimal DOM stub matching the elements app.js looks up. Status writes are
// recorded so we can assert on the sequence the user would see.
function makeDom() {
  const statusCalls = [];
  const els = {};
  const make = (id) => {
    const el = {
      _id: id,
      _cls: '',
      value: '',
      disabled: true,
      innerHTML: '',
      _children: [],
      addEventListener() {},
      appendChild(c) { this._children.push(c); },
    };
    Object.defineProperty(el, 'className', {
      get() { return el._cls; },
      set(v) { el._cls = v; },
    });
    Object.defineProperty(el, 'textContent', {
      get() { return el._txt || ''; },
      set(v) {
        el._txt = v;
        if (id === 'status-text') statusCalls.push({ text: v, cls: el._cls });
      },
    });
    return el;
  };
  els.query = make('query');
  els.results = make('results');
  els.statusText = make('status-text');
  els.refresh = make('refresh');
  els.dataVersion = make('data-version');
  const lookup = {
    '#query': els.query,
    '#results': els.results,
    '#status-text': els.statusText,
    '#refresh': els.refresh,
    '#data-version': els.dataVersion,
  };
  return {
    statusCalls,
    els,
    document: {
      querySelector: (s) => lookup[s],
      createElement: () => make('div'),
      createDocumentFragment: () => make('frag'),
    },
  };
}

async function loadApp({ haveIDB = false, baseUrl } = {}) {
  const dom = makeDom();
  globalThis.document = dom.document;
  globalThis.window = { addEventListener() {} };
  globalThis.navigator = { onLine: true };
  globalThis.indexedDB = haveIDB ? globalThis.__realIDB : undefined;

  // Redirect data/*.json fetches to the local HTTP server so abort semantics
  // are real (browser-style streaming). Node 18+ exposes fetch globally.
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (u.startsWith('data/')) {
      const path = u.replace(/^data\//, '').split('?')[0];
      return realFetch(baseUrl + path, init);
    }
    return realFetch(u, init);
  };

  // Inject a fresh comment so the data URL is unique per loadApp() call —
  // otherwise Node's ESM loader caches the previous evaluation.
  const src = readFileSync(APP_JS, 'utf8') + `\n//# salt=${Math.random()}\n`;
  await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

  // Let async boot drain.
  await new Promise((r) => setTimeout(r, 1500));
  return dom;
}

async function main() {
  const { server, base } = await startServer();
  try {
    // Fresh context, no IDB, with AbortController. This is the exact regression
    // path from PR #4: the AbortController-after-fetch tore down the body
    // stream, fetchJson threw AbortError, and the user saw "Could not load
    // registry data" despite both data files being served 200 OK. Fixing
    // requires keeping the timeout armed across fetch()+resp.json() and only
    // disarming on success, never abort()-ing post-success.
    const dom = await loadApp({ haveIDB: false, baseUrl: base });
    const final = dom.statusCalls[dom.statusCalls.length - 1];
    console.log('statuses:', dom.statusCalls.map((s) => s.text));
    assert(final && /Loaded \d+ entries \(latest\)/.test(final.text),
      `expected "Loaded N entries (latest)", got: ${final && final.text}`);
    assert(/in-memory only/.test(final.text),
      `expected "in-memory only" badge in fresh-no-IDB load, got: ${final.text}`);
    // Sanity: at least one status had to be the "Downloading registry…" step.
    assert(dom.statusCalls.some((s) => /Downloading registry/.test(s.text)),
      'expected "Downloading registry…" intermediate status');

    console.log('OK — fresh-load smoke test passes');
  } finally {
    server.close();
  }
}

main().catch((e) => {
  console.error('test threw:', e);
  process.exit(1);
});
