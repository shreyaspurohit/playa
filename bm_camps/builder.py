"""Build the self-contained site/index.html.

Reads the HTML template from `bm_camps/templates/site.html`, loads camps
from `data/pages/`, applies tags and denylist, optionally encrypts the
payload via openssl + PBKDF2 + AES-256-CBC, substitutes placeholders,
and writes the result.

Placeholders in the template:
    __DATA_SCRIPT__     — the <script> tag holding plaintext or encrypted data
    __BODY_CLASS__      — "gated" when encrypted, "" otherwise
    __GATE_HIDDEN__     — "" when encrypted (shown), "gate-hidden" otherwise
    __CONTACT_EMAIL__   — footer + modal takedown mailto
    __VERSION__         — vYYYY.MM.DD
    __SCRAPED_DATE__    — YYYY-MM-DD
    __SCRAPED_AT__      — YYYY-MM-DDTHH:MM:SSZ (tooltip)
"""
from __future__ import annotations

import base64
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import Config
from .models import Camp
from .tagger import Tagger


TEMPLATE_PATH = Path(__file__).parent / "templates" / "site.html"
PACIFIC = ZoneInfo("America/Los_Angeles")


class SiteBuilder:
    def __init__(self, config: Config, tagger: Tagger | None = None):
        self.config = config
        self.tagger = tagger or Tagger()

    # --- data loading -----------------------------------------------------

    def load_denylist(self) -> set[str]:
        """Read data/denylist.txt; comments (# …) and blanks ignored."""
        if not self.config.denylist_file.exists():
            return set()
        ids: set[str] = set()
        for line in self.config.denylist_file.read_text().splitlines():
            line = line.split("#", 1)[0].strip()
            if line:
                ids.add(line)
        return ids

    def load_meta(self) -> dict:
        """Scrape metadata — falls back to page-file mtime when meta.json
        is missing, and to a sensible default when nothing is there yet."""
        if self.config.meta_file.exists():
            try:
                return json.loads(self.config.meta_file.read_text())
            except Exception:
                pass
        pages = sorted(self.config.pages_dir.glob("page_*.json"))
        if not pages:
            return {"scraped_date": "unknown", "version": "v0.0.0"}
        newest = max(p.stat().st_mtime for p in pages)
        dt_utc = datetime.fromtimestamp(newest, tz=timezone.utc)
        dt_pt = dt_utc.astimezone(PACIFIC)
        return {
            "scraped_at":   dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "scraped_date": dt_pt.strftime("%Y-%m-%d"),   # Pacific for display
            "version":      "v" + dt_pt.strftime("%Y.%m.%d"),
        }

    def load_camps(self) -> list[Camp]:
        """Dedupe by id, skip denylisted, apply tags, sort by lowercased name."""
        denied = self.load_denylist()
        seen: set[str] = set()
        skipped = 0
        camps: list[Camp] = []
        for f in sorted(self.config.pages_dir.glob("page_*.json")):
            for raw in json.loads(f.read_text()):
                camp = Camp.from_dict(raw)
                if camp.id in seen:
                    continue
                seen.add(camp.id)
                if camp.id in denied:
                    skipped += 1
                    continue
                camp.tags = self.tagger.tag_camp(camp)
                camps.append(camp)
        camps.sort(key=lambda c: c.name.lower())
        if skipped:
            print(f"  (skipped {skipped} camp(s) per denylist)")
        return camps

    # --- encryption -------------------------------------------------------

    def encrypt_payload(self, plaintext: bytes) -> dict:
        """AES-256-CBC + PBKDF2-HMAC-SHA256 via openssl CLI.

        Returns {salt, iter, ct} as base64. The browser decrypts this via
        Web Crypto (see the JS in templates/site.html): PBKDF2 → 48-byte
        key||iv split → AES-CBC decrypt.
        """
        proc = subprocess.run(
            [
                "openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2",
                "-iter", str(self.config.pbkdf2_iter),
                "-pass", f"pass:{self.config.site_password}",
            ],
            input=plaintext, capture_output=True, check=True,
        )
        blob = proc.stdout
        if blob[:8] != b"Salted__":
            raise RuntimeError(f"unexpected openssl output: {blob[:16]!r}")
        salt = blob[8:16]
        ciphertext = blob[16:]
        return {
            "salt": base64.b64encode(salt).decode("ascii"),
            "iter": self.config.pbkdf2_iter,
            "ct":   base64.b64encode(ciphertext).decode("ascii"),
        }

    # --- template + write -------------------------------------------------

    @staticmethod
    def _read_template() -> str:
        return TEMPLATE_PATH.read_text(encoding="utf-8")

    def _data_script(self, camps: list[Camp]) -> tuple[str, str, str, str]:
        """Return (data_script_tag, body_class, gate_hidden_class, mode_label)."""
        # Compact JSON — strip indent + whitespace — for payload embedding.
        payload_bytes = json.dumps(
            [c.to_dict() for c in camps],
            ensure_ascii=False, separators=(",", ":"),
        ).encode("utf-8")

        if self.config.site_password:
            enc = self.encrypt_payload(payload_bytes)
            tag = (
                '<script id="camps-data-encrypted" type="application/json">'
                + json.dumps(enc, separators=(",", ":"))
                + "</script>"
            )
            return tag, "gated", "", f"encrypted (PBKDF2 iter={self.config.pbkdf2_iter})"

        # Plain <script type="application/json">. Escape "</" so a stray
        # "</script>" in the data can't break the embed. JSON.parse handles
        # "\/" transparently.
        payload_text = payload_bytes.decode("utf-8").replace("</", "<\\/")
        tag = (
            '<script id="camps-data" type="application/json">'
            + payload_text
            + "</script>"
        )
        return tag, "", "gate-hidden", "plaintext"

    def build(self) -> Path:
        camps = self.load_camps()
        meta = self.load_meta()
        data_script, body_class, gate_hidden, mode = self._data_script(camps)

        html = (
            self._read_template()
            .replace("__DATA_SCRIPT__",   data_script)
            .replace("__BODY_CLASS__",    body_class)
            .replace("__GATE_HIDDEN__",   gate_hidden)
            .replace("__CONTACT_EMAIL__", self.config.contact_email)
            .replace("__VERSION__",       meta.get("version", "v0.0.0"))
            .replace("__SCRAPED_DATE__",  meta.get("scraped_date", "unknown"))
            .replace("__SCRAPED_AT__",    meta.get("scraped_at", "unknown"))
        )

        self.config.site_html.parent.mkdir(parents=True, exist_ok=True)
        self.config.site_html.write_text(html, encoding="utf-8")

        total_events = sum(len(c.events) for c in camps)
        with_web = sum(1 for c in camps if c.website)
        tagged = sum(1 for c in camps if c.tags)
        size_kb = self.config.site_html.stat().st_size / 1024
        print(f"wrote {self.config.site_html}")
        print(f"  mode: {mode}")
        print(f"  contact: {self.config.contact_email}")
        print(f"  version: {meta.get('version', '?')} ({meta.get('scraped_date', '?')})")
        print(f"  {len(camps)} camps · {with_web} with website · "
              f"{total_events} events · {tagged} tagged")
        print(f"  {size_kb:.1f} KB")
        return self.config.site_html
