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

    # HTTP client settings.
    base_url: str = "https://directory.burningman.org"
    user_agent: str = _DEFAULT_UA
    fetch_timeout: int = 30
    fetch_retries: int = 3
    fetch_backoff: float = 1.5
    per_camp_sleep: float = 0.2

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
        )
