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
  return {
    normalizeMac, extractMacCandidate, extractMacCandidates, isHexish,
    hasMacishGrouping, normalizedInputIsMacShaped,
  };
`);
const {
  normalizeMac, extractMacCandidate, extractMacCandidates, isHexish,
  hasMacishGrouping, normalizedInputIsMacShaped,
} = factory();

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

// ---- Hardening: bare-normalize fast path must respect the same guard ----
// Regression for the live-PWA defect on PR #13: phone numbers like
// '1-800-555-1234' normalize to 11 hex-valid digits and used to bypass
// extractMacCandidates entirely, ending up as a fake "partial prefix"
// in the UI. normalizedInputIsMacShaped must veto phone shapes whose
// normalize_mac output is otherwise valid hex (the others fall out at
// the _all_hex check because their wrappers aren't separator chars).
const phonesReachingGate = [
  '1-800-555-1234',     // groups 1/3/3/4 -- size 1 not in {2,4,6}
  '555-1234',           // groups 3/4 -- size 3 not in {2,4,6}
];
for (const phone of phonesReachingGate) {
  assert(normalizedInputIsMacShaped(phone) === false,
         `bare-normalize must reject phone ${JSON.stringify(phone)}`);
}
// Legit MAC inputs must still pass the gate.
const macShaped = [
  '00:00:00:11:22:33',
  '00-00-00-11-22-33',
  '0000.0011.2233',
  '000000.112233',
  '000000112233',
  '00-00-00-12-34-56',
  '01:23:45:67:89:01',
  '0000.00',
  ' MAC: 00:1A:2B:3C:4D:5E ',
  '(00:00:00:11:22:33)',
];
for (const m of macShaped) {
  assert(normalizedInputIsMacShaped(m) === true,
         `bare-normalize must accept ${JSON.stringify(m)}`);
}

// Group-uniformity helper directly.
assert(hasMacishGrouping('1-800-555-1234') === false,
       'hasMacishGrouping rejects 1-3-3-4 phone');
assert(hasMacishGrouping('44-20-7946-0958') === false,
       'hasMacishGrouping rejects 2-2-4-4 UK phone (4+ groups must be uniform)');
assert(hasMacishGrouping('00-00-00-11-22-33') === true,
       'hasMacishGrouping accepts canonical 6×2 MAC');
assert(hasMacishGrouping('0000.0011.2233') === true,
       'hasMacishGrouping accepts canonical 3×4 MAC');
assert(hasMacishGrouping('0000.00') === true,
       'hasMacishGrouping accepts truncated 4/2 prefix');

// ---- Full macLookupDetailed equivalent: with a stub longestPrefixLookup
// that always misses, the function must return cleaned=null for phone
// shapes (the original PR #13 defect) and a valid hex cleaned for real
// MAC-shaped inputs.
function simulatedLookup(input) {
  const HEX_RE_LOCAL = /^[0-9A-F]+$/;
  const raw = normalizeMac(input);
  const bareOk =
    HEX_RE_LOCAL.test(raw) &&
    raw.length >= 6 && raw.length <= 12 &&
    normalizedInputIsMacShaped(input);
  const candidates = extractMacCandidates(input);
  // No registry hit possible in the simulation -- just decide the
  // cleaned/null outcome the UI would render.
  if (candidates.length > 0) return { cleaned: candidates[0].hex };
  if (bareOk) return { cleaned: raw };
  return { cleaned: null };
}

// Phone-shape that reaches the bare-normalize gate must not surface a
// cleaned value (this is the exact live-PWA defect on PR #13).
assert(simulatedLookup('1-800-555-1234').cleaned === null,
       'phone 1-800-555-1234 must not produce a cleaned hex');
assert(simulatedLookup('555-1234').cleaned === null,
       'phone 555-1234 must not produce a cleaned hex');

// Real MAC inputs must still surface their canonical hex.
const realCleanCases = [
  ['00:00:00:11:22:33', '000000112233'],
  ['00-00-00-12-34-56', '000000123456'],
  ['0000.0011.2233',    '000000112233'],
  ['000000.112233',     '000000112233'],
  ['000000112233',      '000000112233'],
  ['01:23:45:67:89:01', '012345678901'],
  ['0123.4567.8901',    '012345678901'],
  ['MAC: 00:1A:2B:3C:4D:5E', '001A2B3C4D5E'],
];
for (const [input, expected] of realCleanCases) {
  const out = simulatedLookup(input);
  assert(out.cleaned === expected,
         `simulatedLookup(${JSON.stringify(input)}) cleaned=${out.cleaned}, want ${expected}`);
}

// ---- isHexish gates correctly with hardening ----
assert(isHexish('OO:1A:7D:AA:BB:CC') === true,
       'OCR-typo MAC routes to hex path');
assert(isHexish('00:1A:7D, 00:00:00:11:22:33') === true,
       'multi-MAC paste routes to hex path');
assert(isHexish('see: 00:1A:7D:AA:BB:CC') === true,
       'arbitrary prose with embedded MAC routes to hex path');

// ---- isHexish routes phone / IPv4 to the fuzzy-vendor path -----------
// Live-PWA regression on PR #14: isHexish only checked stripped length
// + hex-validity, so '1-800-555-1234' routed into the hex branch even
// though macLookupDetailed returned cleaned=null, and the UI's fallback
// at handleQuery synthesized 'prefix 180055512' from normalizeMac.
for (const input of [
  '1-800-555-1234',
  '555-1234',
  '(415) 555-1212',
  '+44-20-7946-0958',
  '192.168.1.1',
  '10.0.0.1',
]) {
  assert(isHexish(input) === false,
         `isHexish must route ${JSON.stringify(input)} to fuzzy path`);
}

// ---- UI-facing simulation: handleQuery decision for phone / IP --------
// Replicate the relevant branch from app.js:handleQuery so we catch
// regressions in BOTH isHexish AND the cleaned-fallback at once.
function simulateHandleQuery(input) {
  const trimmed = input.trim();
  if (!trimmed) return { path: 'empty' };
  if (isHexish(trimmed)) {
    const r = simulatedLookup(trimmed);  // null/{cleaned}; no registry hit
    if (r.cleaned) {
      return { path: 'mac', message: `No registry entry for prefix ${r.cleaned.slice(0, 9)}.` };
    }
    // No cleaned -> the UI falls through to the fuzzy vendor path.
  }
  return { path: 'fuzzy' };
}

for (const phone of [
  '1-800-555-1234',
  '555-1234',
  '(415) 555-1212',
  '+44-20-7946-0958',
  '192.168.1.1',
  '10.0.0.1',
]) {
  const r = simulateHandleQuery(phone);
  assert(r.path === 'fuzzy',
         `handleQuery must route ${JSON.stringify(phone)} to fuzzy path, got ${JSON.stringify(r)}`);
}
// And real MAC misses still show the prefix-not-found line (no hit in
// the stubbed lookup, but cleaned is set).
const macMissProbe = simulateHandleQuery('FF:FF:FF:FF:FF:FF');
assert(macMissProbe.path === 'mac' && /prefix FFFFFFFFF\./.test(macMissProbe.message),
       `real-MAC miss should still show prefix message, got ${JSON.stringify(macMissProbe)}`);

console.log('mac_formats.mjs OK');
