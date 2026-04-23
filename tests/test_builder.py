"""Unit tests for bm_camps.builder (SiteBuilder).

Covers denylist parsing, load_meta fallbacks, load_camps dedupe + denylist,
and the full openssl encrypt round-trip against the same parameters the
browser uses.
"""
import base64
import contextlib
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from bm_camps.builder import SiteBuilder
from bm_camps.config import Config
from bm_camps.models import Camp


HAS_OPENSSL = shutil.which("openssl") is not None


class _TmpConfigMixin:
    """Shared tmp-root fixture. Subclass via plain inheritance in setUp."""

    def _make_config(self, **overrides) -> Config:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        base = Config(root=root)
        (root / "data").mkdir()
        (root / "data" / "pages").mkdir()
        if overrides:
            base = replace(base, **overrides)
        return base


@unittest.skipUnless(HAS_OPENSSL, "openssl not found on PATH")
class EncryptPayloadTests(unittest.TestCase, _TmpConfigMixin):
    """Verify the wire format the browser will decrypt."""

    def setUp(self):
        self.config = self._make_config(site_password="pw", pbkdf2_iter=1000)
        self.builder = SiteBuilder(self.config)

    def test_returns_expected_schema(self):
        enc = self.builder.encrypt_payload(b"x")
        self.assertEqual(set(enc.keys()), {"salt", "iter", "ct"})
        self.assertEqual(enc["iter"], 1000)
        # OpenSSL default salt length is 8 bytes.
        self.assertEqual(len(base64.b64decode(enc["salt"])), 8)

    def test_roundtrip_via_openssl(self):
        data = b'{"hello":"world","camps":[1,2,3]}'
        enc = self.builder.encrypt_payload(data)
        salt = base64.b64decode(enc["salt"])
        ct = base64.b64decode(enc["ct"])
        blob = b"Salted__" + salt + ct
        proc = subprocess.run(
            ["openssl", "enc", "-aes-256-cbc", "-d", "-pbkdf2",
             "-iter", "1000", "-pass", "pass:pw"],
            input=blob, capture_output=True, check=True,
        )
        self.assertEqual(proc.stdout, data)

    def test_wrong_password_fails(self):
        enc = self.builder.encrypt_payload(b"data")
        salt = base64.b64decode(enc["salt"])
        ct = base64.b64decode(enc["ct"])
        blob = b"Salted__" + salt + ct
        with self.assertRaises(subprocess.CalledProcessError):
            subprocess.run(
                ["openssl", "enc", "-aes-256-cbc", "-d", "-pbkdf2",
                 "-iter", "1000", "-pass", "pass:wrong"],
                input=blob, capture_output=True, check=True,
            )

    def test_fresh_salt_each_call(self):
        a = self.builder.encrypt_payload(b"same data")
        b = self.builder.encrypt_payload(b"same data")
        self.assertNotEqual(a["salt"], b["salt"])
        self.assertNotEqual(a["ct"], b["ct"])


class LoadDenylistTests(unittest.TestCase, _TmpConfigMixin):
    def setUp(self):
        self.config = self._make_config()
        self.builder = SiteBuilder(self.config)

    def test_empty_set_when_file_missing(self):
        self.assertEqual(self.builder.load_denylist(), set())

    def test_reads_ids(self):
        self.config.denylist_file.write_text("779\n1291\n212\n")
        self.assertEqual(self.builder.load_denylist(), {"779", "1291", "212"})

    def test_strips_comments_and_blanks(self):
        self.config.denylist_file.write_text(
            "# header\n"
            "779\n"
            "\n"
            "# midline\n"
            "   212   # inline\n"
            "\n"
        )
        self.assertEqual(self.builder.load_denylist(), {"779", "212"})


