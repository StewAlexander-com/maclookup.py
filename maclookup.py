#!/usr/bin/env python3
"""Look up MAC vendor info offline across IEEE MA-L, MA-M, and MA-S registries.

Registries (longest prefix wins):
  * MA-S (OUI-36)  -- 36-bit assignment, ~9 hex chars
  * MA-M           -- 28-bit assignment, ~7 hex chars
  * MA-L (OUI)     -- 24-bit assignment, ~6 hex chars

Backward compatibility:
  * ``normalize_mac`` and ``search_oui(csv_file, mac)`` keep their original
    signatures so existing callers / imports continue to work; ``search_oui``
    still returns ``(name, address)`` and ignores any registry other than MA-L
    when only the legacy ``oui.csv`` is provided.
"""
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Iterable, List, NamedTuple, Optional

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_MAL_CSV = REPO_ROOT / "oui.csv"
DEFAULT_MAM_CSV = REPO_ROOT / "mam.csv"
DEFAULT_MAS_CSV = REPO_ROOT / "oui36.csv"

# Hex-character prefix length per IEEE registry.
REGISTRY_PREFIX_LEN = {"MA-S": 9, "MA-M": 7, "MA-L": 6}
# Longest first so longest-prefix-match is natural.
REGISTRY_ORDER = ("MA-S", "MA-M", "MA-L")


class VendorRecord(NamedTuple):
    registry: str           # "MA-L" | "MA-M" | "MA-S"
    assignment: str         # uppercase hex prefix (6/7/9 chars)
    organization: str
    address: str


class LookupResult(NamedTuple):
    """Structured lookup result with provenance for the UI.

    ``cleaned`` is the hex string (no separators, uppercase) that was used as
    the lookup key. ``note`` is one of ``""``, ``"ocr"``, ``"partial"`` and
    explains how the result was reached so the UI can show e.g. "matched by
    24-bit prefix after cleanup".
    """
    record: Optional[VendorRecord]
    cleaned: Optional[str]
    note: str = ""


_SEPARATORS_RE = re.compile(r"[-:.\s]")
# Internal separators that may sit *inside* a MAC token (no whitespace).
# Whitespace is treated as a token boundary instead, so two MACs pasted on
# adjacent lines / separated by a space don't collapse into one over-long run.
_INNER_SEP_RE = re.compile(r"[-:.]")
# Common label prefixes shipped by switches/routers/OS dialogs. Stripped
# case-insensitively before extraction.
_LABEL_RE = re.compile(
    r"(?i)\b(?:mac(?:\s*address)?|hardware\s*address|hwaddr|"
    r"ether(?:net)?(?:\s*address)?|physical\s*address|bia|burned[- ]?in[- ]?address)"
    r"\s*[:=]?\s*"
)
# Bracketing wrappers commonly seen around a MAC in CLI output. Tabs and
# newlines act as boundaries too so multi-line pastes don't get merged.
_WRAPPER_CHARS = "()[]<>{}\"'`,;\t\r\n"
# Token: one or more hex (or OCR-likely O/I/l) characters, possibly with
# internal :/-/.; pure whitespace is what separates tokens.
_TOKEN_RE = re.compile(r"[0-9A-Fa-fOoIiLl\-:.]+")
# Map of common OCR/keyboard mistakes for clearly-MAC-shaped tokens only.
_OCR_FIX = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "L": "1"})


def normalize_mac(mac_address: str) -> str:
    """Strip common separators and uppercase the input.

    Accepts the bare formats users actually paste:
      * Colon:        00:1A:2B:3C:4D:5E
      * Hyphen/PC:    00-1A-2B-3C-4D-5E
      * Cisco dotted: 001a.2b3c.4d5e
      * Plain hex:    001A2B3C4D5E
      * Spaces:       00 1A 2B 3C 4D 5E
      * Lower/upper case mixed
    For inputs that contain labels or wrappers (e.g. "MAC Address: 00-1a-..."),
    use :func:`extract_mac_candidate` first.
    """
    return _SEPARATORS_RE.sub("", mac_address).upper()


def _looks_mac_shaped(token: str) -> bool:
    """Heuristic: token has MAC-style internal separators or is a likely MAC.

    Used to gate OCR substitutions so we don't corrupt vendor words like
    ``cisco``. A token qualifies if it contains ``:``, ``-`` or ``.`` (the
    canonical MAC separators) AND the hex-or-OCR-only length is in 6-12.
    """
    if not _INNER_SEP_RE.search(token):
        return False
    stripped = _INNER_SEP_RE.sub("", token)
    return 6 <= len(stripped) <= 12


def _all_hex(s: str) -> bool:
    return bool(s) and all(c in "0123456789ABCDEFabcdef" for c in s)


def _has_hex_letter(s: str) -> bool:
    """True if the string contains at least one hex letter (a-f)."""
    return any(c in "abcdefABCDEF" for c in s)


