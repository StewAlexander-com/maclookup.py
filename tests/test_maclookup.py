"""Smoke tests for maclookup.py and the oui.csv data file.

These run in CI after an oui.csv refresh to catch obvious corruption (bad
header, truncated download, lookup logic regression). Uses pytest-compatible
plain asserts so it works with `python -m pytest` or `python -m unittest`.
"""
from __future__ import annotations

import csv
import importlib.util
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = REPO_ROOT / "oui.csv"
SCRIPT_PATH = REPO_ROOT / "maclookup.py"

EXPECTED_HEADER = ["Registry", "Assignment", "Organization Name", "Organization Address"]


def _load_maclookup():
    spec = importlib.util.spec_from_file_location("maclookup", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["maclookup"] = mod
    spec.loader.exec_module(mod)
    return mod


class TestOuiCsv(unittest.TestCase):
    def test_header_matches_ieee_schema(self):
        with CSV_PATH.open(newline="", encoding="utf-8") as f:
            header = next(csv.reader(f))
        self.assertEqual(header, EXPECTED_HEADER)

    def test_row_count_floor(self):
        with CSV_PATH.open(newline="", encoding="utf-8") as f:
            rows = sum(1 for _ in csv.reader(f)) - 1
        self.assertGreater(rows, 30_000, f"oui.csv only has {rows} entries")

    def test_every_assignment_is_6_hex(self):
        with CSV_PATH.open(newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader)
            for i, row in enumerate(reader, start=2):
                self.assertEqual(len(row), 4, f"row {i} has {len(row)} cols")
                assignment = row[1]
                self.assertEqual(len(assignment), 6, f"row {i}: {assignment!r}")
                int(assignment, 16)  # raises if not hex


class TestLookup(unittest.TestCase):
    """Pin behavior using OUIs that have been allocated for decades.

    These are stable, IEEE-assigned to well-known orgs, and have never been
    reassigned. If any of these fail, either the CSV is corrupted or upstream
    schema changed.
    """

    @classmethod
    def setUpClass(cls):
        cls.maclookup = _load_maclookup()

    def test_normalize_mac_handles_all_separators(self):
        n = self.maclookup.normalize_mac
        self.assertEqual(n("00:1A:7D:AA:BB:CC"), "001A7DAABBCC")
        self.assertEqual(n("00-1a-7d-aa-bb-cc"), "001A7DAABBCC")
        self.assertEqual(n("001a.7daa.bbcc"), "001A7DAABBCC")
        self.assertEqual(n("001a7daabbcc"), "001A7DAABBCC")

    def test_known_oui_xerox(self):
        # 00:00:00 / 00-00-00 is the historical Xerox OUI; oldest IEEE
        # allocation and present in every release of the registry.
        name, _addr = self.maclookup.search_oui(str(CSV_PATH), "00:00:00:11:22:33")
        self.assertIsNotNone(name, "Xerox OUI 000000 missing from oui.csv")
        self.assertIn("XEROX", name.upper())

    def test_unknown_oui_returns_none(self):
        # FF:FF:FF is reserved / not assigned to a vendor.
        name, addr = self.maclookup.search_oui(str(CSV_PATH), "FF:FF:FF:00:00:00")
        self.assertIsNone(name)
        self.assertIsNone(addr)


if __name__ == "__main__":
    unittest.main()
