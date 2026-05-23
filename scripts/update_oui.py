#!/usr/bin/env python3
"""Backward-compatible shim: refresh just the MA-L registry (oui.csv).

The full updater lives in ``scripts/update_registries.py`` and handles MA-L,
MA-M, and MA-S. This script is kept so existing automation and docs pointing
at ``scripts/update_oui.py`` continue to work.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from update_registries import REGISTRIES, refresh_one  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(REGISTRIES["mal"].output),
                        help="Path to write (default: oui.csv).")
    parser.add_argument("--url", default=REGISTRIES["mal"].url,
                        help="Override source URL.")
    parser.add_argument("--check", action="store_true",
                        help="Validate only; do not write.")
    args = parser.parse_args()

    reg = REGISTRIES["mal"]
    # Honor legacy overrides without mutating the shared registry config.
    if args.output != str(reg.output) or args.url != reg.url:
        from dataclasses import replace
        reg = replace(reg, output=Path(args.output), url=args.url)
    return refresh_one(reg, args.check)


if __name__ == "__main__":
    sys.exit(main())
