"""Unit tests for playa.builder (SiteBuilder).

Covers denylist parsing, load_meta fallbacks, load_camps dedupe + denylist,
and the full openssl encrypt round-trip against the same parameters the
browser uses.
"""
import base64
import contextlib
import gzip
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from playa.builder import SiteBuilder
from playa.config import Config
from playa.models import Camp


HAS_OPENSSL = shutil.which("openssl") is not None


class _TmpConfigMixin:
    """Shared tmp-root fixture. Subclass via plain inheritance in setUp.

    Production `Config` has empty burn-date defaults (CI repo vars
    are the source of truth — no hardcoded years in code). Tests
    that exercise the build path need real dates, so this fixture
    seeds 2026 placeholders. Override via `_make_config(burn_start=…)`."""

    def _make_config(self, **overrides) -> Config:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        defaults = {
            "burn_start": "2026-08-30",
            "burn_end":   "2026-09-07",
        }
        defaults.update(overrides)
        base = Config(root=root, **defaults)
        (root / "data").mkdir()
        (root / "data" / "pages").mkdir()
        return base


@unittest.skipUnless(HAS_OPENSSL, "openssl not found on PATH")
class EncryptPayloadTests(unittest.TestCase, _TmpConfigMixin):
    """Verify the wire format the browser will decrypt."""

    def setUp(self):
        self.config = self._make_config(site_password="pw", pbkdf2_iter=1000)
        self.builder = SiteBuilder(self.config)

    def test_returns_expected_schema(self):
        enc = self.builder.encrypt_payload(b"x")
        # `compressed: True` is the D12 flag — clients pipe through
        # DecompressionStream after AES decode when it's set.
        self.assertEqual(set(enc.keys()), {"salt", "iter", "ct", "compressed"})
        self.assertEqual(enc["iter"], 1000)
        self.assertIs(enc["compressed"], True)
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
        # AES output is gzipped — decompress to recover the original.
        self.assertEqual(gzip.decompress(proc.stdout), data)

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

    def test_compression_actually_shrinks_realistic_payload(self):
        """Sanity-check pipeline order: gzip BEFORE AES, not after.
        Gzipping AES output (which is near-random) would produce a
        ciphertext slightly LARGER than the plaintext — this regression
        guard catches that mistake."""
        # Realistic-shape JSON with repeated keys + English prose.
        payload = json.dumps([
            {"id": str(i), "name": f"Camp {i}",
             "description": "free pancakes morning yoga gifting tea",
             "events": [{"id": f"e{i}", "name": "thing", "time": "Mon 9am"}]}
            for i in range(200)
        ]).encode("utf-8")
        enc = self.builder.encrypt_payload(payload)
        ct_size = len(base64.b64decode(enc["ct"]))
        # Allow up to 50% of plaintext post-compress + AES padding overhead.
        # Real numbers are well under that (~25-30%) but the CI runner's
        # gzip might produce slightly different output than local —
        # don't make this brittle.
        self.assertLess(
            ct_size, len(payload) * 0.5,
            f"expected encrypted+compressed output to be <50% of plaintext "
            f"({len(payload)} bytes); got {ct_size}",
        )


