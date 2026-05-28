"""Corpus of nasty real-world inputs for the MAC lookup chaos rig.

Each entry is a ``Case`` with an ``input`` string, an ``expect`` classification,
and a free-form ``note`` describing the scenario. The rig in
:mod:`chaos_rig` runs the corpus against :func:`maclookup.lookup_detailed`
and asserts that the observed outcome matches the expected outcome.

Expected outcomes (kept small on purpose so the assertions stay meaningful):

* ``match``     -- a real VendorRecord is returned. Optional ``assignment``
                   pins the expected uppercase IEEE assignment string.
* ``match_ocr`` -- VendorRecord returned via the O/0, I/1 OCR correction
                   path. ``note`` on the result must be "ocr".
* ``partial``   -- cleaned hex is non-None but no registry hit (the UI
                   shows "no entry for X"). ``note`` must be "partial".
* ``none``      -- no candidate at all; cleaned is None. The input was
                   recognized as not containing a MAC.

The corpus deliberately mixes "should resolve" cases with "should NOT
resolve" cases so the rig exercises both the matching path and the
false-positive guards.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Case:
    input: str
    expect: str                  # "match" | "match_ocr" | "partial" | "none"
    note: str                    # human-readable description of the scenario
    assignment: Optional[str] = None  # uppercase hex prefix expected on hit
    cleaned: Optional[str] = None     # uppercase hex of the cleaned candidate
    category: str = "misc"       # for the report grouping


# Pinned IEEE-allocated prefixes used throughout the corpus. These are stable
# and present in the bundled CSVs; if they ever change the rig will fail loud.
XEROX_MAL = "000000"      # MA-L, Xerox -- famous canonical 00:00:00
CISCO_MAL = "00059A"      # MA-L, Cisco Systems
AYECOM_MAL = "001A2B"     # MA-L, Ayecom Technology
IEEE_RA_MAL = "8C1F64"    # MA-L, IEEE Registration Authority (parent of MA-S)
COM3_MAL = "02C08C"       # MA-L, 3COM (locally-administered first nibble)

# A known MA-S child of the IEEE Registration Authority MA-L parent.
DATA_ELECTRONIC_MAS = "8C1F64AFA"  # MA-S, Data Electronic Devices


CASES: list[Case] = [
    # ----- Canonical formats (sanity, should all resolve to MA-L) ---------
    Case("00:00:00:11:22:33", "match", "canonical colon", XEROX_MAL, category="canonical"),
    Case("00-00-00-11-22-33", "match", "canonical hyphen / Windows", XEROX_MAL, category="canonical"),
    Case("000000.112233", "match", "single-dot variant", XEROX_MAL, category="canonical"),
    Case("0000.0011.2233", "match", "Cisco dotted-triple", XEROX_MAL, category="canonical"),
    Case("000000112233", "match", "plain hex, 12 chars", XEROX_MAL, category="canonical"),
    Case("00 00 00 11 22 33", "match", "space-separated nibbles", XEROX_MAL, category="canonical"),

    # ----- Real-world CLI/OS pastes --------------------------------------
    Case(
        "Physical Address. . . . . . . . . : 00-00-00-11-22-33",
        "match", "Windows ipconfig /all", XEROX_MAL, category="cli/os",
    ),
    Case(
        "ether 00:00:00:11:22:33  txqueuelen 1000  (Ethernet)",
        "match", "Linux ifconfig", XEROX_MAL, category="cli/os",
    ),
    Case(
        "link/ether 00:00:00:11:22:33 brd ff:ff:ff:ff:ff:ff",
        "match", "Linux `ip link` (MAC + broadcast on same line)",
        XEROX_MAL, category="cli/os",
    ),
    Case(
        "Hardware is iGbE, address is 0000.0011.2233 (bia 0000.0011.2233)",
        "match", "Cisco IOS `show interfaces` with bia",
        XEROX_MAL, category="cli/os",
    ),
    Case(
        "Current address: 00:00:00:11:22:33",
        "match", "Juniper-ish `show interfaces extensive`",
        XEROX_MAL, category="cli/os",
    ),
    Case(
        "Hardware address is 00:00:00:11:22:33",
        "match", "Arista EOS `show interfaces`",
        XEROX_MAL, category="cli/os",
    ),
    Case(
        "HWaddr 00:00:00:11:22:33",
        "match", "Legacy ifconfig HWaddr label", XEROX_MAL, category="cli/os",
    ),
    Case(
        "MAC Address: 00:00:00:11:22:33",
        "match", "iDRAC / iLO BIOS page", XEROX_MAL, category="cli/os",
    ),
    Case(
        "Burned-in Address: 0000.0011.2233",
        "match", "Cisco show interfaces verbose", XEROX_MAL, category="cli/os",
    ),

    # ----- Long multi-line pastes ----------------------------------------
    Case(
        "Connection-specific DNS Suffix  . :\n"
        "   Description . . . . . . . . . . . : Intel(R) Wireless-AC 9560\n"
        "   Physical Address. . . . . . . . . : 8C-1F-64-AF-A0-12\n"
        "   DHCP Enabled. . . . . . . . . . . : Yes\n",
        "match", "ipconfig multi-line with MA-S child", DATA_ELECTRONIC_MAS,
        category="multiline",
    ),
    Case(
        "host1: 00:00:00:11:22:33\n"
        "host2: 00:05:9A:DE:AD:BE\n"
        "host3: 00:1A:2B:CC:DD:EE\n",
        "match", "asset inventory with multiple MACs (first wins)",
        XEROX_MAL, category="multiline",
    ),

    # ----- Wrappers and trailing punctuation ------------------------------
    Case("(00:00:00:11:22:33)", "match", "paren wrapped", XEROX_MAL, category="wrappers"),
    Case("[00-00-00-11-22-33]", "match", "bracket wrapped", XEROX_MAL, category="wrappers"),
    Case("<00:00:00:11:22:33>", "match", "angle wrapped", XEROX_MAL, category="wrappers"),
    Case("{00:00:00:11:22:33}", "match", "brace wrapped", XEROX_MAL, category="wrappers"),
    Case("'00:00:00:11:22:33'", "match", "single-quoted", XEROX_MAL, category="wrappers"),
    Case('"00:00:00:11:22:33"', "match", "double-quoted", XEROX_MAL, category="wrappers"),
    Case("`00:00:00:11:22:33`", "match", "backtick wrapped", XEROX_MAL, category="wrappers"),
    Case("00:00:00:11:22:33.", "match", "trailing dot", XEROX_MAL, category="wrappers"),
    Case("00:00:00:11:22:33,", "match", "trailing comma", XEROX_MAL, category="wrappers"),
    Case("00:00:00:11:22:33;", "match", "trailing semicolon", XEROX_MAL, category="wrappers"),
    Case("MAC=00:00:00:11:22:33;END", "match", "key=value with semicolon", XEROX_MAL, category="wrappers"),

    # ----- JSON / HTML / email -------------------------------------------
    Case(
        '{"hostname":"sw1","mac":"00:00:00:11:22:33","port":12}',
        "match", "JSON snippet", XEROX_MAL, category="structured",
    ),
    Case(
        "<td>00:00:00:11:22:33</td>",
        "match", "HTML cell", XEROX_MAL, category="structured",
    ),
    Case(
        "Subject: ticket #4711 -- AP at 00:00:00:11:22:33 won't associate",
        "match", "email/ticket prose", XEROX_MAL, category="structured",
    ),
    Case(
        "hostname,mac,vlan\nsw1,00:00:00:11:22:33,10\n",
        "match", "CSV row", XEROX_MAL, category="structured",
    ),

    # ----- Locally administered / reserved / broadcast --------------------
    # Locally administered (first byte has bit 1 set) is still a real MAC --
    # if there's a registry entry we return it; if not we report partial.
    Case("02:C0:8C:00:00:01", "match", "locally administered (matches 3COM MA-L)",
         COM3_MAL, category="reserved"),
    Case("06:00:00:00:00:00", "partial", "locally administered, unassigned prefix",
         category="reserved"),
    Case("FF:FF:FF:FF:FF:FF", "partial", "broadcast address — no registry hit",
         category="reserved"),
    Case("01:00:5E:00:00:01", "partial", "IPv4 multicast (01:00:5E) — IANA, no IEEE row",
         category="reserved"),
    Case("00:00:00:00:00:00", "match", "all-zero MAC — Xerox owns 00:00:00",
         XEROX_MAL, category="reserved"),

    # ----- Longest-prefix wins -------------------------------------------
    Case("8C:1F:64:AF:A0:12", "match", "MA-S wins over MA-L parent",
         DATA_ELECTRONIC_MAS, category="prefix"),
    # 8 hex chars is shorter than the MA-M prefix(7) only by being padded
    # arbitrarily; we still want a MA-L hit on the 6-char parent.
    Case("8C:1F:64:AF", "match", "8 hex chars resolves to MA-L parent",
         IEEE_RA_MAL, category="prefix"),
    Case("00:05:9A", "match", "6-hex MA-L prefix only (Cisco)",
         CISCO_MAL, category="prefix"),

    # ----- Partial prefixes ----------------------------------------------
    # Anything shorter than 6 hex chars is below the candidate floor of
    # _candidate_from_token and is *not* surfaced (cleaned=None). Documented
    # so the UI's "need 6+ hex chars" hint stays accurate.
    Case("00:1A:2", "none", "5-hex prefix — below candidate floor of 6",
         category="partial"),
    Case("00:1A", "none", "4-hex prefix — below candidate floor of 6",
         category="partial"),
    Case("001A2B3C4D", "match", "10 hex chars resolves to MA-L parent",
         AYECOM_MAL, category="partial"),
    Case("001A2B3C", "match", "8 hex chars resolves to MA-L parent",
         AYECOM_MAL, category="partial"),
    Case("001A2B3", "match", "7 hex chars resolves to MA-L parent",
         AYECOM_MAL, category="partial"),

    # ----- OCR-style typo corrections ------------------------------------
    Case("OO:00:00:11:22:33", "match_ocr", "leading O/0 typo, MAC-shaped",
         XEROX_MAL, category="ocr"),
    # I/l confusion is corrected and surfaces a cleaned hex string, but the
    # corrected prefix (111A2B…) isn't assigned in any registry, so the
    # outcome is 'partial' (cleaned hex returned, no record). This is the
    # right behavior — the rig confirms we don't pretend to have a hit.
    Case("Il:1A:2B:3C:4D:5E", "partial", "I/l corrected but no registry match",
         cleaned="111A2B3C4D5E", category="ocr"),
    Case("Physical Address. . . : OO-00-00-11-22-33",
         "match_ocr", "ipconfig style with O/0 typo", XEROX_MAL,
         category="ocr"),
    # OCR fix must NOT happen for plain words.
    Case("cisco", "none", "vendor word — must NOT be coerced to a MAC",
         category="ocr"),
    Case("Apple Inc", "none", "another vendor word", category="ocr"),
    Case("Hello World", "none", "non-MAC english prose", category="ocr"),

    # ----- Famous hex-like words (false-positive guards) ------------------
    # 'deadbeefcafe' is a 12-hex valid string but not assigned in any
    # registry, so we expect a 'partial' (cleaned hex returned, no record).
    Case("dead.beef.cafe", "partial", "12-hex hex-word — cleaned but unmatched",
         cleaned="DEADBEEFCAFE", category="false-positive"),
    Case("face:beef:cafe", "partial", "another hex-word combo",
         cleaned="FACEBEEFCAFE", category="false-positive"),
    Case("Try the 3com switch", "none",
         "vendor name '3com' — hex fragment too short to be a MAC",
         category="false-positive"),
    Case("call 1-800-555-1234", "none",
         "phone number — no MAC-shaped token",
         category="false-positive"),
    # Bare phone-number inputs are what users actually paste into the PWA
    # search box. Live-PWA regression on PR #13: normalize_mac stripped
    # the hyphens and produced 11 hex-valid digits, which bypassed the
    # candidate scorer and surfaced as a fake "no entry for prefix
    # 180055512" message. The bare-normalize path now respects the same
    # group-uniformity guard as candidate scoring.
    Case("1-800-555-1234", "none",
         "bare US phone (1/3/3/4) — must not produce cleaned hex",
         category="false-positive"),
    Case("555-1234", "none",
         "bare 7-digit phone (3/4) — group sizes not in {2,4,6}",
         category="false-positive"),
    Case("(415) 555-1212", "none",
         "wrapped US phone — wrappers + non-MAC groups",
         category="false-positive"),
    Case("+44-20-7946-0958", "none",
         "international UK phone (2/2/4/4) — 4+ groups must be uniform",
         category="false-positive"),
    Case("192.168.1.1", "none",
         "IPv4 address (3/3/1/1) — not a MAC",
         category="false-positive"),
    Case("10.0.0.1", "none",
         "IPv4 address with one-digit groups",
         category="false-positive"),
    # A serial number with hyphens but pure digits past the prefix shouldn't
    # be coerced into a MAC. 8 chars of digits is below MA-M prefix length
    # of 7 — wait, 8 >= 7. The crucial property: we don't *invent* a MAC
    # from a serial number, but if it happens to match the 6-char MA-L
    # prefix that's a real (though unintended) hit. So we only assert here
    # that we don't *crash*; not a strict expectation. Use 'partial' or
    # 'match' both acceptable -> express as 'match_or_partial' below.

    # ----- Mixed case + Unicode-ish punctuation --------------------------
    Case("00:aA:bB:Cc:Dd:Ee", "partial",
         "mixed case — cleans to 00AABBCCDDEE, unassigned prefix",
         cleaned="00AABBCCDDEE", category="punctuation"),
    # En-dash isn't a recognized inner separator, so the regex tokenizer
    # splits it into 2-char hex chunks and _combine_whitespace_chunks
    # reassembles them. This is a friendly accidental behavior: when a
    # user types or pastes Unicode-fancy dashes we still resolve the MAC.
    Case("00–1A–2B–3C–4D–5E", "match",
         "en-dash separators reassembled via whitespace-chunk path",
         AYECOM_MAL, category="punctuation"),
    Case("00\t1A\t2B\t3C\t4D\t5E", "match",
         "tab-separated nibbles", AYECOM_MAL, category="punctuation"),
    Case("MAC: 00:1A:2B:3C:4D:5E", "match",
         "non-breaking space between label and MAC", AYECOM_MAL,
         category="punctuation"),

    # ----- Multi-MAC inputs (rig only checks the first candidate) --------
    Case("from=00:00:00:11:22:33 to=00:05:9A:DE:AD:BE",
         "match", "two MACs on one line, first chosen", XEROX_MAL,
         category="multi-mac"),
    Case("[00:00:00:11:22:33, 00:05:9A:DE:AD:BE]",
         "match", "JSON list of two MACs", XEROX_MAL, category="multi-mac"),

    # ----- ARP-style single-nibble octets --------------------------------
    # An Apple MacBook's ARP entry was emitted as ``fe:35:b6:60:f:ee`` (one
    # octet shrunk from ``0f`` to ``f``). The candidate extractor pads
    # short octets so the MAC reaches the lookup; the FE first byte has
    # the locally administered bit set so there is no IEEE OUI hit.
    Case("fe:35:b6:60:f:ee", "partial",
         "Apple ARP form — single-nibble octet padded to 0F",
         cleaned="FE35B6600FEE", category="single-nibble"),
    Case("0:1a:2b:3c:4d:5e", "match",
         "leading short octet padded to 00; resolves Ayecom MA-L",
         AYECOM_MAL, category="single-nibble"),
    Case("0-1a-2b-3c-4d-5e", "match",
         "hyphen separators with leading short octet padded",
         AYECOM_MAL, category="single-nibble"),
    # Pure-digit single-nibble groups must NOT be padded — too ambiguous.
    Case("1:2:3:4:5:6", "none",
         "pure-digit single-nibble shape — no hex letters, must not pad",
         category="single-nibble"),

    # ----- Pathological / empty ------------------------------------------
    Case("", "none", "empty string", category="edge"),
    Case("   \t\n  ", "none", "whitespace only", category="edge"),
    Case("!@#$%^&*()", "none", "punctuation soup, no hex chars",
         category="edge"),
    Case("Z" * 200, "none", "long non-hex run", category="edge"),
    # Hex-only blobs outside the 6-12 char window aren't accepted as MAC
    # candidates. This rejects accidental large hashes / disk identifiers
    # being interpreted as MACs — the rig confirms the guard.
    Case("00" * 50, "none",
         "100-char hex blob — too long to be a MAC candidate", category="edge"),
    Case("0000001122334", "none",
         "13-char hex blob — too long without any separators", category="edge"),
]


# Cases where outcome is "either match or partial" (e.g. ambiguous serial
# numbers). We don't pin a specific expectation but the call must not crash
# and the cleaned value, if any, must be valid hex.
LENIENT_CASES: list[Case] = [
    Case("SN# 0011-2233-4455", "partial",
         "serial number that happens to be hex-shaped",
         category="ambiguous"),
]


__all__ = ["Case", "CASES", "LENIENT_CASES"]
