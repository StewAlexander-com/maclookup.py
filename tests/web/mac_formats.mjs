/* MAC format smoke test for web/app.js.
 *
 * Verifies that the JS frontend accepts the same MAC formats the Python
 * backend does:
 *   - colon / hyphen / Cisco dotted / plain hex / space-separated / mixed case
 *   - labelled forms ("MAC Address: ...", "HWaddr ...", ifconfig/ipconfig)
 *   - bracketed/wrapped forms
 *   - prefix-only inputs (MA-L 6, MA-M 7, MA-S 9 hex chars)
 *   - vendor text (e.g. "cisco", "3com", "Apple") still routes to fuzzy
 *
 * Strategy: app.js is a module that touches document at import time, so we
 * lift the pure helpers (normalizeMac, extractMacCandidate, isHexish) out of
 * its source and evaluate them in isolation. This avoids needing a DOM stub.
 *
 * Run:  node tests/web/mac_formats.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = resolve(__dirname, '..', '..', 'web/app.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

const src = readFileSync(APP_JS, 'utf8');

// Extract the regex constants + helper functions verbatim and eval them.
// The block we need starts at SEPARATORS_RE and ends just after isHexish().
const startIdx = src.indexOf('const SEPARATORS_RE');
const endMarker = '\nfunction longestPrefixLookup';
const endIdx = src.indexOf(endMarker);
assert(startIdx >= 0 && endIdx > startIdx,
       `could not locate helper block in app.js (start=${startIdx}, end=${endIdx})`);
const block = src.slice(startIdx, endIdx);

// Evaluate inside a Function so we control the exports.
const factory = new Function(`
  ${block}
  return { normalizeMac, extractMacCandidate, isHexish };
`);
const { normalizeMac, extractMacCandidate, isHexish } = factory();

// ---- normalizeMac symmetry with the Python normalize_mac ----
assert(normalizeMac('00:1A:2B:3C:4D:5E') === '001A2B3C4D5E', 'colon');
assert(normalizeMac('00-1a-2b-3c-4d-5e') === '001A2B3C4D5E', 'hyphen lower');
assert(normalizeMac('001a.2b3c.4d5e') === '001A2B3C4D5E', 'cisco dotted');
assert(normalizeMac('001A2B3C4D5E') === '001A2B3C4D5E', 'plain hex');
assert(normalizeMac('  00 1a 2b 3c 4d 5e ') === '001A2B3C4D5E', 'spaces');

// ---- extractMacCandidate ----
const ex = extractMacCandidate;
assert(ex('00:1A:2B:3C:4D:5E') === '001A2B3C4D5E', 'extract colon');
assert(ex('00-1A-2B-3C-4D-5E') === '001A2B3C4D5E', 'extract hyphen');
assert(ex('001a.2b3c.4d5e') === '001A2B3C4D5E', 'extract cisco');
assert(ex('001A2B3C4D5E') === '001A2B3C4D5E', 'extract plain');
assert(ex('MAC Address: 00:1A:2B:3C:4D:5E') === '001A2B3C4D5E', 'extract labelled');
assert(ex('MAC: 00-1A-2B-3C-4D-5E') === '001A2B3C4D5E', 'extract MAC: prefix');
assert(ex('Hardware Address 0000.0011.2233') === '000000112233',
       'extract Hardware Address');
assert(ex('HWaddr 00:00:00:11:22:33') === '000000112233', 'extract HWaddr');
assert(ex('Physical Address. . . . . : 00-00-00-11-22-33') === '000000112233',
       'extract ipconfig style');
assert(ex('ether 00:00:00:11:22:33  txqueuelen 1000') === '000000112233',
       'extract ifconfig style');
assert(ex('(00:1A:2B:3C:4D:5E)') === '001A2B3C4D5E', 'extract parens');
assert(ex('[00-1A-2B-3C-4D-5E]') === '001A2B3C4D5E', 'extract brackets');
assert(ex('<00:1A:2B:3C:4D:5E>') === '001A2B3C4D5E', 'extract angle brackets');
assert(ex('001A2B') === '001A2B', 'extract MA-L prefix');
assert(ex('001A2B3') === '001A2B3', 'extract MA-M prefix (7 hex)');
assert(ex('001A2B3C4') === '001A2B3C4', 'extract MA-S prefix (9 hex)');

// Vendor text — should NOT be treated as a MAC
assert(ex('') === null, 'empty returns null');
assert(ex('   ') === null, 'whitespace returns null');
assert(ex('3com') === null, '3com (only 2 hex chars contiguous)');
assert(ex('Apple Inc') === null, 'Apple Inc returns null');
assert(ex('cisco') === null, 'cisco returns null');

// Longest run wins
assert(ex('GigabitEthernet0/1 MAC 00:1A:2B:3C:4D:5E up') === '001A2B3C4D5E',
       'extract picks longest run');

// ---- isHexish ----
assert(isHexish('00:1A:2B:3C:4D:5E') === true, 'isHexish colon');
assert(isHexish('001A2B3C4D5E') === true, 'isHexish plain');
assert(isHexish('001A2B') === true, 'isHexish prefix');
assert(isHexish('001A2B3') === true, 'isHexish MA-M prefix');
assert(isHexish('001A2B3C4') === true, 'isHexish MA-S prefix');
assert(isHexish('MAC Address: 00:1A:2B:3C:4D:5E') === true,
       'isHexish labelled');
assert(isHexish('(00-1A-2B-3C-4D-5E)') === true, 'isHexish wrapped');
assert(isHexish('Hardware Address 0000.0011.2233') === true,
       'isHexish ifconfig');
// vendor queries — must route to fuzzy
assert(isHexish('cisco') === false, 'isHexish cisco → false');
assert(isHexish('Apple') === false, 'isHexish Apple → false');
assert(isHexish('3com') === false, 'isHexish 3com → false');
assert(isHexish('intel corporation') === false,
       'isHexish vendor phrase → false');

console.log('mac_formats.mjs OK');
