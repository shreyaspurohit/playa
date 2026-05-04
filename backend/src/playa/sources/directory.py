"""Directory source — reads `data/pages/*.json` (camps) and
`data/art_pages/*.json` (art) produced by the existing `Fetcher`.

Thin adapter around the previous `SiteBuilder.load_camps` behavior:
dedupe by id, drop denylisted, no tagging or event-time enrichment
(the builder applies those post-load). Art mirrors that exactly via a
parallel `data/art_pages/` tree + parallel denylist file.
"""
from __future__ import annotations

import json
from pathlib import Path

from ..config import Config
from ..models import Art, Camp


class DirectorySource:
    name = "directory"

    def load_camps(self, config: Config) -> list[Camp]:
        denied = _load_id_set(config.denylist_file)
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

    def load_art(self, config: Config) -> list[Art]:
        denied = _load_id_set(config.art_denylist_file)
        seen: set[str] = set()
        skipped = 0
        art: list[Art] = []
        if not config.art_pages_dir.exists():
            return []
        for f in sorted(config.art_pages_dir.glob("art_*.json")):
            for raw in json.loads(f.read_text()):
                piece = Art.from_dict(raw)
                if piece.id in seen:
                    continue
                seen.add(piece.id)
                if piece.id in denied:
                    skipped += 1
                    continue
                art.append(piece)
        if skipped:
            print(f"  (skipped {skipped} art piece(s) per denylist-art)")
        return art


def _load_id_set(path: Path) -> set[str]:
    if not path.exists():
        return set()
    ids: set[str] = set()
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            ids.add(line)
    return ids


# Kept for backward compat — used by `playa.builder.SiteBuilder.load_denylist`.
def _load_denylist(config: Config) -> set[str]:
    return _load_id_set(config.denylist_file)
