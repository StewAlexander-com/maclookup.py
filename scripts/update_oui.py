#!/usr/bin/env python3
"""Download the latest IEEE OUI CSV and validate it before replacing oui.csv.

Source: https://standards-oui.ieee.org/oui/oui.csv (authoritative IEEE MA-L registry).

Validation guards against silently committing a truncated or malformed file:
  * HTTP 200 with non-empty body
  * Parses as CSV with the expected header
  * Row count is within a sane floor and not a large regression vs. the
    currently committed file (entries only grow over time)
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import urllib.request
from pathlib import Path

UPSTREAM_URL = "https://standards-oui.ieee.org/oui/oui.csv"
EXPECTED_HEADER = ["Registry", "Assignment", "Organization Name", "Organization Address"]
MIN_ROWS = 30_000  # Floor; registry had ~37k MA-L entries in 2026.
MAX_SHRINK_RATIO = 0.02  # Allow at most 2% fewer rows than current.


def fetch(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "maclookup-oui-updater"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status != 200:
            raise RuntimeError(f"upstream returned HTTP {resp.status}")
        return resp.read()


def count_rows(data: bytes) -> int:
    reader = csv.reader(io.StringIO(data.decode("utf-8")))
    header = next(reader, None)
    if header != EXPECTED_HEADER:
        raise ValueError(f"unexpected header: {header!r}")
    return sum(1 for _ in reader)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="oui.csv", help="Path to write (default: oui.csv)")
    parser.add_argument("--url", default=UPSTREAM_URL, help="Override source URL")
    parser.add_argument("--check", action="store_true",
                        help="Validate only; do not write")
    args = parser.parse_args()

    out_path = Path(args.output)
    print(f"Fetching {args.url} ...", file=sys.stderr)
    data = fetch(args.url)
    if not data:
        print("error: empty response", file=sys.stderr)
        return 1

    try:
        new_rows = count_rows(data)
    except (UnicodeDecodeError, ValueError) as e:
        print(f"error: validation failed: {e}", file=sys.stderr)
        return 1

    if new_rows < MIN_ROWS:
        print(f"error: only {new_rows} rows (< {MIN_ROWS}); refusing to write",
              file=sys.stderr)
        return 1

    if out_path.exists():
        with out_path.open("rb") as f:
            current_rows = count_rows(f.read())
        if new_rows < current_rows * (1 - MAX_SHRINK_RATIO):
            print(
                f"error: new file has {new_rows} rows, current has {current_rows} "
                f"(shrink > {MAX_SHRINK_RATIO:.0%}); refusing to write",
                file=sys.stderr,
            )
            return 1
        print(f"current rows: {current_rows}; new rows: {new_rows}", file=sys.stderr)
    else:
        print(f"new rows: {new_rows}", file=sys.stderr)

    if args.check:
        print("ok (check only)", file=sys.stderr)
        return 0

    out_path.write_bytes(data)
    print(f"wrote {out_path} ({len(data)} bytes, {new_rows} entries)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
