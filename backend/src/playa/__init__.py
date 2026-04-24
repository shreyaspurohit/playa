"""playa — Burning Man theme-camp directory fetcher + static site builder.

Entry points:
    python -m playa fetch <page>      # one listing page + its detail pages
    python -m playa fetch-all         # every page (parallel)
    python -m playa meta              # write data/meta.json
    python -m playa merge             # write data/camps.csv
    python -m playa tag               # write data/camps_tagged.csv
    python -m playa build             # build site/index.html
    python -m playa all               # full pipeline, end-to-end

Library entry points:
    from playa import Config, Fetcher, Tagger, SiteBuilder, Camp, Event
"""
from .config import Config
from .models import Camp, Event
from .fetcher import Fetcher
from .tagger import Tagger, TAGS
from .builder import SiteBuilder

__all__ = [
    "Config", "Fetcher", "Tagger", "SiteBuilder", "Camp", "Event", "TAGS",
]
