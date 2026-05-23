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


class TestWebDataBundle(unittest.TestCase):
    """If the PWA data bundle is present, it must agree with the source CSVs."""

    BUNDLE = REPO_ROOT / "web" / "data" / "registry.json"

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


if __name__ == "__main__":
    unittest.main()