# Group sizes that real MAC formats use between separators. A token with
# separators but no hex letters (pure digits — so a phone number or serial
# could be confused for a MAC) must use one of these uniform group sizes;
# this rejects shapes like 1-800-555-1234 (1/3/3/4) while accepting
# 01:23:45:67:89:01 (2/2/2/2/2/2), 0123.4567.8901 (4/4/4), and the rarer
# 000000.112233 (6/6, single-dot half-and-half).
_MAC_GROUP_SIZES = {2, 4, 6}


def _has_macish_grouping(token: str) -> bool:
    """When a separator-bearing token has no hex letters (pure digits),
    require every separator-delimited group to be sized like a MAC group.

    Real MAC formats use group sizes in {2, 4, 6} -- ``2/2/2/2/2/2``
    (colon/hyphen), ``4/4/4`` (Cisco dotted), ``6/6`` (single-dot
    half-and-half), and the truncated-prefix shapes ``0000.00`` (4/2),
    ``0000.0011`` (4/4), ``00:00:00`` (3×2). Phone numbers and IPv4
    addresses tend to mix 1 / 3 / 4-char groups.

    Rules (pure-digit only -- a-f anywhere means the token is unambiguous
    enough that length alone is fine):
      * 2 or 3 groups: each group's length must be in {2, 4, 6}. This
        permits ``0000.00`` (4/2) and ``000000.112233`` (6/6) while
        rejecting ``(415) 555-1212`` (3/4 after wrapper strip).
      * 4 or more groups: groups must additionally be uniformly sized.
        Real MACs in this regime are always 6×2 (colon/hyphen) or 3×4
        (Cisco) -- never a 2/2/4/4 mix like ``+44-20-7946-0958``.
    """
    if _has_hex_letter(token):
        return True
    groups = _INNER_SEP_RE.split(token)
    if len(groups) < 2:
        return True
    sizes = [len(g) for g in groups]
    if any(s not in _MAC_GROUP_SIZES for s in sizes):
        return False
    if len(groups) >= 4 and len(set(sizes)) != 1:
        return False
    return True


def _normalized_input_is_mac_shaped(raw_input: str) -> bool:
    """Decide whether ``raw_input`` is safe to treat as bare MAC hex once
    separators are stripped.

    The bare-normalize fast path in :func:`lookup_detailed` exists for
    already-clean inputs like ``00:1A:2B:3C:4D:5E``. If we let phone-shaped
    strings such as ``1-800-555-1234`` through, we end up reporting a
    ``cleaned`` value (``18005551234``) and a partial-prefix message, which
    is exactly the false positive the chaos rig caught. Require the same
    group-uniformity guard as :func:`_candidate_from_token` so the two
    paths agree.
    """
    if raw_input is None:
        return False
    text = raw_input.strip()
    if not text:
        return False
    # Strip the wrappers / whitespace that aren't part of the MAC itself
    # before sizing groups. Mirrors what extract_mac_candidates does.
    for ch in _WRAPPER_CHARS + " ":
        text = text.replace(ch, "")
    if not text:
        return False
    # No inner separators left -- bare hex. Length sanity is checked by
    # the caller against the 6-12 hex window.
    if not _INNER_SEP_RE.search(text):
        return True
    return _has_macish_grouping(text)


def _candidate_from_token(token: str) -> Optional[tuple]:
    """Score a single token. Returns ``(hex_only, used_ocr)`` or None.

    A token must have MAC-like shape (either explicit separators or 6-12
    pure-hex characters) to qualify. OCR substitutions are applied only when
    the token already looks MAC-shaped, never to bare words.
    """
    if not token:
        return None
    # Pure-hex blob in the right size range — no further work needed.
    if _all_hex(token) and 6 <= len(token) <= 12:
        return token.upper(), False
    if _looks_mac_shaped(token) and _has_macish_grouping(token):
        # Try as-is first (case where O/I/l aren't present).
        stripped = _INNER_SEP_RE.sub("", token)
        if _all_hex(stripped) and 6 <= len(stripped) <= 12:
            return stripped.upper(), False
        # Apply OCR fixups and re-check.
        fixed = stripped.translate(_OCR_FIX)
        if _all_hex(fixed) and 6 <= len(fixed) <= 12 and fixed != stripped:
            return fixed.upper(), True
    return None


def _combine_whitespace_chunks(tokens: List[str]) -> Optional[tuple]:
    """Merge adjacent short hex chunks like ``00 1A 2B 3C 4D 5E``.

    Greedy from each starting position. Accepts a run of 2-6 consecutive
    pure-hex tokens whose lengths sum to 6-12 hex chars. Returns the best
    such run as ``(hex_only, False)`` or None.
    """
    best = ""
    n = len(tokens)
    for i in range(n):
        if not _all_hex(tokens[i]):
            continue
        acc = ""
        for j in range(i, min(i + 6, n)):
            t = tokens[j]
            if not _all_hex(t) or not (1 <= len(t) <= 4):
                break
            acc += t
            if len(acc) > 12:
                break
            if 6 <= len(acc) <= 12 and len(acc) > len(best):
                best = acc
    return (best.upper(), False) if best else None


