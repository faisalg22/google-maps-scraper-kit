#!/usr/bin/env python3
"""Upload an Apollo (or similar) contacts CSV export to the outbound backend.

Usage:
  ACCESS_TOKEN=<signed-in admin's Supabase access token> \
    python3 outbound/scripts/import_csv.py apollo-export.csv [source]

`source` defaults to "apollo". The CSV is sent as JSON rows keyed by its header row to
POST /functions/v1/api/import/<source>. No third-party packages needed.
"""
import csv
import json
import os
import sys
import urllib.request

BASE = os.environ.get("OUTBOUND_API", "https://xkewgvjzpzcltrciemkf.supabase.co/functions/v1/api")


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    token = os.environ.get("ACCESS_TOKEN")
    if not token:
        sys.exit("Set ACCESS_TOKEN to a signed-in admin's Supabase access token.")
    source = sys.argv[2] if len(sys.argv) > 2 else "apollo"
    with open(sys.argv[1], newline="", encoding="utf-8-sig") as f:
        rows = [{k.strip(): (v or "").strip() for k, v in r.items() if k} for r in csv.DictReader(f)]
    print(f"Read {len(rows)} rows")
    for i in range(0, len(rows), 2000):
        req = urllib.request.Request(
            f"{BASE}/import/{source}",
            data=json.dumps({"rows": rows[i:i + 2000]}).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            print(resp.read().decode())


if __name__ == "__main__":
    main()
