"""playa — Burning Man API snapshot + static site builder.

Entry points:
    python -m playa api-fetch --year YYYY
    python -m playa build             # build site/index.html
    python -m playa all               # GIS refresh + cached API build

Library entry points:
    from playa import Config, Tagger, SiteBuilder, Camp, Event
"""
from .config import Config
from .models import Camp, Event
from .tagger import Tagger, TAGS
from .builder import SiteBuilder

__all__ = [
    "Config", "Tagger", "SiteBuilder", "Camp", "Event", "TAGS",
]
