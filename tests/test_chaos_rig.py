"""Wires the chaos corpus into unittest so CI fails if real-world handling
regresses.

The rig runs ``maclookup.lookup_detailed`` against every entry in
:mod:`chaos_corpus` and asserts the observed outcome matches what the
corpus pins as expected. A few coarser invariants are checked separately
so we get specific failure messages instead of one giant subtest.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

from chaos_corpus import CASES  # noqa: E402
from chaos_rig import run       # noqa: E402


class TestChaosCorpus(unittest.TestCase):
    """Every case in the corpus must match its pinned expectation."""

    @classmethod
    def setUpClass(cls):
        cls.outcomes = run(CASES)

    def test_every_case_matches_expectation(self):
        for outcome in self.outcomes:
            with self.subTest(input=outcome.case.input, category=outcome.case.category):
                self.assertTrue(
                    outcome.passed,
                    f"{outcome.case.input!r}: {outcome.reason}",
                )

    def test_no_phone_numbers_become_macs(self):
        # Regression guard for the defect surfaced by the original chaos
        # run: '1-800-555-1234' previously cleaned to '18005551234'. The
        # group-uniformity guard rejects pure-digit tokens whose groups
        # aren't all 2 or all 4 chars.
        from chaos_rig import _load_maclookup
        m = _load_maclookup()
        for phone in (
            "1-800-555-1234",
            "(415) 555-1212",
            "+44-20-7946-0958",
        ):
            with self.subTest(phone=phone):
                self.assertEqual(
                    m.extract_mac_candidates(phone), [],
                    f"{phone!r} should not produce a MAC candidate",
                )

    def test_vendor_words_never_become_macs(self):
        # Sanity invariant: a handful of words/phrases must never produce
        # a candidate, regardless of how the heuristic evolves.
        from chaos_rig import _load_maclookup
        m = _load_maclookup()
        for word in ("cisco", "Apple Inc", "3com", "deadbeef cafe"):
            cands = m.extract_mac_candidates(word)
            # 'deadbeef cafe' is 8 hex + space + 4 hex; the 8-hex chunk
            # could legitimately resolve to a MA-L parent. We don't pin
            # absence here — only the vendor words.
            if word in ("cisco", "Apple Inc", "3com"):
                with self.subTest(word=word):
                    self.assertEqual(cands, [], f"{word!r} produced {cands!r}")


if __name__ == "__main__":
    unittest.main()
