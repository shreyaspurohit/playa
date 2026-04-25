"""Write data/meta.json with the timestamp + counts of the current fetch.

Displayed date ("Updated YYYY-MM-DD") is in Pacific time since that's the
relevant time zone for Burners and the user audience. The machine-readable
`fetched_at` stays UTC for unambiguity (the tooltip on the site says "UTC").
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import Config


PACIFIC = ZoneInfo("America/Los_Angeles")


def write_meta(config: Config) -> Path:
    pages = sorted(config.pages_dir.glob("page_*.json"))
    camps = 0
    events = 0
    for p in pages:
        data = json.loads(p.read_text())
        camps += len(data)
        for c in data:
            events += len(c.get("events") or [])
    now_utc = datetime.now(timezone.utc)
    pacific = now_utc.astimezone(PACIFIC)
    meta = {
        "fetched_at":   now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),  # UTC (machine-readable)
        "fetched_date": pacific.strftime("%Y-%m-%d"),             # Pacific (display)
        # Version: vYYYY.MM.DD.HHMM in **Pacific**, same TZ as
        # fetched_date so the date prefix matches and the lex-order
        # monotonicity the update banner relies on never crosses a
        # midnight boundary that's offset from the displayed date.
        "version":      "v" + pacific.strftime("%Y.%m.%d.%H%M"),
        "camps":        camps,
        "events":       events,
        "pages":        len(pages),
    }
    config.meta_file.parent.mkdir(parents=True, exist_ok=True)
    config.meta_file.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {config.meta_file}: {meta}")
    return config.meta_file
