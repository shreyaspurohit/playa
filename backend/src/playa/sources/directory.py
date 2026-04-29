"""Directory source — reads `data/pages/*.json` produced by the existing
`Fetcher`. This is a thin adapter around the previous `SiteBuilder.load_camps`
behavior: dedupe by id, drop denylisted, no tagging or event-time enrichment
(the builder applies those post-load).
"""
from __future__ import annotations

import json

from ..config import Config
from ..models import Camp


class DirectorySource:
    name = "directory"

    def load_camps(self, config: Config) -> list[Camp]:
        denied = _load_denylist(config)
        seen: set[str] = set()
        skipped = 0
        camps: list[Camp] = []
        for f in sorted(config.pages_dir.glob("page_*.json")):
            for raw in json.loads(f.read_text()):
                camp = Camp.from_dict(raw)
                if camp.id in seen:
                    continue
                seen.add(camp.id)
                if camp.id in denied:
                    skipped += 1
                    continue
                camps.append(camp)
        if skipped:
            print(f"  (skipped {skipped} camp(s) per denylist)")
        return camps


def _load_denylist(config: Config) -> set[str]:
    if not config.denylist_file.exists():
        return set()
    ids: set[str] = set()
    for line in config.denylist_file.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            ids.add(line)
    return ids
