"""HTTP fetcher — pull a listing page + its detail pages.

Network I/O lives here (and nowhere else). Retries + backoff built in;
per-camp sleep keeps us polite. Caller handles parallelism (see `cli.py`).
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from .config import Config
from .models import Camp
from .parsers import DetailParser, ListingParser


class Fetcher:
    def __init__(self, config: Config):
        self.config = config

    def fetch(self, url: str) -> str:
        """GET the URL with retries; raises on final failure."""
        req = urllib.request.Request(url, headers={"User-Agent": self.config.user_agent})
        last_err: Exception | None = None
        for attempt in range(self.config.fetch_retries):
            try:
                with urllib.request.urlopen(req, timeout=self.config.fetch_timeout) as r:
                    return r.read().decode("utf-8", errors="replace")
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
                last_err = e
                time.sleep(self.config.fetch_backoff * (attempt + 1))
        raise RuntimeError(f"failed to fetch {url}: {last_err}")

    def fetch_page(self, page: int) -> list[Camp]:
        """Pull listing page N + each camp's detail page, return Camp list.

        Detail-fetch failures fall back to listing-page data so one bad
        camp doesn't abort the whole page.
        """
        listing_url = f"{self.config.base_url}/camps/?page={page}"
        print(f"[page {page}] fetching listing: {listing_url}", file=sys.stderr)
        listing_html = self.fetch(listing_url)
        entries = list(ListingParser.parse(listing_html))
        print(f"[page {page}] found {len(entries)} camps", file=sys.stderr)

        camps: list[Camp] = []
        for i, (cid, name, loc_listing, short_desc) in enumerate(entries, 1):
            detail_url = f"{self.config.base_url}/camps/{cid}/"
            try:
                detail_html = self.fetch(detail_url)
                d_name, d_loc, d_web, d_desc, d_events = DetailParser.parse(detail_html)
                camp = Camp(
                    id=cid,
                    name=d_name or name,
                    location=d_loc or loc_listing,
                    description=d_desc or short_desc,
                    website=d_web,
                    url=detail_url,
                    events=d_events,
                )
            except Exception as e:
                print(f"[page {page}] {cid}: detail fetch failed ({e}); "
                      f"using listing data", file=sys.stderr)
                camp = Camp(
                    id=cid, name=name, location=loc_listing,
                    description=short_desc, website="", url=detail_url,
                    events=[],
                )
            camps.append(camp)
            ev_note = f" [{len(camp.events)} events]" if camp.events else ""
            web_note = " [web]" if camp.website else ""
            print(f"[page {page}] {i}/{len(entries)} {cid} {camp.name}"
                  f"{web_note}{ev_note}", file=sys.stderr)
            time.sleep(self.config.per_camp_sleep)
        return camps

    def fetch_page_to_file(self, page: int) -> Path:
        """Pull one page and write data/pages/page_NN.json. Returns path."""
        camps = self.fetch_page(page)
        self.config.pages_dir.mkdir(parents=True, exist_ok=True)
        out = self.config.pages_dir / f"page_{page:02d}.json"
        out.write_text(json.dumps(
            [c.to_dict() for c in camps],
            indent=2, ensure_ascii=False,
        ))
        print(f"[page {page}] wrote {out} ({len(camps)} camps)", file=sys.stderr)
        return out
