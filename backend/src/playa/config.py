"""Single source of truth for paths + runtime config.

Pass a `Config` into every class that needs paths or env-derived settings
so there are no module-level globals to monkeypatch in tests.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    """Paths derive from `root`; other fields are runtime settings.

    Tests pass `root=tmp_path` and everything downstream stays under
    that tree. Env-derived fields default to unset/safe.
    """
    root: Path

    # Runtime settings (via env when using Config.from_env()).
    site_password: str = ""
    pbkdf2_iter: int = 200_000

    # Burn-week calendar window (ISO YYYY-MM-DD).
    #
    # `burn_start` is the schedule's configured fallback start and `burn_end`
    # is the calendar's last column. Password-free spirit access uses separate
    # SITE_UNLOCK_START/END repo variables evaluated by the deploy workflow;
    # those values are intentionally not part of Config.
    #
    # In practice the builder may further override `burn_start` to
    # the EARLIEST fetched event date (volunteers + early crews run
    # events before gates) via `timeparser.effective_burn_start`.
    # The configured value is the safety-net default when no dated
    # events have been fetched.
    #
    # Both REQUIRED at build time — set via env
    # (`BURN_WINDOW_OPEN_FROM` / `BURN_WINDOW_OPEN_TO`) which CI
    # sources from repo variables. No hardcoded year-specific
    # defaults; bumping to a new burn year is a CI variable change,
    # not a code change.
    burn_start: str = ""
    burn_end:   str = ""

    # Current-year API location-release policy (ADR D8). These are
    # deliberately separate because Burning Man publishes camp
    # locations to users one week before art locations. Values must
    # be timezone-aware ISO-8601 timestamps so the client observes
    # Pacific midnight exactly rather than UTC midnight. Required
    # when `api-<brc_map_year>` is embedded; past-year API builds do not
    # need them.
    camp_location_release_at: str = ""
    art_location_release_at: str = ""

    # api.burningman.org settings. Empty key → API fetching disabled (cached
    # builds remain available).
    # build attempting it will raise rather than fall back silently).
    bm_api_key: str = ""
    bm_api_base_url: str = "https://api.burningman.org"
    bm_api_year_min: int = 2015   # spec exclusiveMinimum: 2014
    # Bulk endpoints return several MB of JSON in one request. Override via
    # BM_API_TIMEOUT for extreme-payload years or rate-limited servers.
    bm_api_timeout: int = 120
    bm_api_retries: int = 3
    bm_api_backoff: float = 1.5
    # Identify ourselves clearly to the API.
    bm_api_user_agent: str = "playa-camps/1.0 (+https://playa.purohit.dev)"

    # Official annual GIS repository. The map renderer is year-stable; adding
    # a year means fetching that year's files and reviewing the CPN allowlist.
    gis_base_url: str = (
        "https://raw.githubusercontent.com/burningmantech/"
        "innovate-GIS-data/master"
    )
    gis_timeout: int = 30
    brc_map_year: int = 2026

    # Comma-separated years to auto-fetch + auto-include in the build
    # when --sources isn't passed explicitly. Empty is invalid for build/all.
    bm_api_years: str = ""

    # Multi-tier access manifest (ADR D10). Format:
    #   <name1>:<pw1>=<src>+<src>,<name2>:<pw2>=<src>+<src>,…
    # Each tier (name + password) unlocks the listed sources via
    # per-source envelope encryption — one source cipher + one
    # wrapper per tier that should reach it.
    #
    # Tier names are required + identify the role explicitly so the
    # build can validate setup. Reserved name `spirit-mode` is
    # recognized by D13: when BURN_OPEN=1, that tier's source DEKs
    # are written to `site/burn-key.json` for password-less unlock.
    # Other names (`god-mode`, `demigod-mode`, …) are arbitrary
    # identifiers — operator can pick anything.
    #
    # Conventionally:
    #   SITE_TIERS="god-mode:$GOD_PW=api-2025+api-2026,
    #               demigod-mode:$DEMIGOD_PW=api-2025+api-2026,
    #               spirit-mode:$SPIRIT_PW=api-2026"
    # — literal passwords stay out of workflow YAML via per-tier
    # secrets, and tier order doesn't matter (lookup is by name).
    #
    # Empty → falls through to single-tier `site_password` behavior.
    site_tiers: str = ""

    # Password used to encrypt the cache assets uploaded to GitHub
    # Releases. Distinct from `site_password` so rotating the public-
    # facing site password doesn't force a re-fetch + re-upload of
    # every past year's cache. Falls back to `site_password` if unset
    # — single-secret deployments still work.
    bm_cache_password: str = ""

    # Optional browser-side cloud sync (ADR 16). The Dropbox app key is a
    # public OAuth client identifier, not a secret. Empty provider keeps the
    # default build fully local/offline and emits no provider endpoints.
    sync_provider: str = ""
    sync_client_id: str = ""

    # --- Path accessors (all derive from root) -----------------------------

    @property
    def data_dir(self) -> Path:       return self.root / "data"
    @property
    def api_denylist_file(self) -> Path: return self.data_dir / "denylist-api.txt"
    @property
    def art_api_denylist_file(self) -> Path: return self.data_dir / "denylist-art-api.txt"
    def food_exclusion_file(self, source_spec: str) -> Path:
        """API-year-scoped Food-only classification exclusions."""
        if not (
            source_spec.startswith("api-")
            and len(source_spec) == 8
            and source_spec[4:].isdigit()
        ):
            raise ValueError(
                f"Food exclusions require an api-YYYY source, got {source_spec!r}",
            )
        return self.data_dir / f"food-exclusions-{source_spec}.txt"
    @property
    def api_dir(self) -> Path:        return self.data_dir / "api"
    def api_payload_file(self, year: int) -> Path:
        return self.api_dir / f"{year}.json"
    @property
    def gis_dir(self) -> Path:        return self.data_dir / "gis"
    def gis_year_dir(self, year: int) -> Path:
        return self.gis_dir / str(year)
    def gis_payload_file(self, year: int) -> Path:
        return self.gis_year_dir(year) / "normalized.json"
    @property
    def site_dir(self) -> Path:       return self.root / "site"
    @property
    def site_html(self) -> Path:      return self.site_dir / "index.html"

    # --- Factories ---------------------------------------------------------

    @classmethod
    def project_root(cls) -> Path:
        """Repository root = parent of `backend/`.

        Walks up from `backend/src/playa/config.py` four levels:
          parents[0] = playa/
          parents[1] = src/
          parents[2] = backend/
          parents[3] = repo root   ✓

        Only valid for editable installs (`pip install -e ./backend`) or
        running from the source tree. A non-editable wheel install would
        put `__file__` in site-packages and break this calculation — we
        don't support that mode."""
        return Path(__file__).resolve().parents[3]

    @classmethod
    def from_env(cls, root: Path | None = None) -> "Config":
        """Build a Config from env vars. Used by the CLI entry points."""
        return cls(
            root=root or cls.project_root(),
            site_password=os.environ.get("SITE_PASSWORD", "").strip(),
            pbkdf2_iter=int(os.environ.get("PBKDF2_ITER", "200000")),
            # No hardcoded fallback — operator MUST set the burn-window
            # repo variables in CI (or `export BURN_WINDOW_OPEN_FROM=…
            # BURN_WINDOW_OPEN_TO=…` locally). Empty values surface as
            # a build-time error in SiteBuilder.__init__ rather than
            # silently producing a broken site. Location disclosure
            # has its own timestamp settings below; do not reuse this
            # schedule/access date for the D8 embargo.
            burn_start=os.environ.get("BURN_WINDOW_OPEN_FROM", "").strip(),
            burn_end=os.environ.get("BURN_WINDOW_OPEN_TO", "").strip(),
            camp_location_release_at=os.environ.get(
                "CAMP_LOCATION_RELEASE_AT", "",
            ).strip(),
            art_location_release_at=os.environ.get(
                "ART_LOCATION_RELEASE_AT", "",
            ).strip(),
            bm_api_key=os.environ.get("BM_API_KEY", "").strip(),
            bm_api_base_url=os.environ.get(
                "BM_API_BASE_URL", "https://api.burningman.org",
            ).strip(),
            bm_api_years=os.environ.get("BM_API_YEARS", "").strip(),
            bm_cache_password=os.environ.get("BM_CACHE_PASSWORD", "").strip(),
            bm_api_timeout=int(os.environ.get("BM_API_TIMEOUT", "120")),
            bm_api_retries=int(os.environ.get("BM_API_RETRIES", "3")),
            bm_api_backoff=float(os.environ.get("BM_API_BACKOFF", "1.5")),
            gis_base_url=os.environ.get(
                "BM_GIS_BASE_URL",
                "https://raw.githubusercontent.com/burningmantech/"
                "innovate-GIS-data/master",
            ).strip(),
            gis_timeout=int(os.environ.get("BM_GIS_TIMEOUT", "30")),
            brc_map_year=int(os.environ.get("BRC_MAP_YEAR", "2026")),
            site_tiers=os.environ.get("SITE_TIERS", "").strip(),
            sync_provider=os.environ.get("SYNC_PROVIDER", "").strip().lower(),
            sync_client_id=os.environ.get("SYNC_CLIENT_ID", "").strip(),
        )

    # --- Derived settings --------------------------------------------------

    @property
    def effective_cache_password(self) -> str:
        """Cache password with site-password fallback. Lets a small
        deployment use one secret for everything, while a more careful
        setup keeps the two independent for rotation hygiene."""
        return self.bm_cache_password or self.site_password

    def parsed_api_years(self) -> list[int]:
        """Parse `bm_api_years` into a sorted unique year list.

        Blank entries are ignored, but malformed or unsupported years fail
        rather than quietly changing the configured source manifest.
        """
        out: set[int] = set()
        for part in self.bm_api_years.split(","):
            part = part.strip()
            if not part:
                continue
            if len(part) != 4 or not part.isdigit():
                raise ValueError(f"invalid BM_API_YEARS entry {part!r}; expected YYYY")
            y = int(part)
            if y < self.bm_api_year_min:
                raise ValueError(
                    f"BM_API_YEARS entry {y} is below {self.bm_api_year_min}",
                )
            out.add(y)
        return sorted(out)

    def parsed_tiers(self) -> list[tuple[str, str, list[str]]]:
        """Parse `site_tiers` into [(name, password, [source, …]), …].

        Format: `name1:pw1=src1+src2,name2:pw2=src3,…`.
        Returns [] when the field is empty (single-tier fallback).

        Sanity checks (raise ValueError on violation):
          - duplicate tier names or passwords (ambiguous semantics)
          - empty tier name, password, or source list
          - missing `:` (no tier name) — operator must label tiers
            explicitly so the build can identify spirit-mode by name
            (was position-based, fragile across operator edits)
        Format-bad entries raise ValueError — silent drop on a multi-
        tier config would be a foot-gun.

        Splitting is lenient: split on FIRST `:` for name, then FIRST
        `=` for pw / sources. Passwords containing `:` or `=` chars
        survive intact.
        """
        if not self.site_tiers.strip():
            return []
        seen_names: set[str] = set()
        seen_pws: set[str] = set()
        out: list[tuple[str, str, list[str]]] = []
        for raw in self.site_tiers.split(","):
            entry = raw.strip()
            if not entry:
                continue
            if ":" not in entry or "=" not in entry:
                raise ValueError(
                    f"SITE_TIERS entry must be 'name:password=src1+src2': "
                    f"{entry!r} (missing ':' or '=')",
                )
            name, rest = entry.split(":", 1)
            pw, srcs_raw = rest.split("=", 1)
            name = name.strip()
            pw = pw.strip()
            if not name:
                raise ValueError(f"SITE_TIERS entry has empty name: {entry!r}")
            if not pw:
                raise ValueError(
                    f"SITE_TIERS tier {name!r} has empty password",
                )
            if name in seen_names:
                raise ValueError(
                    f"SITE_TIERS has duplicate tier name {name!r}",
                )
            if pw in seen_pws:
                raise ValueError(
                    f"SITE_TIERS has duplicate password — tier semantics "
                    "would be ambiguous. Each tier needs a distinct password.",
                )
            seen_names.add(name)
            seen_pws.add(pw)
            srcs = [s.strip() for s in srcs_raw.split("+") if s.strip()]
            if not srcs:
                raise ValueError(
                    f"SITE_TIERS tier {name!r} has no sources listed",
                )
            out.append((name, pw, srcs))
        return out
