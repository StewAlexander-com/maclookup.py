#!/usr/bin/env python3
"""Generate the bundled data files the PWA loads at runtime.

Produces:
  * ``web/data/registry.json`` — full payload (all three registries).
  * ``web/data/metadata.json`` — small sidecar with content hash, counts, and
    version, used by the PWA to decide whether the cached copy is stale
    without having to download the full ~5 MB registry on every visit.

Output schemas:

  registry.json:
    {
      "version": "<iso8601-utc>",
      "content_hash": "<sha256 of canonical registries blob>",
      "counts": {"MA-L": 39461, "MA-M": 6413, "MA-S": 7019},
      "registry_hashes": {"MA-L": "<sha256>", "MA-M": "...", "MA-S": "..."},
      "registries": {"MA-L": "...", "MA-M": "...", "MA-S": "..."}
    }

  metadata.json (same fields, minus the heavy ``registries`` blob):
    {
      "version": "...",
      "content_hash": "...",
      "counts": {...},
      "registry_hashes": {...}
    }

Rows inside each registry are tab-separated to keep the JSON envelope tiny;
the browser parses the line-oriented payload itself.

Run:
    python3 scripts/build_web_data.py
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
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


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main() -> int:
    counts: dict[str, int] = {}
    registries: dict[str, str] = {}
    registry_hashes: dict[str, str] = {}

    for label, path, prefix_len in SOURCES:
        if not path.exists():
            print(f"skip: {path} not found", file=sys.stderr)
            counts[label] = 0
            registries[label] = ""
            registry_hashes[label] = _sha256("")
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
        # Sort rows so the hash is deterministic regardless of source ordering.
        rows.sort()
        blob = "\n".join(rows)
        counts[label] = len(rows)
        registries[label] = blob
        registry_hashes[label] = _sha256(blob)
        print(f"{label}: {len(rows)} entries from {path.name}", file=sys.stderr)

    # Combined content hash is over the per-registry hashes + counts. Keeps the
    # comparison cheap (no need to rehash 4 MB on every check) and stable.
    combined_basis = "|".join(
        f"{label}:{counts[label]}:{registry_hashes[label]}"
        for label, _, _ in SOURCES
    )
    content_hash = _sha256(combined_basis)

    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

    version = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    meta_fields = {
        "version": version,
        "content_hash": content_hash,
        "counts": counts,
        "registry_hashes": registry_hashes,
    }

    registry_out = WEB_DATA_DIR / "registry.json"
    payload = {**meta_fields, "registries": registries}
    with registry_out.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    metadata_out = WEB_DATA_DIR / "metadata.json"
    with metadata_out.open("w", encoding="utf-8") as f:
        json.dump(meta_fields, f, ensure_ascii=False, separators=(",", ":"))

    size = registry_out.stat().st_size
    total = sum(counts.values())
    print(
        f"wrote {registry_out} ({size:,} bytes, {total:,} entries, "
        f"hash {content_hash[:12]}…)",
        file=sys.stderr,
    )
    print(f"wrote {metadata_out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
