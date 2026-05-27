"""Smoke tests for maclookup.py and the bundled IEEE registry CSVs.

Covers:
  * Schema/integrity of oui.csv (MA-L), mam.csv (MA-M), oui36.csv (MA-S).
  * normalize_mac / search_oui backward-compatibility.
  * load_all / lookup longest-prefix behavior across all three registries.

Run with `python -m unittest discover -s tests` or `python -m pytest tests`.
"""
from __future__ import annotations

import csv
import importlib.util
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "maclookup.py"

MAL_CSV = REPO_ROOT / "oui.csv"
MAM_CSV = REPO_ROOT / "mam.csv"
MAS_CSV = REPO_ROOT / "oui36.csv"

EXPECTED_HEADER = ["Registry", "Assignment", "Organization Name", "Organization Address"]

REGISTRY_FIXTURES = [
    ("MA-L", MAL_CSV, 6, 30_000),
    ("MA-M", MAM_CSV, 7, 4_000),
    ("MA-S", MAS_CSV, 9, 4_000),
]


def _load_maclookup():
    spec = importlib.util.spec_from_file_location("maclookup", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["maclookup"] = mod
    spec.loader.exec_module(mod)
    return mod


class TestRegistryCsvs(unittest.TestCase):
    """Header, row count floor, and assignment-shape checks per registry."""

    def test_headers_match_ieee_schema(self):
        for label, path, _plen, _floor in REGISTRY_FIXTURES:
            with self.subTest(registry=label), path.open(newline="", encoding="utf-8") as f:
                self.assertEqual(next(csv.reader(f)), EXPECTED_HEADER)

    def test_row_count_floors(self):
        for label, path, _plen, floor in REGISTRY_FIXTURES:
            with self.subTest(registry=label), path.open(newline="", encoding="utf-8") as f:
                rows = sum(1 for _ in csv.reader(f)) - 1
            self.assertGreater(rows, floor, f"{path.name} only has {rows} entries")

    def test_every_assignment_has_expected_shape(self):
        for label, path, plen, _floor in REGISTRY_FIXTURES:
            with self.subTest(registry=label), path.open(newline="", encoding="utf-8") as f:
                reader = csv.reader(f)
                next(reader)
                for i, row in enumerate(reader, start=2):
                    self.assertEqual(len(row), 4, f"{path.name}:{i} has {len(row)} cols")
                    self.assertEqual(row[0], label,
                                     f"{path.name}:{i} registry={row[0]!r}")
                    assignment = row[1]
                    self.assertEqual(len(assignment), plen,
                                     f"{path.name}:{i} assignment={assignment!r}")
                    int(assignment, 16)  # raises if not hex


class TestLookup(unittest.TestCase):
    """Pin behavior using IEEE-allocated prefixes known to be stable."""

    @classmethod
    def setUpClass(cls):
        cls.maclookup = _load_maclookup()
        cls.registries = cls.maclookup.load_all()

    def test_normalize_mac_handles_all_separators(self):
        n = self.maclookup.normalize_mac
        self.assertEqual(n("00:1A:7D:AA:BB:CC"), "001A7DAABBCC")
        self.assertEqual(n("00-1a-7d-aa-bb-cc"), "001A7DAABBCC")
        self.assertEqual(n("001a.7daa.bbcc"), "001A7DAABBCC")
        self.assertEqual(n("001a7daabbcc"), "001A7DAABBCC")
        self.assertEqual(n("  00 1a 7d aa bb cc "), "001A7DAABBCC")

    def test_legacy_search_oui_still_returns_pair(self):
        name, addr = self.maclookup.search_oui(str(MAL_CSV), "00:00:00:11:22:33")
        self.assertIsNotNone(name, "Xerox OUI 000000 missing from oui.csv")
        self.assertIn("XEROX", name.upper())
        self.assertIsNotNone(addr)

    def test_legacy_search_oui_unknown_returns_none_pair(self):
        name, addr = self.maclookup.search_oui(str(MAL_CSV), "FF:FF:FF:00:00:00")
        self.assertIsNone(name)
        self.assertIsNone(addr)

    def test_lookup_loads_all_three_registries(self):
        self.assertIn("MA-L", self.registries)
        self.assertIn("MA-M", self.registries)
        self.assertIn("MA-S", self.registries)
        self.assertGreater(len(self.registries["MA-L"]), 30_000)
        self.assertGreater(len(self.registries["MA-M"]), 4_000)
        self.assertGreater(len(self.registries["MA-S"]), 4_000)

    def test_lookup_returns_mal_for_known_xerox(self):
        record = self.maclookup.lookup("00:00:00:11:22:33", self.registries)
        self.assertIsNotNone(record)
        self.assertEqual(record.registry, "MA-L")
        self.assertEqual(record.assignment, "000000")
        self.assertIn("XEROX", record.organization.upper())

    def test_longest_prefix_picks_mam_when_28bit_match_exists(self):
        # Find any MA-M assignment from the CSV and confirm lookup chooses MA-M
        # over a possibly-coincidental MA-L hit on the first 24 bits.
        with MAM_CSV.open(newline="", encoding="utf-8") as f:
            reader = csv.reader(f); next(reader)
            row = next(reader)
        assignment = row[1]  # 7 hex chars
        # Build a representative MAC (pad with zeroes to 12 hex chars).
        mac = assignment + "00000"
        record = self.maclookup.lookup(mac, self.registries)
        self.assertIsNotNone(record, f"no record for {mac}")
        self.assertEqual(record.registry, "MA-M",
                         "expected longest-prefix to choose MA-M over MA-L")
        self.assertEqual(record.assignment, assignment.upper())

    def test_longest_prefix_picks_mas_when_36bit_match_exists(self):
        with MAS_CSV.open(newline="", encoding="utf-8") as f:
            reader = csv.reader(f); next(reader)
            row = next(reader)
        assignment = row[1]  # 9 hex chars
        mac = assignment + "000"
        record = self.maclookup.lookup(mac, self.registries)
        self.assertIsNotNone(record, f"no record for {mac}")
        self.assertEqual(record.registry, "MA-S",
                         "expected longest-prefix to choose MA-S over shorter registries")
        self.assertEqual(record.assignment, assignment.upper())

    def test_lookup_unknown_prefix_returns_none(self):
        # FF:FF:FF is reserved / not assigned in any registry.
        self.assertIsNone(self.maclookup.lookup("FF:FF:FF:FF:FF:FF", self.registries))

    def test_lookup_handles_short_input_gracefully(self):
        # 4 hex chars is shorter than any registry prefix → no match.
        self.assertIsNone(self.maclookup.lookup("0011", self.registries))


class TestMacFormats(unittest.TestCase):
    """All vendor-emitted MAC formats must resolve to the same lookup result."""

    @classmethod
    def setUpClass(cls):
        cls.maclookup = _load_maclookup()
        cls.registries = cls.maclookup.load_all()

    def _xerox(self, input_str):
        """Lookup an input that should land on Xerox's MA-L (000000)."""
        return self.maclookup.lookup(input_str, self.registries)

    def test_canonical_formats_all_resolve(self):
        cases = [
            "00:00:00:11:22:33",     # colon
            "00-00-00-11-22-33",     # hyphen / Windows
            "000000.112233",         # dot (rare but valid)
            "0000.0011.2233",        # Cisco dotted-triple
            "000000112233",          # plain hex
            "00 00 00 11 22 33",     # space-separated
            "00:00:00",              # MA-L prefix only
            "00-00-00",              # MA-L prefix, hyphen
            "0000.00",               # MA-L prefix, dotted
            "000000",                # MA-L prefix, plain
        ]
        for c in cases:
            with self.subTest(input=c):
                rec = self._xerox(c)
                self.assertIsNotNone(rec, f"no match for {c!r}")
                self.assertEqual(rec.assignment, "000000")
                self.assertIn("XEROX", rec.organization.upper())

    def test_case_insensitivity(self):
        rec_upper = self._xerox("00:AA:BB")  # arbitrary; only checking normalize symmetry
        rec_lower = self._xerox("00:aa:bb")
        # Even if there's no Xerox match for 00:AA:BB, both calls must agree.
        self.assertEqual(rec_upper, rec_lower)

    def test_labelled_and_wrapped_inputs_resolve(self):
        cases = [
            "MAC Address: 00:00:00:11:22:33",
            "MAC: 00-00-00-11-22-33",
            "Hardware Address 0000.0011.2233",
            "HWaddr 00:00:00:11:22:33",
            "Physical Address. . . . . : 00-00-00-11-22-33",  # ipconfig style
            "ether 00:00:00:11:22:33  txqueuelen 1000  (Ethernet)",  # ifconfig style
            "(00:00:00:11:22:33)",
            "[00-00-00-11-22-33]",
            "<00:00:00:11:22:33>",
            "BIA: 0000.0011.2233",                  # Cisco "show interfaces"
        ]
        for c in cases:
            with self.subTest(input=c):
                rec = self._xerox(c)
                self.assertIsNotNone(rec, f"labelled input did not resolve: {c!r}")
                self.assertEqual(rec.assignment, "000000")

    def test_extract_mac_candidate_handles_known_shapes(self):
        f = self.maclookup.extract_mac_candidate
        self.assertEqual(f("00:1A:2B:3C:4D:5E"), "001A2B3C4D5E")
        self.assertEqual(f("00-1A-2B-3C-4D-5E"), "001A2B3C4D5E")
        self.assertEqual(f("001a.2b3c.4d5e"), "001A2B3C4D5E")
        self.assertEqual(f("001A2B3C4D5E"), "001A2B3C4D5E")
        self.assertEqual(f("MAC: 00:1A:2B:3C:4D:5E"), "001A2B3C4D5E")
        self.assertEqual(f("(00:1A:2B)"), "001A2B")
        # Plain "001A2B" is a valid 6-hex MA-L prefix.
        self.assertEqual(f("001A2B"), "001A2B")

    def test_extract_mac_candidate_rejects_vendor_text(self):
        f = self.maclookup.extract_mac_candidate
        # "3com" — the hex-only fragment "3c" is 2 chars, below the 6-char floor.
        self.assertIsNone(f("3com"))
        # "Apple" — no hex run at all.
        self.assertIsNone(f("Apple Inc"))
        # "cisco" — only "c"s and "c" repeats; not 6 contiguous.
        self.assertIsNone(f("cisco"))
        # Empty / whitespace
        self.assertIsNone(f(""))
        self.assertIsNone(f("   "))

    def test_extract_picks_longest_run(self):
        # Real-world "show interfaces" line with a leading interface index and
        # then the MAC. We want the MAC, not "0".
        f = self.maclookup.extract_mac_candidate
        self.assertEqual(
            f("GigabitEthernet0/1, MAC 00:1A:2B:3C:4D:5E up"),
            "001A2B3C4D5E",
        )

    def test_normalize_mac_preserves_legacy_behavior(self):
        # The original normalize_mac contract: strip separators, uppercase.
        # We must NOT silently start stripping labels here — callers that
        # passed already-clean input get the same result they always did.
        n = self.maclookup.normalize_mac
        self.assertEqual(n("00:1A:2B:3C:4D:5E"), "001A2B3C4D5E")
        # Label characters are NOT stripped by normalize_mac itself; they're
        # only handled by extract_mac_candidate / lookup.
        self.assertEqual(n("MAC: 00:1A:2B"), "MAC001A2B")


class TestWebDataBundle(unittest.TestCase):
    """If the PWA data bundle is present, it must agree with the source CSVs."""

    BUNDLE = REPO_ROOT / "web" / "data" / "registry.json"
    METADATA = REPO_ROOT / "web" / "data" / "metadata.json"

    def setUp(self):
        if not self.BUNDLE.exists():
            self.skipTest("web/data/registry.json not built")

    def test_bundle_counts_match_source_csvs(self):
        import json
        with self.BUNDLE.open(encoding="utf-8") as f:
            payload = json.load(f)
        counts = payload.get("counts", {})
        for label, path, _plen, _floor in REGISTRY_FIXTURES:
            with path.open(newline="", encoding="utf-8") as f:
                csv_rows = sum(1 for _ in csv.reader(f)) - 1
            self.assertEqual(
                counts.get(label), csv_rows,
                f"bundle {label} count {counts.get(label)} != CSV count {csv_rows}"
            )

    def test_bundle_has_version_stamp(self):
        import json
        with self.BUNDLE.open(encoding="utf-8") as f:
            payload = json.load(f)
        self.assertTrue(payload.get("version"), "bundle missing version field")

    def test_bundle_has_content_hash_and_registry_hashes(self):
        import json
        import re
        with self.BUNDLE.open(encoding="utf-8") as f:
            payload = json.load(f)
        sha256 = re.compile(r"^[0-9a-f]{64}$")
        self.assertTrue(sha256.match(payload.get("content_hash") or ""),
                        "bundle missing/invalid content_hash")
        reg_hashes = payload.get("registry_hashes") or {}
        for label, _path, _plen, _floor in REGISTRY_FIXTURES:
            self.assertTrue(
                sha256.match(reg_hashes.get(label) or ""),
                f"bundle missing/invalid registry_hashes[{label}]"
            )

    def test_metadata_sidecar_matches_bundle(self):
        import json
        if not self.METADATA.exists():
            self.skipTest("web/data/metadata.json not built")
        with self.BUNDLE.open(encoding="utf-8") as f:
            payload = json.load(f)
        with self.METADATA.open(encoding="utf-8") as f:
            meta = json.load(f)
        self.assertEqual(meta.get("content_hash"), payload.get("content_hash"))
        self.assertEqual(meta.get("counts"), payload.get("counts"))
        self.assertEqual(meta.get("version"), payload.get("version"))
        self.assertEqual(meta.get("registry_hashes"), payload.get("registry_hashes"))
        self.assertNotIn("registries", meta,
                         "metadata.json should not embed the full registries blob")


if __name__ == "__main__":
    unittest.main()