def extract_mac_candidates(text: str) -> List[tuple]:
    """Pull every plausible MAC-shaped candidate out of free-form text.

    Returns a list of ``(hex_only_uppercase, used_ocr)`` tuples, ordered by
    preference (explicit MAC shape with separators first, longer before
    shorter). Duplicates are de-duplicated while preserving order.
    """
    if not text:
        return []
    stripped = _LABEL_RE.sub(" ", text)
    stripped = stripped.translate({ord(c): " " for c in _WRAPPER_CHARS})

    raw_tokens = _TOKEN_RE.findall(stripped)
    # Pull trailing junk off each token so "AA:BB:CC." → "AA:BB:CC".
    cleaned = []
    for tok in raw_tokens:
        tok = tok.strip(".-:")
        if tok:
            cleaned.append(tok)

    candidates: List[tuple] = []
    seen = set()

    def _add(item):
        if item is None:
            return
        hex_only, used_ocr = item
        if hex_only in seen:
            return
        seen.add(hex_only)
        candidates.append(item)

    for tok in cleaned:
        _add(_candidate_from_token(tok))

    # Also handle "00 1A 2B 3C 4D 5E" — space-separated nibble groups that
    # don't survive token-by-token scoring because each chunk is only 2 hex
    # chars (below the 6-char floor).
    _add(_combine_whitespace_chunks(cleaned))

    # Sort: prefer longest hex; prefer non-OCR over OCR within the same length.
    candidates.sort(key=lambda c: (-len(c[0]), c[1]))
    return candidates


def extract_mac_candidate(text: str) -> Optional[str]:
    """Backward-compatible single-candidate extractor.

    Returns the uppercase hex (no separators) of the best plausible MAC-shaped
    run in ``text``, or ``None``. See :func:`extract_mac_candidates` for the
    multi-candidate version.
    """
    candidates = extract_mac_candidates(text)
    return candidates[0][0] if candidates else None


def _iter_csv(path: Path) -> Iterable[list[str]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)  # skip header
        for row in reader:
            if row:
                yield row


def load_registry(path: Path) -> dict[str, VendorRecord]:
    """Load a single IEEE CSV into a {assignment: VendorRecord} dict."""
    out: dict[str, VendorRecord] = {}
    for row in _iter_csv(path):
        if len(row) < 4:
            continue
        registry, assignment, name, address = row[0], row[1].upper(), row[2], row[3]
        out[assignment] = VendorRecord(registry, assignment, name, address)
    return out


def load_all(
    mal_csv: Path = DEFAULT_MAL_CSV,
    mam_csv: Path = DEFAULT_MAM_CSV,
    mas_csv: Path = DEFAULT_MAS_CSV,
) -> dict[str, dict[str, VendorRecord]]:
    """Load every available registry; missing files are skipped silently."""
    bundle: dict[str, dict[str, VendorRecord]] = {}
    for registry, path in (("MA-L", mal_csv), ("MA-M", mam_csv), ("MA-S", mas_csv)):
        if path and path.exists():
            bundle[registry] = load_registry(path)
    return bundle


def _match_prefix(
    hex_only: str,
    registries: dict[str, dict[str, VendorRecord]],
) -> Optional[VendorRecord]:
    """Longest-prefix scan against an already-cleaned hex string."""
    for registry in REGISTRY_ORDER:
        table = registries.get(registry)
        if not table:
            continue
        plen = REGISTRY_PREFIX_LEN[registry]
        if len(hex_only) < plen:
            continue
        record = table.get(hex_only[:plen])
        if record is not None:
            return record
    return None


def lookup(
    mac_address: str,
    registries: Optional[dict[str, dict[str, VendorRecord]]] = None,
) -> Optional[VendorRecord]:
    """Longest-prefix lookup: try MA-S (9), then MA-M (7), then MA-L (6).

    Returns ``None`` if no registry contains a matching prefix. Pass a
    pre-loaded ``registries`` mapping to avoid re-reading CSVs on each call.
    """
    return lookup_detailed(mac_address, registries).record


