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
    #
    # `burn_start` = gate-open day, also the location-embargo cutoff
    # (D8) and the spirit-mode auto-unlock window's open edge (D13).
    # `burn_end` = end of the public-access window (D13) and the
    # calendar's last column.
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
    #   SITE_TIERS="god-mode:$GOD_PW=directory+api-2025+api-2026,
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
            # No hardcoded fallback — operator MUST set the burn-window
            # repo variables in CI (or `export BURN_WINDOW_OPEN_FROM=…
            # BURN_WINDOW_OPEN_TO=…` locally). Empty values surface as
            # a build-time error in SiteBuilder.__init__ rather than
            # silently producing a broken site. One date semantically
            # serves multiple roles (calendar window edges + access
            # window + embargo cutoff) — see Config docstring above.
            burn_start=os.environ.get("BURN_WINDOW_OPEN_FROM", "").strip(),
            burn_end=os.environ.get("BURN_WINDOW_OPEN_TO", "").strip(),
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