class LoadMetaTests(unittest.TestCase, _TmpConfigMixin):
    def setUp(self):
        self.config = self._make_config()
        self.builder = SiteBuilder(self.config)

    def test_prefers_meta_file_when_present(self):
        self.config.meta_file.write_text(json.dumps({
            "scraped_date": "2026-01-01",
            "version": "v2026.01.01",
            "scraped_at": "2026-01-01T00:00:00Z",
        }))
        meta = self.builder.load_meta()
        self.assertEqual(meta["version"], "v2026.01.01")

    def test_fallback_to_page_mtime(self):
        (self.config.pages_dir / "page_01.json").write_text("[]")
        meta = self.builder.load_meta()
        self.assertTrue(meta["version"].startswith("v"))
        self.assertRegex(meta["scraped_date"], r"^\d{4}-\d{2}-\d{2}$")

    def test_empty_default_when_nothing(self):
        meta = self.builder.load_meta()
        self.assertEqual(meta["version"], "v0.0.0")

    def test_recovers_from_corrupt_meta(self):
        self.config.meta_file.write_text("not valid json{{{")
        (self.config.pages_dir / "page_01.json").write_text("[]")
        meta = self.builder.load_meta()
        self.assertTrue(meta["version"].startswith("v"))


class LoadCampsTests(unittest.TestCase, _TmpConfigMixin):
    def setUp(self):
        self.config = self._make_config()
        self.builder = SiteBuilder(self.config)

    def _page(self, n, camps):
        (self.config.pages_dir / f"page_{n:02d}.json").write_text(json.dumps(camps))

    def _load(self) -> list[Camp]:
        with contextlib.redirect_stdout(io.StringIO()):
            return self.builder.load_camps()

    def test_loads_camp_and_applies_tags(self):
        self._page(1, [{
            "id": "1", "name": "Yoga Tent", "location": "",
            "description": "daily yoga at sunrise", "website": "",
            "events": [],
        }])
        camps = self._load()
        self.assertEqual(len(camps), 1)
        self.assertIn("yoga", camps[0].tags)

    def test_canonical_url_generated_when_missing(self):
        self._page(1, [{
            "id": "779", "name": "X", "location": "", "description": "",
            "website": "", "events": [],
        }])
        camp = self._load()[0]
        self.assertEqual(camp.url, "https://directory.burningman.org/camps/779/")

    def test_canonical_url_preserved_if_present(self):
        self._page(1, [{
            "id": "1", "name": "X", "location": "", "description": "",
            "website": "", "url": "https://preset.example/", "events": [],
        }])
        self.assertEqual(self._load()[0].url, "https://preset.example/")

    def test_denylist_filters_out_camp(self):
        self._page(1, [
            {"id": "1", "name": "Keep", "location": "", "description": "",
             "website": "", "events": []},
            {"id": "2", "name": "Drop", "location": "", "description": "",
             "website": "", "events": []},
        ])
        self.config.denylist_file.write_text("2\n")
        camps = self._load()
        self.assertEqual([c.id for c in camps], ["1"])

    def test_dedupe_across_pages(self):
        shared = {"id": "42", "name": "Dupe", "location": "",
                  "description": "", "website": "", "events": []}
        self._page(1, [shared])
        self._page(2, [shared])
        self.assertEqual(len(self._load()), 1)

    def test_sorted_case_insensitive(self):
        self._page(1, [
            {"id": "1", "name": "zebra", "location": "", "description": "",
             "website": "", "events": []},
            {"id": "2", "name": "APPLE", "location": "", "description": "",
             "website": "", "events": []},
            {"id": "3", "name": "banana", "location": "", "description": "",
             "website": "", "events": []},
        ])
        self.assertEqual([c.name for c in self._load()],
                         ["APPLE", "banana", "zebra"])


class EndToEndBuildTests(unittest.TestCase, _TmpConfigMixin):
    """Smoke test: a minimal scrape → site/index.html plaintext build."""

    def test_produces_valid_html(self):
        self.config = self._make_config()
        self._page = lambda n, c: (self.config.pages_dir / f"page_{n:02d}.json").write_text(json.dumps(c))
        self._page(1, [{
            "id": "1", "name": "Demo Camp", "location": "4:00 & B",
            "description": "free pancakes and yoga",
            "website": "https://example.com", "events": [],
        }])
        with contextlib.redirect_stdout(io.StringIO()):
            SiteBuilder(self.config).build()
        html = self.config.site_html.read_text()
        self.assertIn("Demo Camp", html)
        self.assertIn('id="camps-data"', html)    # plaintext mode
        self.assertIn('class="info-btn"', html)   # disclaimer button present
        self.assertIn("Always verify on", html)   # disclaimer text


if __name__ == "__main__":
    unittest.main()
