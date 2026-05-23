#!/usr/bin/env python3
"""Generate the bundled data files the PWA loads at runtime.

Produces ``web/data/registry.json`` -- one compact file the PWA can fetch in a
single request, with all three registries plus a version stamp for the "data
version" indicator and refresh logic.

Output schema (compact line-oriented payload keeps the JSON envelope tiny so
the browser parse is cheap; rows inside each registry are tab-separated to
avoid the per-row JSON-array overhead):

    {
      "version": "<iso8601-utc>",
      "counts": {"MA-L": 39461, "MA-M": 6413, "MA-S": 7019},
      "registries": {
        "MA-L": "000000\\tXEROX CORPORATION\\tM/S 105-50C ...\\n...",
        "MA-M": "...",
        "MA-S": "..."
      }
    }

Run:
    python3 scripts/build_web_data.py
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DATA_DIR = REPO_ROOT / "web" / "data"

SOURCES = [
    ("MA-L", REPO_ROOT / "oui.csv", 6),
    ("MA-M", REPO_ROOT / "mam.csv", 7),
    ("MA-S", REPO_ROOT / "oui36.csv", 9),
]


def _sanitize(s: str) -> str:
    # Strip characters that would break the tab/newline-delimited payload.
    return s.replace("\t", " ").replace("\r", " ").replace("\n", " ").strip()


def main() -> int:
    counts: dict[str, int] = {}
    registries: dict[str, str] = {}

    for label, path, prefix_len in SOURCES:
        if not path.exists():
            print(f"skip: {path} not found", file=sys.stderr)
            counts[label] = 0
            registries[label] = ""
            continue
        rows: list[str] = []
        with path.open(newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader, None)  # header
            for row in reader:
                if len(row) < 4:
                    continue
                registry, assignment, name, address = row[0], row[1].upper(), row[2], row[3]
                if registry != label or len(assignment) != prefix_len:
                    continue
                rows.append(
                    "\t".join((assignment, _sanitize(name), _sanitize(address)))
                )
        counts[label] = len(rows)
        registries[label] = "\n".join(rows)
        print(f"{label}: {len(rows)} entries from {path.name}", file=sys.stderr)

    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = WEB_DATA_DIR / "registry.json"
    payload = {
        "version": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": counts,
        "registries": registries,
    }
    with out.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    size = out.stat().st_size
    total = sum(counts.values())
    print(f"wrote {out} ({size:,} bytes, {total:,} entries)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
