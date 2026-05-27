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
  return { normalizeMac, extractMacCandidate, extractMacCandidates, isHexish };
`);
const { normalizeMac, extractMacCandidate, extractMacCandidates, isHexish } = factory();

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

// ---- Hardening: OCR typos in clearly-MAC-shaped tokens ----
const ocrCases = [
  // [input, expected_hex, expected_ocr_flag]
  ['OO:1A:7D:AA:BB:CC', '001A7DAABBCC', true],
  ['oo:1a:7d:aa:bb:cc', '001A7DAABBCC', true],
  ['IO:1A:7D:AA:BB:CC', '101A7DAABBCC', true],
  // No separators, not MAC-shaped → no OCR fix, must stay rejected.
];
for (const [input, expected, ocrFlag] of ocrCases) {
  const cands = extractMacCandidates(input);
  assert(cands.length > 0, `OCR: expected candidate for ${JSON.stringify(input)}`);
  assert(cands[0].hex === expected,
         `OCR: ${JSON.stringify(input)} → ${cands[0].hex}, want ${expected}`);
  assert(cands[0].ocr === ocrFlag,
         `OCR: ${JSON.stringify(input)} ocr=${cands[0].ocr}, want ${ocrFlag}`);
}

// ---- Hardening: multiple MAC candidates pasted together ----
const multi = extractMacCandidates('00:1A:7D:AA:BB:CC, 00:00:00:11:22:33');
const multiHexes = multi.map((c) => c.hex);
assert(multiHexes.includes('001A7DAABBCC'),
       `multi-candidate missing 001A7DAABBCC: ${JSON.stringify(multiHexes)}`);
assert(multiHexes.includes('000000112233'),
       `multi-candidate missing 000000112233: ${JSON.stringify(multiHexes)}`);

// Newline-separated MACs (common from pasted CLI output).
const multiNL = extractMacCandidates('aa:bb:cc:dd:ee:ff\nfoo\n11:22:33:44:55:66');
const multiNLHexes = multiNL.map((c) => c.hex);
assert(multiNLHexes.includes('AABBCCDDEEFF'),
       `newline-paste missing AABBCCDDEEFF: ${JSON.stringify(multiNLHexes)}`);
assert(multiNLHexes.includes('112233445566'),
       `newline-paste missing 112233445566: ${JSON.stringify(multiNLHexes)}`);

// ---- Hardening: trailing/leading punctuation stripped ----
assert(extractMacCandidate('00 1A 7D AA BB CC.') === '001A7DAABBCC',
       'trailing dot stripped');
assert(extractMacCandidate('001a.2b3c.') === '001A2B3C',
       'trailing dot on cisco-style stripped');
assert(extractMacCandidate('.00:1A:7D:AA:BB:CC') === '001A7DAABBCC',
       'leading dot stripped');

// ---- Hardening: ambiguous-too-short input rejected ----
assert(extractMacCandidate('001A') === null, '4 hex chars below floor');
assert(extractMacCandidate('00:1A') === null, '4 hex chars with colon below floor');
assert(extractMacCandidate('a') === null, '1 char below floor');

// ---- Hardening: pure-hex 12 chars that *isn't* a label-context input ----
// "face0123abcd" — 12 hex chars, no other context. We DO surface it (the user
// might be looking up a real MAC that coincidentally reads like a word) but
// only when nothing else is more plausible.
assert(extractMacCandidate('face0123abcd') === 'FACE0123ABCD',
       'plain 12-hex string surfaced as a candidate');
// But a vendor-word query without 6+ contiguous hex stays out.
assert(extractMacCandidate('face') === null, '4-letter face not a candidate');

// ---- Hardening: phone numbers / mixed-size pure-digit tokens rejected ----
// Real-world false positive: '1-800-555-1234' has hyphens and 11 digits
// (all hex-valid) and used to clean to a fake MAC. The group-uniformity
// guard rejects pure-digit tokens whose groups aren't all 2 or all 4 chars.
const phones = [
  '1-800-555-1234',
  '(415) 555-1212',
  '+44-20-7946-0958',
];
for (const phone of phones) {
  assert(extractMacCandidate(phone) === null,
         `phone number leaked as MAC: ${JSON.stringify(phone)}`);
}
// But genuine all-digit MACs (groups uniformly sized) must still resolve.
assert(extractMacCandidate('01:23:45:67:89:01') === '012345678901',
       'all-digit MAC with 2-char groups still resolves');
assert(extractMacCandidate('0123.4567.8901') === '012345678901',
       'all-digit Cisco-style MAC still resolves');

// ---- isHexish gates correctly with hardening ----
assert(isHexish('OO:1A:7D:AA:BB:CC') === true,
       'OCR-typo MAC routes to hex path');
assert(isHexish('00:1A:7D, 00:00:00:11:22:33') === true,
       'multi-MAC paste routes to hex path');
assert(isHexish('see: 00:1A:7D:AA:BB:CC') === true,
       'arbitrary prose with embedded MAC routes to hex path');

console.log('mac_formats.mjs OK');
