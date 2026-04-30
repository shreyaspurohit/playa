"""Single source of truth for paths + runtime config.

Pass a `Config` into every class that needs paths or env-derived settings
so there are no module-level globals to monkeypatch in tests.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


_DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)


@dataclass(frozen=True)
class Config:
    """Paths derive from `root`; other fields are runtime settings.

    Tests pass `root=tmp_path` and everything downstream stays under
    that tree. Env-derived fields default to unset/safe.
    """
    root: Path

    # Runtime settings (via env when using Config.from_env()).
    site_password: str = ""
    contact_email: str = "bm-camps@example.com"
    pbkdf2_iter: int = 200_000
    pages: int = 30
    parallel: int = 5

    # Burn week window (ISO YYYY-MM-DD).
    #  * burn_end is authoritative — fixed end of the calendar, from
    #    the ticketing page (2026: Mon Sep 7).
    #  * burn_start is a fallback. In practice the builder overrides it
    #    with the EARLIEST fetched event date (volunteers + early crews
    #    run events before gates) via timeparser.effective_burn_start.
    #    The configured value is only used when the corpus has no
    #    dated events yet, or when fetched dates are out of phase with
    #    this year's calendar.
    # Override via BURN_START / BURN_END env vars at build time, or
    # refresh the defaults annually via the /update-map skill.
    burn_start: str = "2026-08-30"
    burn_end:   str = "2026-09-07"

    # HTTP client settings (directory + API share these).
    base_url: str = "https://directory.burningman.org"
    user_agent: str = _DEFAULT_UA
    fetch_timeout: int = 30
    fetch_retries: int = 3
    fetch_backoff: float = 1.5
    per_camp_sleep: float = 0.2

    # api.burningman.org settings. Empty key → API source disabled (any
    # build attempting it will raise rather than fall back silently).
    bm_api_key: str = ""
    bm_api_base_url: str = "https://api.burningman.org"
    bm_api_year_min: int = 2015   # spec exclusiveMinimum: 2014
    # Bulk endpoints return ~MB of JSON in one shot — much slower than
    # the directory's per-page fetches. Override via BM_API_TIMEOUT for
    # extreme-payload years or rate-limited servers.
    bm_api_timeout: int = 120
    # Identify ourselves clearly to the API. Distinct from `user_agent`
    # which mimics a browser for the directory HTML scrape — that
    # string makes WAFs throttle JSON-endpoint clients on the
    # assumption it's a scraper. A clean app/version + contact URL
    # gets fast-pathed.
    bm_api_user_agent: str = "playa-camps/1.0 (+https://playa.purohit.dev)"

    # Comma-separated years to auto-fetch + auto-include in the build
    # when --sources isn't passed explicitly. Empty → CLI default of
    # `directory` only.
    #   BM_API_YEARS="2024,2025"  → sources = directory,api-2024,api-2025
    bm_api_years: str = ""

    # Multi-tier access manifest (ADR D10). Format:
    #   <pw1>=<src>+<src>,<pw2>=<src>+<src>,…
    # Each tier (password) unlocks the listed sources via per-source
    # envelope encryption — one source cipher + one wrapper per tier
    # that should reach it. Empty → falls through to single-tier
    # `site_password` behavior. Conventionally the operator sets:
    #   SITE_TIERS="$GOD_PW=directory+api-2025+api-2026,
    #               $DEMIGOD_PW=api-2025+api-2026,
    #               $SPIRIT_PW=api-2026"
    # so literal passwords don't sit in the workflow YAML.
    site_tiers: str = ""

    # Password used to encrypt the cache assets uploaded to GitHub
    # Releases. Distinct from `site_password` so rotating the public-
    # facing site password doesn't force a re-fetch + re-upload of
    # every past year's cache. Falls back to `site_password` if unset
    # — single-secret deployments still work.
    bm_cache_password: str = ""

    # --- Path accessors (all derive from root) -----------------------------

    @property
    def data_dir(self) -> Path:       return self.root / "data"
    @property
    def pages_dir(self) -> Path:      return self.data_dir / "pages"
    @property
    def logs_dir(self) -> Path:       return self.data_dir / "logs"
    @property
    def meta_file(self) -> Path:      return self.data_dir / "meta.json"
    @property
    def camps_csv(self) -> Path:      return self.data_dir / "camps.csv"
    @property
    def camps_tagged_csv(self) -> Path: return self.data_dir / "camps_tagged.csv"
    @property
    def denylist_file(self) -> Path:  return self.data_dir / "denylist.txt"
    @property
    def api_denylist_file(self) -> Path: return self.data_dir / "denylist-api.txt"
    @property
    def api_dir(self) -> Path:        return self.data_dir / "api"
    def api_payload_file(self, year: int) -> Path:
        return self.api_dir / f"{year}.json"
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
            contact_email=os.environ.get("CONTACT_EMAIL", "bm-camps@example.com").strip(),
            pbkdf2_iter=int(os.environ.get("PBKDF2_ITER", "200000")),
            pages=int(os.environ.get("PAGES", "30")),
            parallel=int(os.environ.get("PARALLEL", "5")),
            burn_start=os.environ.get("BURN_START", "2026-08-30").strip(),
            burn_end=os.environ.get("BURN_END", "2026-09-07").strip(),
            bm_api_key=os.environ.get("BM_API_KEY", "").strip(),
            bm_api_base_url=os.environ.get(
                "BM_API_BASE_URL", "https://api.burningman.org",
            ).strip(),
            bm_api_years=os.environ.get("BM_API_YEARS", "").strip(),
            bm_cache_password=os.environ.get("BM_CACHE_PASSWORD", "").strip(),
            bm_api_timeout=int(os.environ.get("BM_API_TIMEOUT", "120")),
            site_tiers=os.environ.get("SITE_TIERS", "").strip(),
        )

    # --- Derived settings --------------------------------------------------

    @property
    def effective_cache_password(self) -> str:
        """Cache password with site-password fallback. Lets a small
        deployment use one secret for everything, while a more careful
        setup keeps the two independent for rotation hygiene."""
        return self.bm_cache_password or self.site_password

    def parsed_api_years(self) -> list[int]:
        """Parse `bm_api_years` into a sorted unique year list. Bad
        entries are silently dropped; the empty string returns []."""
        out: set[int] = set()
        for part in self.bm_api_years.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                y = int(part)
            except ValueError:
                continue
            if y >= self.bm_api_year_min:
                out.add(y)
        return sorted(out)

    def parsed_tiers(self) -> list[tuple[str, list[str]]]:
        """Parse `site_tiers` into [(password, [source, …]), …].

        Format: `pw1=src1+src2,pw2=src3,…`.
        Returns [] when the field is empty (single-tier fallback).

        Sanity checks (raise ValueError on violation):
          - duplicate passwords (ambiguous tier semantics)
          - empty source list for any tier (pointless tier)
          - empty password (shape error)
        Format-bad entries (no `=`, etc.) raise ValueError too — silent
        drop on a multi-tier config would be a foot-gun.
        """
        if not self.site_tiers.strip():
            return []
        seen_pws: set[str] = set()
        out: list[tuple[str, list[str]]] = []
        for raw in self.site_tiers.split(","):
            entry = raw.strip()
            if not entry:
                continue
            if "=" not in entry:
                raise ValueError(
                    f"SITE_TIERS entry missing '=': {entry!r}",
                )
            pw, srcs_raw = entry.split("=", 1)
            pw = pw.strip()
            if not pw:
                raise ValueError(f"SITE_TIERS entry has empty password: {entry!r}")
            if pw in seen_pws:
                raise ValueError(
                    f"SITE_TIERS has duplicate password — tier semantics "
                    "would be ambiguous. Each tier needs a distinct password.",
                )
            seen_pws.add(pw)
            srcs = [s.strip() for s in srcs_raw.split("+") if s.strip()]
            if not srcs:
                raise ValueError(
                    f"SITE_TIERS tier has no sources listed: {entry!r}",
                )
            out.append((pw, srcs))
        return out