@unittest.skipUnless(HAS_OPENSSL, "openssl not found on PATH")
class EnvelopeEncryptionTests(unittest.TestCase, _TmpConfigMixin):
    """Round-trip envelope mode (D10): per-source DEK encrypts the
    cipher; per-(source, tier) wrapper PBKDF2-encrypts the DEK+IV
    against each tier's password."""

    def setUp(self):
        self.config = self._make_config(pbkdf2_iter=1000)
        self.builder = SiteBuilder(self.config)

    def test_aes_cbc_encrypt_round_trip(self):
        """Raw key+iv path used to encrypt source data with the random DEK."""
        key = b"\x01" * 32
        iv = b"\x02" * 16
        plaintext = b"hello, envelope world. " * 100
        ct = self.builder._aes_cbc_encrypt(plaintext, key, iv)
        # openssl -d with the same key + iv decrypts back.
        proc = subprocess.run(
            ["openssl", "enc", "-d", "-aes-256-cbc",
             "-K", key.hex(), "-iv", iv.hex()],
            input=ct, capture_output=True, check=True,
        )
        self.assertEqual(proc.stdout, plaintext)

    def test_wrap_with_password_round_trip(self):
        """PBKDF2 wrapper used to encrypt the 48-byte DEK+IV per tier."""
        secret = b"R" * 48
        wrapper = self.builder._wrap_with_password(secret, "tier-pw")
        # Reconstruct the openssl-format blob and decrypt with -d.
        salt = base64.b64decode(wrapper["salt"])
        ct = base64.b64decode(wrapper["ct"])
        blob = b"Salted__" + salt + ct
        proc = subprocess.run(
            ["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2",
             "-iter", "1000", "-pass", "pass:tier-pw"],
            input=blob, capture_output=True, check=True,
        )
        self.assertEqual(proc.stdout, secret)

    def test_envelope_emits_one_cipher_per_source(self):
        """One source → one cipher script + one wrapper per tier."""
        camps = [Camp(id="1", name="A", location="6:00 & E",
                      description="", website="", url="", events=[])]
        loaded = [("directory", camps)]
        tiers = [
            ("god-mode", "god-pw", ["directory"]),
            ("demigod-mode", "demi-pw", ["directory"]),
        ]
        scripts, manifest_meta, modes, source_keys = self.builder._envelope_data_scripts(
            loaded, tiers,
        )
        # source_keys returned for D13's BURN_OPEN path. 32-byte DEK
        # + 16-byte IV per source.
        self.assertIn("directory", source_keys)
        self.assertEqual(len(source_keys["directory"][0]), 32)  # DEK
        self.assertEqual(len(source_keys["directory"][1]), 16)  # IV
        # Cipher: exactly one for the source.
        self.assertEqual(scripts.count('id="camps-data-directory-cipher"'), 1)
        # Two wrappers (one per tier).
        self.assertIn('id="cdk-directory-0"', scripts)
        self.assertIn('id="cdk-directory-1"', scripts)
        # Manifest lists both indices.
        self.assertIn('content="directory:0,1"', manifest_meta)
        # Mode log mentions wrapper count.
        self.assertEqual(len(modes), 1)
        self.assertIn("envelope", modes[0])
        self.assertIn("2 wrappers", modes[0])

    def test_envelope_two_sources_three_tiers(self):
        """Mirrors the real god/demigod/spirit shape: directory in
        god-only, api in all three. Wrapper counts must match."""
        camps = [Camp(id="1", name="A", location="6:00 & E",
                      description="", website="", url="", events=[])]
        loaded = [("directory", camps), ("api-2026", camps)]
        tiers = [
            ("god-mode", "god-pw", ["directory", "api-2026"]),
            ("demigod-mode", "demi-pw", ["api-2026"]),
            ("spirit-mode", "spirit-pw", ["api-2026"]),
        ]
        scripts, manifest_meta, _, _ = self.builder._envelope_data_scripts(
            loaded, tiers,
        )
        # directory: 1 wrapper. api-2026: 3 wrappers.
        self.assertIn('id="camps-data-directory-cipher"', scripts)
        self.assertIn('id="camps-data-api-2026-cipher"', scripts)
        self.assertIn('id="cdk-directory-0"', scripts)
        self.assertNotIn('id="cdk-directory-1"', scripts)
        self.assertIn('id="cdk-api-2026-0"', scripts)
        self.assertIn('id="cdk-api-2026-1"', scripts)
        self.assertIn('id="cdk-api-2026-2"', scripts)
        # Manifest reflects per-source wrapper indices.
        self.assertIn("directory:0", manifest_meta)
        self.assertIn("api-2026:0,1,2", manifest_meta)

    def test_envelope_rejects_unknown_source_in_tier(self):
        """Operator typo guard: tier listing a source not in --sources
        fails the build loudly rather than silently dropping it."""
        loaded = [("directory", [])]
        tiers = [("god-mode", "pw", ["directory", "api-9999"])]
        with self.assertRaises(RuntimeError) as cm:
            self.builder._envelope_data_scripts(loaded, tiers)
        self.assertIn("api-9999", str(cm.exception))

    def test_trusted_manifest_lists_only_god_mode_wrappers(self):
        """`bm-trusted-wrappers` should expose ONLY the wrappers
        belonging to the `god-mode` tier — never demigod or spirit.
        Lets the client grant per-tier privileges (today: bypassing
        the pre-burn location embargo) without leaking tier names
        into the DOM."""
        camps = [Camp(id="1", name="A", location="6:00 & E",
                      description="", website="", url="", events=[])]
        loaded = [("directory", camps), ("api-2026", camps)]
        tiers = [
            ("god-mode", "god-pw", ["directory", "api-2026"]),
            ("demigod-mode", "demi-pw", ["api-2026"]),
            ("spirit-mode", "spirit-pw", ["api-2026"]),
        ]
        _, manifest_meta, _, _ = self.builder._envelope_data_scripts(
            loaded, tiers,
        )
        # Tier name must NOT appear anywhere in the meta tags — the
        # manifest's whole point is to grant tier privileges by
        # wrapper position, not by name.
        self.assertNotIn("god-mode", manifest_meta)
        self.assertNotIn("demigod-mode", manifest_meta)
        self.assertNotIn("spirit-mode", manifest_meta)
        # Trusted manifest exists and lists god-mode's slots:
        # directory: only god (idx 0)
        # api-2026: god is the FIRST tier so it owns idx 0; demigod=1, spirit=2.
        self.assertIn('name="bm-trusted-wrappers"', manifest_meta)
        # Inspect only the trusted-manifest tag — bm-tier-wrappers
        # legitimately lists the full set including 1,2.
        trusted_tag = manifest_meta.split('bm-trusted-wrappers"', 1)[1]
        self.assertIn("directory:0", trusted_tag)
        self.assertIn("api-2026:0", trusted_tag)
        # demigod (1) and spirit (2) MUST NOT appear in the trusted
        # api-2026 slot list.
        self.assertNotIn("api-2026:0,1", trusted_tag)
        self.assertNotIn("api-2026:0,2", trusted_tag)
        self.assertNotIn("api-2026:0,1,2", trusted_tag)

    def test_no_trusted_manifest_when_god_mode_absent(self):
        """If the operator doesn't define a `god-mode` tier, the
        trusted meta tag is omitted entirely — every tier remains
        ToS-bound to honor §6.2."""
        camps = [Camp(id="1", name="A", location="6:00 & E",
                      description="", website="", url="", events=[])]
        loaded = [("api-2026", camps)]
        tiers = [
            ("demigod-mode", "demi-pw", ["api-2026"]),
            ("spirit-mode", "spirit-pw", ["api-2026"]),
        ]
        _, manifest_meta, _, _ = self.builder._envelope_data_scripts(
            loaded, tiers,
        )
        self.assertIn('name="bm-tier-wrappers"', manifest_meta)
        self.assertNotIn("bm-trusted-wrappers", manifest_meta)

    def test_trusted_manifest_position_independent(self):
        """Trust is by tier NAME, not order — moving god-mode to the
        last slot still flags only that wrapper as trusted."""
        camps = [Camp(id="1", name="A", location="6:00 & E",
                      description="", website="", url="", events=[])]
        loaded = [("api-2026", camps)]
        tiers = [
            ("demigod-mode", "demi-pw", ["api-2026"]),
            ("spirit-mode", "spirit-pw", ["api-2026"]),
            ("god-mode", "god-pw", ["api-2026"]),
        ]
        _, manifest_meta, _, _ = self.builder._envelope_data_scripts(
            loaded, tiers,
        )
        # god-mode is now wrapper idx 2 (third tier).
        self.assertIn('name="bm-trusted-wrappers"', manifest_meta)
        self.assertIn("api-2026:2", manifest_meta)
        # No spurious other indices.
        self.assertNotIn("api-2026:0", manifest_meta.split('bm-trusted-wrappers"')[1])
        self.assertNotIn("api-2026:1", manifest_meta.split('bm-trusted-wrappers"')[1])


