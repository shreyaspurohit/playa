"""playa — Burning Man theme-camp directory scraper + static site builder.

Entry points:
    python -m playa scrape <page>     # one listing page + its detail pages
    python -m playa scrape-all        # every page (parallel)
    python -m playa meta              # write data/meta.json
    python -m playa merge             # write data/camps.csv
    python -m playa tag               # write data/camps_tagged.csv
    python -m playa build             # build site/index.html
    python -m playa all               # full pipeline, end-to-end

Library entry points:
    from playa import Config, Scraper, Tagger, SiteBuilder, Camp, Event
"""
from .config import Config
from .models import Camp, Event
from .scraper import Scraper
from .tagger import Tagger, TAGS
from .builder import SiteBuilder

__all__ = [
    "Config", "Scraper", "Tagger", "SiteBuilder", "Camp", "Event", "TAGS",
]
