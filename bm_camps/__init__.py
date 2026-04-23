"""bm_camps — Burning Man theme-camp directory scraper + static site builder.

Entry points:
    python -m bm_camps scrape <page>     # one listing page + its detail pages
    python -m bm_camps scrape-all        # every page (parallel)
    python -m bm_camps meta              # write data/meta.json
    python -m bm_camps merge             # write data/camps.csv
    python -m bm_camps tag               # write data/camps_tagged.csv
    python -m bm_camps build             # build site/index.html
    python -m bm_camps all               # full pipeline, end-to-end

Library entry points:
    from bm_camps import Config, Scraper, Tagger, SiteBuilder, Camp, Event
"""
from .config import Config
from .models import Camp, Event
from .scraper import Scraper
from .tagger import Tagger, TAGS
from .builder import SiteBuilder

__all__ = [
    "Config", "Scraper", "Tagger", "SiteBuilder", "Camp", "Event", "TAGS",
]