@unittest.skipUnless(HAS_OPENSSL, "openssl not found on PATH")
class BurnOpenTests(unittest.TestCase, _TmpConfigMixin):
    """ADR D13: BURN_OPEN=1 deploys site/burn-key.json so the
    `spirit-mode` tier auto-unlocks. The spirit tier is identified
    by NAME (not position) — operator labels each entry in
    SITE_TIERS so the build can validate setup."""

    def _camp(self) -> Camp:
        return Camp(
            id="1", name="X", location="6:00 & A",
            description="", website="", url="", events=[],
        )

    def _make_builder(self, **cfg) -> SiteBuilder:
        config = self._make_config(pbkdf2_iter=1000, **cfg)
        # Pre-create page so MIN_CAMPS rail can be bypassed in `build()`.
        (config.pages_dir / "page_01.json").write_text(
            json.dumps([self._camp().to_dict()]),
        )
        config.site_dir.mkdir(parents=True, exist_ok=True)
        return SiteBuilder(config, sources=["directory"])

    def _drop_bundle(self, builder: SiteBuilder) -> None:
        bundle_dir = builder.config.root / "client" / "dist"
        bundle_dir.mkdir(parents=True, exist_ok=True)
        bundle_dir.joinpath("bundle.js").write_text(
            '"use strict";(()=>{})();',
        )

    def test_burn_open_writes_burn_key_json(self):
        builder = self._make_builder(
            site_tiers="god-mode:god-pw=directory,spirit-mode:spirit-pw=directory",
        )
        self._drop_bundle(builder)
        with contextlib.redirect_stdout(io.StringIO()), \
                mock.patch.dict(os.environ, {"MIN_CAMPS": "0", "BURN_OPEN": "1"}):
            builder.build()
        burn_path = builder.config.site_dir / "burn-key.json"
        self.assertTrue(burn_path.exists(), "burn-key.json should be written")
        data = json.loads(burn_path.read_text())
        # Spirit identified by name (`spirit-mode`). Its sources land
        # in burn-key.json; god-mode's don't.
        self.assertEqual(set(data.keys()), {"directory"})
        # Value is base64 of (32 DEK + 16 IV) = 48 bytes → 64 b64 chars.
        self.assertEqual(len(base64.b64decode(data["directory"])), 48)

    def test_burn_open_unset_removes_stale_burn_key(self):
        """Previous BURN_OPEN=1 build left site/burn-key.json behind;
        the next BURN_OPEN-unset build must clean it up so the deploy
        is closed."""
        builder = self._make_builder(
            site_tiers="god-mode:god-pw=directory,spirit-mode:spirit-pw=directory",
        )
        self._drop_bundle(builder)
        # Pre-seed a stale burn-key.json.
        stale = builder.config.site_dir / "burn-key.json"
        stale.write_text('{"directory": "stale"}')
        with contextlib.redirect_stdout(io.StringIO()), \
                mock.patch.dict(os.environ, {"MIN_CAMPS": "0"}, clear=False):
            os.environ.pop("BURN_OPEN", None)
            builder.build()
        self.assertFalse(stale.exists(), "stale burn-key.json should be cleaned up")

    def test_burn_open_without_tiers_fails_loud(self):
        """ADR D13 sanity check: BURN_OPEN with no SITE_TIERS = no
        spirit tier exists. Build refuses rather than silently writing
        nothing."""
        builder = self._make_builder()  # no SITE_TIERS
        self._drop_bundle(builder)
        with contextlib.redirect_stdout(io.StringIO()), \
                mock.patch.dict(os.environ, {"MIN_CAMPS": "0", "BURN_OPEN": "1"}):
            with self.assertRaises(RuntimeError) as cm:
                builder.build()
        self.assertIn("BURN_OPEN", str(cm.exception))
        self.assertIn("SITE_TIERS", str(cm.exception))

    def test_burn_open_only_exposes_spirit_tier_sources(self):
        """Three tiers (god/demigod/spirit). spirit-mode is identified
        by NAME — only its sources land in burn-key.json, not god's
        or demigod's. Order in SITE_TIERS doesn't matter for this."""
        # Use directory + api-2026 sources. Mock the api-2026 source
        # to load some camps so envelope generation can run.
        builder = self._make_builder(
            site_tiers=(
                "god-mode:god-pw=directory+api-2026,"
                "demigod-mode:demigod-pw=api-2026,"
                "spirit-mode:spirit-pw=api-2026"
            ),
        )
        self._drop_bundle(builder)
        # Drop a fake api cache so api-2026 source loads.
        api_payload = {
            "fetched_at": "2026-04-29T00:00:00Z",
            "year": 2026,
            "camps": [{
                "uid": "uX", "name": "Y", "year": 2026,
                "location_string": "6:00 & A",
            }],
            "events": [],
        }
        builder.config.api_dir.mkdir(parents=True, exist_ok=True)
        builder.config.api_payload_file(2026).write_text(json.dumps(api_payload))
        builder.source_specs = ["directory", "api-2026"]
        with contextlib.redirect_stdout(io.StringIO()), \
                mock.patch.dict(os.environ, {"MIN_CAMPS": "0", "BURN_OPEN": "1"}):
            builder.build()
        burn_path = builder.config.site_dir / "burn-key.json"
        data = json.loads(burn_path.read_text())
        # spirit-mode lists only api-2026 → only that source exposed.
        self.assertEqual(set(data.keys()), {"api-2026"})

    def test_burn_open_without_spirit_tier_fails_loud(self):
        """SITE_TIERS exists but no `spirit-mode` tier → BURN_OPEN=1
        has no target. Build must refuse with a clear message rather
        than silently picking the wrong tier."""
        builder = self._make_builder(
            site_tiers="god-mode:god-pw=directory,demigod-mode:demi-pw=directory",
        )
        self._drop_bundle(builder)
        with contextlib.redirect_stdout(io.StringIO()), \
                mock.patch.dict(os.environ, {"MIN_CAMPS": "0", "BURN_OPEN": "1"}):
            with self.assertRaises(RuntimeError) as cm:
                builder.build()
        self.assertIn("spirit-mode", str(cm.exception))