def lookup_detailed(
    mac_address: str,
    registries: Optional[dict[str, dict[str, VendorRecord]]] = None,
) -> LookupResult:
    """Lookup with provenance (the cleaned hex and a note about how it matched).

    Strategy:
      1. Normalize the bare input. If it's already clean hex of usable length
         and we get a longest-prefix hit, return immediately.
      2. Otherwise pull candidates out of free-form text. Try each in order:
         exact (no OCR) before OCR-fixed; longer prefix wins.
      3. If a candidate matches, attach a ``note`` describing what we did
         (``ocr`` for typo-corrected, ``partial`` if we had to drop down a
         registry tier).
    """
    if registries is None:
        registries = load_all()

    note = ""
    raw = mac_address or ""
    normalized = normalize_mac(raw)
    cleaned: Optional[str] = None
    record: Optional[VendorRecord] = None

    bare_path_ok = (
        _all_hex(normalized)
        and 6 <= len(normalized) <= 12
        and _normalized_input_is_mac_shaped(raw)
    )
    if bare_path_ok:
        cleaned = normalized
        record = _match_prefix(normalized, registries)
        if record is None:
            note = "partial"
        if record is not None:
            return LookupResult(record=record, cleaned=cleaned, note="")

    # Fall back to free-form extraction. Try every candidate; first to hit
    # wins. We sort non-OCR candidates ahead of OCR-fixed so a clean MAC is
    # always preferred over a guess.
    for hex_only, used_ocr in extract_mac_candidates(mac_address or ""):
        candidate_record = _match_prefix(hex_only, registries)
        if candidate_record is not None:
            return LookupResult(
                record=candidate_record,
                cleaned=hex_only,
                note="ocr" if used_ocr else "",
            )
        if cleaned is None:
            cleaned = hex_only
            note = "partial"

    return LookupResult(record=record, cleaned=cleaned, note=note if cleaned else "")


def search_oui(csv_file, mac_address):
    """Legacy single-CSV lookup. Returns ``(name, address)`` or ``(None, None)``.

    Preserved for backward compatibility with external callers / Pythonista
    scripts that imported this function. When called against ``oui.csv`` it
    matches the 24-bit MA-L prefix; against other registry CSVs it matches the
    corresponding registry's prefix length automatically.
    """
    try:
        path = Path(csv_file)
        table = load_registry(path)
    except OSError as e:
        print(f"Error: {e}")
        return None, None

    # Infer prefix length from the file's rows (all assignments share a length
    # within a registry). Fall back to 6 for an empty file.
    any_key = next(iter(table), None)
    prefix_len = len(any_key) if any_key else 6
    normalized = normalize_mac(mac_address)
    record = table.get(normalized[:prefix_len])
    return (record.organization, record.address) if record else (None, None)


def format_output(title, content, width=44):
    """ASCII box formatting for CLI output."""
    border = "+" + "-" * (width - 2) + "+"
    lines = [border]
    if title:
        lines.append(f"| {title.center(width - 4)} |")
        lines.append(border)
    for line in content.split("\n"):
        if line == "":
            lines.append(f"| {'':<{width - 4}} |")
            continue
        while line:
            chunk, line = line[: width - 4], line[width - 4 :]
            lines.append(f"| {chunk.ljust(width - 4)} |")
    lines.append(border)
    return "\n".join(lines)


def _describe(record: VendorRecord) -> str:
    return (
        f"Registry: {record.registry}\n"
        f"Assignment: {record.assignment}\n"
        f"Org: {record.organization}\n"
        f"Address: {record.address}"
    )


def main():
    registries = load_all()
    if not registries:
        print(format_output("Error",
                            "No registry CSVs found. Expected oui.csv, "
                            "mam.csv, or oui36.csv next to maclookup.py."))
        return

    loaded = ", ".join(f"{r}({len(registries[r])})" for r in REGISTRY_ORDER if r in registries)
    print(format_output(
        "MAC Vendor Lookup",
        "Supports MA-L / MA-M / MA-S\n"
        "Formats: 00:1A:7D, 00-1A-7D,\n"
        "001A7D, 0000.0C12,\n"
        "MAC: 00:1A:7D:AA:BB:CC\n"
        f"Loaded: {loaded}\n"
        "Type 'q' to quit"))

    while True:
        user_input = input('\nEnter MAC/OUI (or "q" to quit): ').strip()
        if user_input.lower() in ("q", "quit"):
            print("\nExiting...")
            break

        result = lookup_detailed(user_input, registries)
        if result.cleaned is None:
            print(format_output("Error",
                                "Need at least 6 hex characters of a MAC "
                                "or recognizable prefix"))
            continue

        if result.record is not None:
            body = _describe(result.record)
            if result.cleaned and result.cleaned != result.record.assignment:
                body += f"\nInterpreted: {result.cleaned}"
            if result.note == "ocr":
                body += "\nNote: corrected O/0 or I/1 typo"
            print(format_output("Found", body))
        else:
            msg = f"No entry for {result.cleaned[:9]}"
            if result.note == "partial":
                msg += "\n(too few hex chars or no matching prefix)"
            print(format_output("Not Found", msg))


if __name__ == "__main__":
    main()
