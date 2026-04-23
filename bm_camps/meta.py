"""Write data/meta.json with the timestamp + counts of the current scrape."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .config import Config


def write_meta(config: Config) -> Path:
    pages = sorted(config.pages_dir.glob("page_*.json"))
    camps = 0
    events = 0
    for p in pages:
        data = json.loads(p.read_text())
        camps += len(data)
        for c in data:
            events += len(c.get("events") or [])
    now = datetime.now(timezone.utc)
    meta = {
        "scraped_at":   now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "scraped_date": now.strftime("%Y-%m-%d"),
        "version":      "v" + now.strftime("%Y.%m.%d"),
        "camps":        camps,
        "events":       events,
        "pages":        len(pages),
    }
    config.meta_file.parent.mkdir(parents=True, exist_ok=True)
    config.meta_file.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {config.meta_file}: {meta}")
    return config.meta_file
