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
from typing import Iterable, NamedTuple, Optional

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


def normalize_mac(mac_address: str) -> str:
    """Strip common separators and uppercase the input."""
    return re.sub(r"[-:.\s]", "", mac_address).upper()


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


def lookup(
    mac_address: str,
    registries: Optional[dict[str, dict[str, VendorRecord]]] = None,
) -> Optional[VendorRecord]:
    """Longest-prefix lookup: try MA-S (9), then MA-M (7), then MA-L (6).

    Returns ``None`` if no registry contains a matching prefix. Pass a
    pre-loaded ``registries`` mapping to avoid re-reading CSVs on each call.
    """
    if registries is None:
        registries = load_all()
    normalized = normalize_mac(mac_address)
    for registry in REGISTRY_ORDER:
        table = registries.get(registry)
        if not table:
            continue
        prefix = normalized[: REGISTRY_PREFIX_LEN[registry]]
        if len(prefix) < REGISTRY_PREFIX_LEN[registry]:
            continue
        record = table.get(prefix)
        if record is not None:
            return record
    return None


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
        "001A7D, 0000.0C12\n"
        f"Loaded: {loaded}\n"
        "Type 'q' to quit"))

    while True:
        user_input = input('\nEnter MAC/OUI (or "q" to quit): ').strip()
        if user_input.lower() in ("q", "quit"):
            print("\nExiting...")
            break

        normalized = normalize_mac(user_input)
        if len(normalized) < 6:
            print(format_output("Error", "Need at least 6 hex characters"))
            continue

        record = lookup(user_input, registries)
        if record:
            print(format_output("Found", _describe(record)))
        else:
            print(format_output("Not Found",
                                f"No entry for {normalized[:9]}"))


if __name__ == "__main__":
    main()