class ConfigParsedTiersTests(unittest.TestCase, _TmpConfigMixin):
    """SITE_TIERS env-var parsing — sanity checks at build time."""

    def test_empty_returns_empty_list(self):
        cfg = self._make_config(site_tiers="")
        self.assertEqual(cfg.parsed_tiers(), [])

    def test_parses_simple(self):
        cfg = self._make_config(
            site_tiers="god-mode:god-pw=directory+api-2025,spirit-mode:spirit-pw=api-2026",
        )
        self.assertEqual(cfg.parsed_tiers(), [
            ("god-mode", "god-pw", ["directory", "api-2025"]),
            ("spirit-mode", "spirit-pw", ["api-2026"]),
        ])

    def test_password_with_colon(self):
        """First `:` separates name from rest, so colons inside the
        password are preserved. (Equals signs inside the password
        would NOT survive — first `=` is the pw/sources separator.)"""
        cfg = self._make_config(
            site_tiers="god-mode:p:as:s=directory",
        )
        self.assertEqual(cfg.parsed_tiers(), [
            ("god-mode", "p:as:s", ["directory"]),
        ])

    def test_rejects_duplicate_name(self):
        cfg = self._make_config(
            site_tiers="god-mode:a=directory,god-mode:b=api-2026",
        )
        with self.assertRaises(ValueError) as cm:
            cfg.parsed_tiers()
        self.assertIn("duplicate tier name", str(cm.exception))

    def test_rejects_duplicate_password(self):
        cfg = self._make_config(
            site_tiers="god-mode:same=directory,spirit-mode:same=api-2026",
        )
        with self.assertRaises(ValueError) as cm:
            cfg.parsed_tiers()
        self.assertIn("duplicate password", str(cm.exception))

    def test_rejects_empty_source_list(self):
        cfg = self._make_config(site_tiers="god-mode:god-pw=")
        with self.assertRaises(ValueError):
            cfg.parsed_tiers()

    def test_rejects_missing_colon(self):
        """Old-format (no tier name) must fail with helpful message."""
        cfg = self._make_config(site_tiers="god-pw=directory")
        with self.assertRaises(ValueError) as cm:
            cfg.parsed_tiers()
        self.assertIn("name:password", str(cm.exception))

    def test_rejects_missing_equals(self):
        cfg = self._make_config(site_tiers="god-mode-without-eq")
        with self.assertRaises(ValueError) as cm:
            cfg.parsed_tiers()
        self.assertIn("name:password", str(cm.exception))


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
            "fetched_date": "2026-01-01",
            "version": "v2026.01.01",
            "fetched_at": "2026-01-01T00:00:00Z",
        }))
        meta = self.builder.load_meta()
        self.assertEqual(meta["version"], "v2026.01.01")

    def test_fallback_to_page_mtime(self):
        (self.config.pages_dir / "page_01.json").write_text("[]")
        meta = self.builder.load_meta()
        self.assertTrue(meta["version"].startswith("v"))
        self.assertRegex(meta["fetched_date"], r"^\d{4}-\d{2}-\d{2}$")

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
    """Smoke test: a minimal fetch → site/index.html plaintext build."""

    def test_produces_valid_html(self):
        """Smoke test for the Preact-era build. The template now ships a
        minimal HTML shell plus CSS; all user-facing DOM is rendered by
        the bundle at runtime. We assert on the structural invariants
        the Python side is responsible for."""
        self.config = self._make_config()
        self._page = lambda n, c: (self.config.pages_dir / f"page_{n:02d}.json").write_text(json.dumps(c))
        self._page(1, [{
            "id": "1", "name": "Demo Camp", "location": "4:00 & B",
            "description": "free pancakes and yoga",
            "website": "https://example.com", "events": [],
        }])
        # Drop a stub client bundle where _read_bundle() expects it.
        # (The real bundle is produced by esbuild; tests don't run it.)
        bundle_dir = self.config.root / "client" / "dist"
        bundle_dir.mkdir(parents=True)
        bundle_dir.joinpath("bundle.js").write_text(
            '"use strict";(()=>{/* stub — real bundle built by esbuild in CI/make */})();'
        )
        # site/ already exists (from _make_config) so the SW can land there.
        # Smoke test has 1 camp, well below the production min-camps rail.
        with contextlib.redirect_stdout(io.StringIO()), \
                mock.patch.dict(os.environ, {"MIN_CAMPS": "0"}):
            SiteBuilder(self.config).build()
        html = self.config.site_html.read_text()
        # The Preact mount point.
        self.assertIn('id="app"', html)
        # Plaintext data payload — camp name is inside the JSON blob.
        # Per-source script id (multi-source architecture).
        self.assertIn('id="camps-data-directory"', html)
        # Plaintext payload is now gzip+base64 (ADR D12) — the camp
        # name doesn't appear as substring anymore. Confirm the new
        # script type instead.
        self.assertIn('type="application/x-gzip-base64"', html)
        # Meta tags consumed by the client at startup.
        self.assertIn('name="bm-version"', html)
        self.assertIn('name="bm-fetched-date"', html)
        self.assertIn('name="bm-contact-email"', html)
        # Multi-source meta lists which sources are embedded; `directory`
        # is the only one in this smoke test.
        self.assertIn('name="bm-sources"', html)
        self.assertIn('content="directory"', html)
        # Stub bundle was embedded.
        self.assertIn('"use strict";(()=>{', html)
        # Noindex still enforced.
        self.assertIn('name="robots"', html)

    def test_build_fails_helpfully_when_bundle_missing(self):
        """If the client bundle hasn't been built yet, the error should
        tell the user how to fix it rather than producing broken HTML."""
        self.config = self._make_config()
        (self.config.pages_dir / "page_01.json").write_text("[]")
        with self.assertRaises(RuntimeError) as ctx, \
                mock.patch.dict(os.environ, {"MIN_CAMPS": "0"}):
            SiteBuilder(self.config).build()
        self.assertIn("client bundle missing", str(ctx.exception))
        self.assertIn("make bundle", str(ctx.exception))

    def test_build_refuses_degraded_fetch(self):
        """A near-empty fetch shouldn't overwrite a healthy live deploy.
        build() must raise with an actionable message so CI aborts before
        the `upload-pages-artifact` step runs."""
        self.config = self._make_config()
        (self.config.pages_dir / "page_01.json").write_text(json.dumps([{
            "id": "1", "name": "Only Camp", "location": "", "description": "",
            "website": "", "events": [],
        }]))
        # Stub bundle so we don't trip the other guard first.
        bundle_dir = self.config.root / "client" / "dist"
        bundle_dir.mkdir(parents=True)
        bundle_dir.joinpath("bundle.js").write_text('(()=>{})()')
        # MIN_CAMPS not overridden → defaults to 500 → 1 camp fails hard.
        with self.assertRaises(RuntimeError) as ctx, \
                contextlib.redirect_stdout(io.StringIO()):
            SiteBuilder(self.config).build()
        msg = str(ctx.exception)
        self.assertIn("refusing to build", msg)
        self.assertIn("MIN_CAMPS", msg)


if __name__ == "__main__":
    unittest.main()
