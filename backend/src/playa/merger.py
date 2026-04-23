"""Merge data/pages/page_*.json into a single CSV (tags column blank).

The site build doesn't use this CSV — it's kept as a human-friendly
spreadsheet export. `tag.py`-equivalent logic is in `Tagger`.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

from .config import Config


FIELDS = ["camp_name", "location", "description", "website", "tags"]


def merge_csv(config: Config) -> Path:
    seen_ids: set[str] = set()
    rows: list[dict] = []
    for f in sorted(config.pages_dir.glob("page_*.json")):
        for camp in json.loads(f.read_text()):
            cid = str(camp["id"])
            if cid in seen_ids:
                continue
            seen_ids.add(cid)
            rows.append({
                "camp_name":   camp.get("name", ""),
                "location":    camp.get("location", ""),
                "description": camp.get("description", ""),
                "website":     camp.get("website", ""),
                "tags":        "",
            })
    rows.sort(key=lambda r: r["camp_name"].lower())

    config.camps_csv.parent.mkdir(parents=True, exist_ok=True)
    with config.camps_csv.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {config.camps_csv} ({len(rows)} camps)")
    return config.camps_csv


def write_tagged_csv(config: Config, rows: list[dict]) -> Path:
    """Write the fully-tagged CSV. Called from the build step, which has
    already loaded + tagged the camps."""
    config.camps_tagged_csv.parent.mkdir(parents=True, exist_ok=True)
    with config.camps_tagged_csv.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {config.camps_tagged_csv} ({len(rows)} camps)")
    return config.camps_tagged_csv
