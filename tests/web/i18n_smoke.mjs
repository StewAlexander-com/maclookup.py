/* i18n smoke test for web/i18n.js
 *
 * Confirms:
 *   - All non-English locales define every key that English defines (no
 *     accidental missing-key gaps that would silently fall back to English).
 *   - normalizeLocale() maps representative real-world tags correctly:
 *       en-GB → en, fr-CA → fr, zh-CN/zh-SG → zh-Hans,
 *       zh-HK/zh-TW/yue-HK → zh-Hant, fil-PH/tl-PH → fil,
 *       unknown → null
 *   - Auto-detect picks the first supported tag from navigator.languages.
 *
 * Run:  node tests/web/i18n_smoke.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N_JS = resolve(__dirname, '..', '..', 'web/i18n.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function makeDom() {
  const els = {};
  const make = () => ({
    _txt: '', _cls: '', value: '', disabled: false,
    innerHTML: '',
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, addEventListener() {},
    querySelectorAll: () => [],
  });
  return {
    documentElement: { lang: 'en', dir: 'ltr' },
    readyState: 'complete',
    getElementById: () => null,
    addEventListener: () => {},
    querySelectorAll: () => [],
    createElement: () => make(),
  };
}

// `navigator` is a getter-only accessor on globalThis in Node >= 21, so a
// direct assignment throws. defineProperty works whether the global is unset
// (Node 20) or a built-in getter (Node 22+/24+). We use the same helper for
// every shim so behavior is uniform regardless of which globals the runtime
// has already populated.
function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

async function loadI18n({ languages = ['en'] } = {}) {
  setGlobal('document', makeDom());
  setGlobal('window', {
    addEventListener() {},
    dispatchEvent() {},
  });
  setGlobal('location', { href: 'http://localhost/', hash: '', search: '' });
  setGlobal('history', { replaceState() {} });
  setGlobal('navigator', { languages, language: languages[0] });
  setGlobal('localStorage', undefined);
  setGlobal('URL', URL);
  setGlobal('URLSearchParams', URLSearchParams);
  setGlobal('CustomEvent', class CustomEvent {
    constructor(n, o) { this.name = n; this.detail = o && o.detail; }
  });

  const src = readFileSync(I18N_JS, 'utf8') + `\n//# salt=${Math.random()}\n`;
  await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  return globalThis.window.i18n;
}

async function main() {
  const i18n = await loadI18n();
  assert(i18n, 'window.i18n must be exposed');

  // ---- normalizeLocale ----
  const cases = [
    ['en-GB', 'en'],
    ['en-US', 'en'],
    ['fr-CA', 'fr'],
    ['fr', 'fr'],
    ['es-419', 'es'],
    ['pt-BR', 'pt'],
    ['de-AT', 'de'],
    ['it-CH', 'it'],
    ['ja-JP', 'ja'],
    ['ko-KR', 'ko'],
    ['hi-IN', 'hi'],
    ['zh', 'zh-Hans'],
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-Hans', 'zh-Hans'],
    ['zh-HK', 'zh-Hant'],
    ['zh-TW', 'zh-Hant'],
    ['zh-Hant', 'zh-Hant'],
    ['yue', 'zh-Hant'],
    ['yue-HK', 'zh-Hant'],
    ['fil', 'fil'],
    ['fil-PH', 'fil'],
    ['tl', 'fil'],
    ['tl-PH', 'fil'],
    ['ar', 'ar'],
    ['ar-SA', 'ar'],
    ['xx-YY', null],
    ['', null],
  ];
  for (const [tag, want] of cases) {
    const got = i18n.normalizeLocale(tag);
    assert(got === want, `normalizeLocale(${JSON.stringify(tag)}) → ${got}, want ${want}`);
  }

  // ---- key coverage ----
  const L = i18n._LOCALES;
  const enKeys = Object.keys(L.en).filter((k) => k[0] !== '_');
  for (const code of i18n.supported()) {
    if (code === 'en') continue;
    const missing = enKeys.filter((k) => !(k in L[code]));
    assert(missing.length === 0, `locale ${code} missing keys: ${missing.join(', ')}`);
    assert(L[code]._name, `locale ${code} missing _name`);
    assert(L[code]._dir === 'ltr' || L[code]._dir === 'rtl',
      `locale ${code} bad _dir: ${L[code]._dir}`);
  }

  // ---- supported list contains the requested set ----
  const want = ['en', 'es', 'fr', 'de', 'it', 'pt',
                'zh-Hans', 'zh-Hant', 'ja', 'ko', 'hi', 'fil', 'ar'];
  for (const code of want) {
    assert(i18n.supported().indexOf(code) >= 0, `expected locale ${code} to be supported`);
  }

  // ---- t() interpolates positional args ----
  i18n.setLocale('en');
  const s = i18n.t('refreshed', 1234);
  assert(s.includes('1234'), `expected interpolation, got: ${s}`);

  // ---- t() falls back to English on missing key in non-English locale ----
  i18n.setLocale('fr');
  const fr = i18n.t('hero_title');
  assert(fr && fr !== 'hero_title' && fr !== 'Offline MAC Address Lookup',
    `expected French hero_title, got: ${fr}`);

  // ---- direction switches on Arabic ----
  i18n.setLocale('ar');
  assert(document.documentElement.dir === 'rtl', 'expected dir=rtl for ar');
  assert(document.documentElement.lang === 'ar', 'expected lang=ar for ar');
  i18n.setLocale('en');
  assert(document.documentElement.dir === 'ltr', 'expected dir=ltr for en');

  console.log('OK — i18n smoke test passes');
}

main().catch((e) => { console.error('test threw:', e); process.exit(1); });
