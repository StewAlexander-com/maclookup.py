#!/usr/bin/env python3
"""Refresh IEEE MA-L / MA-M / MA-S CSVs from the authoritative registry.

Downloads each registry, validates it (header, row count floor, shrink guard
versus the currently committed file), and writes the result. Safe to run in CI
or locally; uses only the Python stdlib.

  python3 scripts/update_registries.py              # refresh all three
  python3 scripts/update_registries.py --registry mal mam  # subset
  python3 scripts/update_registries.py --check      # validate only
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

EXPECTED_HEADER = ["Registry", "Assignment", "Organization Name", "Organization Address"]
MAX_SHRINK_RATIO = 0.02  # Allow at most 2% fewer rows than current.


@dataclass(frozen=True)
class Registry:
    key: str            # CLI key, e.g. "mal"
    label: str          # IEEE registry label, e.g. "MA-L"
    url: str
    output: Path
    prefix_len: int     # hex chars in an Assignment
    min_rows: int       # floor; entries only grow over time


REGISTRIES: dict[str, Registry] = {
    "mal": Registry("mal", "MA-L",
                    "https://standards-oui.ieee.org/oui/oui.csv",
                    REPO_ROOT / "oui.csv", 6, 30_000),
    "mam": Registry("mam", "MA-M",
                    "https://standards-oui.ieee.org/oui28/mam.csv",
                    REPO_ROOT / "mam.csv", 7, 4_000),
    "mas": Registry("mas", "MA-S",
                    "https://standards-oui.ieee.org/oui36/oui36.csv",
                    REPO_ROOT / "oui36.csv", 9, 4_000),
}


def fetch(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "maclookup-registry-updater"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status != 200:
            raise RuntimeError(f"upstream returned HTTP {resp.status}")
        return resp.read()


def validate(data: bytes, reg: Registry) -> int:
    """Return row count after schema checks; raises on malformed input."""
    reader = csv.reader(io.StringIO(data.decode("utf-8")))
    header = next(reader, None)
    if header != EXPECTED_HEADER:
        raise ValueError(f"unexpected header: {header!r}")
    rows = 0
    for i, row in enumerate(reader, start=2):
        if len(row) < 4:
            raise ValueError(f"row {i}: expected 4 cols, got {len(row)}")
        if row[0] != reg.label:
            raise ValueError(f"row {i}: registry {row[0]!r} != {reg.label!r}")
        if len(row[1]) != reg.prefix_len:
            raise ValueError(
                f"row {i}: assignment {row[1]!r} not {reg.prefix_len} chars"
            )
        int(row[1], 16)  # hex sanity
        rows += 1
    return rows


def count_rows(path: Path, reg: Registry) -> int:
    with path.open("rb") as f:
        return validate(f.read(), reg)


def refresh_one(reg: Registry, check_only: bool) -> int:
    print(f"[{reg.label}] fetching {reg.url}", file=sys.stderr)
    data = fetch(reg.url)
    if not data:
        print(f"[{reg.label}] error: empty response", file=sys.stderr)
        return 1

    try:
        new_rows = validate(data, reg)
    except (UnicodeDecodeError, ValueError) as e:
        print(f"[{reg.label}] error: validation failed: {e}", file=sys.stderr)
        return 1

    if new_rows < reg.min_rows:
        print(f"[{reg.label}] error: only {new_rows} rows (< {reg.min_rows})",
              file=sys.stderr)
        return 1

    if reg.output.exists():
        try:
            current = count_rows(reg.output, reg)
        except (UnicodeDecodeError, ValueError) as e:
            print(f"[{reg.label}] warn: existing file invalid ({e}); will overwrite",
                  file=sys.stderr)
            current = 0
        if current and new_rows < current * (1 - MAX_SHRINK_RATIO):
            print(
                f"[{reg.label}] error: {new_rows} rows vs current {current} "
                f"(shrink > {MAX_SHRINK_RATIO:.0%})",
                file=sys.stderr,
            )
            return 1
        print(f"[{reg.label}] current={current} new={new_rows}", file=sys.stderr)
    else:
        print(f"[{reg.label}] new={new_rows}", file=sys.stderr)

    if check_only:
        print(f"[{reg.label}] ok (check only)", file=sys.stderr)
        return 0

    reg.output.write_bytes(data)
    print(f"[{reg.label}] wrote {reg.output} ({len(data)} bytes, {new_rows} entries)",
          file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--registry",
        nargs="+",
        choices=sorted(REGISTRIES),
        default=sorted(REGISTRIES),
        help="Which registries to refresh (default: all).",
    )
    parser.add_argument("--check", action="store_true",
                        help="Validate upstream without writing.")
    args = parser.parse_args()

    failures = 0
    for key in args.registry:
        failures += refresh_one(REGISTRIES[key], args.check)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
