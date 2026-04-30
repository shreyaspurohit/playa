"""Build the self-contained site/index.html.

Reads the HTML template from `playa/templates/site.html`, loads camps
from each configured Source (see playa.sources), applies tags + denylist,
optionally encrypts each source's payload via openssl + PBKDF2 +
AES-256-CBC, substitutes placeholders, and writes the result.

Placeholders in the template:
    __DATA_SCRIPT__     — concatenated <script> tags, one per source,
                          each id-suffixed with the source name
                          (e.g., camps-data-directory or
                          camps-data-api-2024-encrypted)
    __SOURCES_META__    — <meta name="bm-sources" content="…"> listing
                          embedded sources (default-first)
    __BODY_CLASS__      — "gated" when any source is encrypted
    __GATE_HIDDEN__     — "" when encrypted (shown), "gate-hidden" otherwise
    __CONTACT_EMAIL__   — footer + modal takedown mailto
    __VERSION__         — vYYYY.MM.DD
    __FETCHED_DATE__    — YYYY-MM-DD
    __FETCHED_AT__      — YYYY-MM-DDTHH:MM:SSZ (tooltip)
"""
from __future__ import annotations

import base64
import gzip
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import Config
from .models import Camp
from .sources import Source, make_source
from .tagger import Tagger
from .timeparser import (
    canonical_week_map,
    effective_burn_start,
    format_display,
    parse_event_time,
)


TEMPLATE_PATH = Path(__file__).parent / "templates" / "site.html"
# The client bundle lives at <repo_root>/client/dist/bundle.js. We derive
# it from `config.root` at call time (see _read_bundle) rather than via
# __file__ so it's test-injectable (tests pass a tmp_path root).
PACIFIC = ZoneInfo("America/Los_Angeles")

# Safety rail: refuse to build a site with fewer camps than this. In
# 2025 the directory had ~1458. A build with 10 camps is a bug (fetch
# failure, directory reshuffle, ToS revocation) — fail loudly so CI
# aborts and the last-good deployment stays live. Override with the
# env var MIN_CAMPS for intentionally-small fixtures or debug fetches.
DEFAULT_MIN_CAMPS = 500


class SiteBuilder:
    def __init__(
        self,
        config: Config,
        tagger: Tagger | None = None,
        sources: list[str] | None = None,
    ):
        self.config = config
        self.tagger = tagger or Tagger()
        # Populated by _enrich_event_times. The calendar window is derived
        # from fetched events (earliest event date) + configured burn_end,
        # so it can't be known until events are loaded.
        self._effective_start: str = config.burn_start
        self._week_map: dict[str, str] = {}
        # Sources to embed. First entry is the default selection on
        # cold-start (matches the existing behavior — directory only).
        self.source_specs: list[str] = sources or ["directory"]

    # --- data loading -----------------------------------------------------

    def load_denylist(self) -> set[str]:
        """Read data/denylist.txt; comments (# …) and blanks ignored.

        Kept for backward-compat — the directory source uses its own
        copy of this loader; the API source has its own denylist
        (data/denylist-api.txt). New code should call the source's
        loader directly.
        """
        if not self.config.denylist_file.exists():
            return set()
        ids: set[str] = set()
        for line in self.config.denylist_file.read_text().splitlines():
            line = line.split("#", 1)[0].strip()
            if line:
                ids.add(line)
        return ids

    def load_meta(self) -> dict:
        """Fetch metadata — falls back to page-file mtime when meta.json
        is missing, and to a sensible default when nothing is there yet."""
        if self.config.meta_file.exists():
            try:
                return json.loads(self.config.meta_file.read_text())
            except Exception:
                pass
        pages = sorted(self.config.pages_dir.glob("page_*.json"))
        if not pages:
            return {"fetched_date": "unknown", "version": "v0.0.0"}
        newest = max(p.stat().st_mtime for p in pages)
        dt_utc = datetime.fromtimestamp(newest, tz=timezone.utc)
        dt_pt = dt_utc.astimezone(PACIFIC)
        return {
            "fetched_at":   dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "fetched_date": dt_pt.strftime("%Y-%m-%d"),   # Pacific for display
            "version":      "v" + dt_pt.strftime("%Y.%m.%d.%H%M"),
        }

    def load_camps(self) -> list[Camp]:
        """Backward-compat: directory source only. New code should call
        `load_camps_for_source(spec)` per source.
        """
        return self.load_camps_for_source("directory")

    def load_camps_for_source(self, spec: str) -> list[Camp]:
        """Load + tag + enrich one source's camps.

        Each source is responsible for dedupe + denylist (those rules
        differ between directory's numeric ids and the API's SFDC
        uids). The builder then runs Tagger + event-time enrichment
        uniformly across whatever the source returned.
        """
        source: Source = make_source(spec)
        camps = source.load_camps(self.config)
        for camp in camps:
            camp.tags = self.tagger.tag_camp(camp)
        camps.sort(key=lambda c: c.name.lower())
        self._enrich_event_times(camps)
        return camps

    def _enrich_event_times(self, camps: list[Camp]) -> None:
        """Populate event.display_time + parsed_time in place. Derives
        the calendar window from the fetched events themselves:

          * effective start = earliest single-occurrence event date,
            interpreted in `config.burn_start`'s year (volunteers +
            early crews often run events before gates officially open)
          * end             = `config.burn_end` (the fixed gate-close
            date from the ticketing page)

        Caches both the effective-start ISO string and the resulting
        canonical week map on `self` so `build()` can emit them as
        meta tags without re-parsing events.
        """
        # Pass 1: parse every event's raw time.
        parses: list[tuple] = []
        for camp in camps:
            for ev in camp.events:
                parses.append((ev, parse_event_time(ev.time)))
        parsed_only = [p for _, p in parses if p]

        # Derive the calendar window + canonical day→date map once.
        self._effective_start = effective_burn_start(
            parsed_only, self.config.burn_start, self.config.burn_end,
        )
        week_map = canonical_week_map(self._effective_start, self.config.burn_end)
        self._week_map = week_map

        # Pass 2: stamp canonical dates + format display strings.
        recognized = 0
        for ev, p in parses:
            if p:
                # Override fetched start_date + fill end_date from canonical map.
                end_day = p["end_day"] or p["start_day"]
                p["end_day"] = end_day
                p["start_date"] = (
                    week_map.get(p["start_day"] or "")
                    or p.get("start_date")
                )
            s = format_display(p, week_map)
            if s:
                ev.display_time = s
                recognized += 1
            if p:
                ev.parsed_time = {
                    **p,
                    "end_date": week_map.get(p["end_day"] or ""),
                }
        if parses:
            print(f"  event times parsed: {recognized}/{len(parses)} "
                  f"({100 * recognized // len(parses)}%); "
                  f"effective window: {self._effective_start} → "
                  f"{self.config.burn_end}; "
                  f"week map: {dict(sorted(week_map.items()))}")

    # --- encryption -------------------------------------------------------

    def encrypt_payload(self, plaintext: bytes) -> dict:
        """gzip → AES-256-CBC + PBKDF2-HMAC-SHA256 via openssl CLI.

        The plaintext is gzipped BEFORE encryption (ADR D12) — encrypted
        bytes are near-random and don't compress, so the order matters.
        Camp/event JSON typically shrinks ~70% under gzip, dropping the
        deployed page from ~2.7 MB to ~1 MB.

        Returns `{salt, iter, ct, compressed: True}` as base64 strings.
        The `compressed` flag tells the client to pipe the AES output
        through `DecompressionStream('gzip')` before JSON.parse.
        Older builds (missing the flag) decrypt to plaintext directly —
        kept for one-build backward compat with cached SW shells.
        """
        # gzip first. Default compression level (6) — slightly smaller
        # than 1 (fastest) and ~5x faster than 9 for negligible size
        # difference at this scale. Build cost matters less than page
        # size for a one-shot nightly build.
        compressed = gzip.compress(plaintext, compresslevel=6)
        proc = subprocess.run(
            [
                "openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2",
                "-iter", str(self.config.pbkdf2_iter),
                "-pass", f"pass:{self.config.site_password}",
            ],
            input=compressed, capture_output=True, check=True,
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
            "compressed": True,
        }

    # --- D10 envelope encryption ------------------------------------------

    def _aes_cbc_encrypt(
        self, plaintext: bytes, key: bytes, iv: bytes,
    ) -> bytes:
        """Raw AES-256-CBC encrypt (no PBKDF2; key + iv supplied
        directly). Used to encrypt source data with the random DEK in
        the envelope scheme — the DEK is already full-entropy random,
        so deriving from it via PBKDF2 would be ceremony.

        openssl emits PKCS7 padding by default. Web Crypto's AES-CBC
        decrypt strips it back transparently. Output is the raw
        ciphertext (no `Salted__` prefix — that's only emitted with
        `-salt`/`-pbkdf2` modes).
        """
        proc = subprocess.run(
            [
                "openssl", "enc", "-aes-256-cbc",
                "-K", key.hex(),
                "-iv", iv.hex(),
            ],
            input=plaintext, capture_output=True, check=True,
        )
        return proc.stdout

    def _wrap_with_password(self, plaintext: bytes, password: str) -> dict:
        """PBKDF2-derived AES-CBC encrypt, returning the standard
        `{salt, iter, ct}` envelope used elsewhere. Reused for every
        DEK wrapper in tiered builds — same primitive Gate.tsx and
        crypto.ts already round-trip-test against. Note: `compressed`
        flag is NOT set here (the wrapped payload is 48 raw bytes,
        not gzip-able).
        """
        proc = subprocess.run(
            [
                "openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2",
                "-iter", str(self.config.pbkdf2_iter),
                "-pass", f"pass:{password}",
            ],
            input=plaintext, capture_output=True, check=True,
        )
        blob = proc.stdout
        if blob[:8] != b"Salted__":
            raise RuntimeError(f"unexpected openssl output: {blob[:16]!r}")
        return {
            "salt": base64.b64encode(blob[8:16]).decode("ascii"),
            "iter": self.config.pbkdf2_iter,
            "ct":   base64.b64encode(blob[16:]).decode("ascii"),
        }

    def _envelope_data_scripts(
        self,
        loaded: list[tuple[str, list[Camp]]],
        tiers: list[tuple[str, list[str]]],
    ) -> tuple[str, str, list[str]]:
        """Build all the per-source ciphers + per-(source, tier) DEK
        wrappers + the manifest meta tag for envelope-mode deploys
        (ADR D10).

        Returns `(scripts_block, wrappers_meta_tag, modes)` where:
          * `scripts_block` concatenates every embed (cipher + wrappers)
          * `wrappers_meta_tag` is a single `<meta>` line listing
            wrapper indices per source
          * `modes` is a one-line summary for the build log

        Raises if a tier lists a source not in `loaded` (typo guard).
        """
        loaded_specs = {spec for spec, _ in loaded}
        for pw, srcs in tiers:
            for s in srcs:
                if s not in loaded_specs:
                    raise RuntimeError(
                        f"SITE_TIERS lists source {s!r} but it isn't in "
                        f"the loaded set {sorted(loaded_specs)}. Either "
                        "extend --sources or fix the tier definition.",
                    )

        parts: list[str] = []
        wrappers_by_source: dict[str, list[int]] = {spec: [] for spec, _ in loaded}
        # Track DEK+IV per source so wrappers can re-encrypt the same
        # 48-byte blob multiple times (one per tier that includes the
        # source).
        source_keys: dict[str, tuple[bytes, bytes]] = {}

        # 1) Encrypt each source's gzipped JSON with a fresh random DEK.
        for spec, camps in loaded:
            payload = json.dumps(
                [c.to_dict() for c in camps],
                ensure_ascii=False, separators=(",", ":"),
            ).encode("utf-8")
            compressed = gzip.compress(payload, compresslevel=6)
            dek = os.urandom(32)
            iv = os.urandom(16)
            ct = self._aes_cbc_encrypt(compressed, dek, iv)
            cipher = {
                "iv": base64.b64encode(iv).decode("ascii"),
                "ct": base64.b64encode(ct).decode("ascii"),
                "compressed": True,
            }
            parts.append(
                f'<script id="camps-data-{spec}-cipher" '
                f'type="application/json">'
                + json.dumps(cipher, separators=(",", ":"))
                + '</script>'
            )
            source_keys[spec] = (dek, iv)

        # 2) For each (tier, source-in-tier) pair, wrap the source's
        #    DEK+IV with the tier's password.
        for pw, tier_srcs in tiers:
            for spec in tier_srcs:
                dek, iv = source_keys[spec]
                wrapper = self._wrap_with_password(dek + iv, pw)
                wrapper_idx = len(wrappers_by_source[spec])
                parts.append(
                    f'<script id="cdk-{spec}-{wrapper_idx}" '
                    f'type="application/json">'
                    + json.dumps(wrapper, separators=(",", ":"))
                    + '</script>'
                )
                wrappers_by_source[spec].append(wrapper_idx)

        # 3) Manifest. Sources with zero wrappers are omitted — they
        #    can't be unlocked by any tier.
        manifest_segs = []
        for spec, _ in loaded:
            idxs = wrappers_by_source[spec]
            if idxs:
                manifest_segs.append(f"{spec}:{','.join(str(i) for i in idxs)}")
        wrappers_meta = (
            f'<meta name="bm-tier-wrappers" '
            f'content="{";".join(manifest_segs)}">'
        )

        modes = [
            f"envelope ({len(tiers)} tiers, "
            f"{len(loaded)} sources, "
            f"{sum(len(v) for v in wrappers_by_source.values())} wrappers)"
        ]
        return "\n".join(parts), wrappers_meta, modes

    # --- template + write -------------------------------------------------

    @staticmethod
    def _read_template() -> str:
        return TEMPLATE_PATH.read_text(encoding="utf-8")

    def _data_script(
        self, camps: list[Camp], source: str,
    ) -> tuple[str, str]:
        """Return (data_script_tag, mode_label) for one source.

        Script id format:
          plaintext  → camps-data-<source>          (gzip + base64)
          encrypted  → camps-data-<source>-encrypted (gzip + AES-CBC,
                                                      JSON envelope)

        The client's `readEmbeddedPayload(source)` reads whichever
        suffix is present.

        Compression: ADR D12. Both modes gzip the payload before
        embedding so the dev-preview disk size matches what users see
        in production. Plaintext rides in `<script type="text/plain">`
        as base64-encoded gzip bytes (the server can't compress
        AES-on-the-wire either, so plaintext was the asymmetry).
        Base64 doesn't contain `<` so the `</script>` escaping the
        old raw-JSON path needed isn't necessary here.
        """
        # Compact JSON — strip indent + whitespace — for payload embedding.
        payload_bytes = json.dumps(
            [c.to_dict() for c in camps],
            ensure_ascii=False, separators=(",", ":"),
        ).encode("utf-8")

        if self.config.site_password:
            enc = self.encrypt_payload(payload_bytes)
            tag = (
                f'<script id="camps-data-{source}-encrypted" '
                f'type="application/json">'
                + json.dumps(enc, separators=(",", ":"))
                + "</script>"
            )
            return tag, f"encrypted (PBKDF2 iter={self.config.pbkdf2_iter})"

        # gzip + base64 inline. The client decodes via
        # `DecompressionStream('gzip')` — same code path the encrypted
        # branch already uses post-AES.
        compressed = gzip.compress(payload_bytes, compresslevel=6)
        payload_b64 = base64.b64encode(compressed).decode("ascii")
        tag = (
            f'<script id="camps-data-{source}" '
            f'type="application/x-gzip-base64">'
            + payload_b64
            + "</script>"
        )
        return tag, "plaintext+gzip"

    def _read_bundle(self) -> str:
        """Load the Preact client bundle. Must exist; CI and Makefile
        produce it via `npm run build` in client/."""
        bundle_path = self.config.root / "client" / "dist" / "bundle.js"
        if not bundle_path.exists():
            raise RuntimeError(
                f"client bundle missing at {bundle_path}. "
                "Build it with `make bundle` (or `cd client && "
                "npm ci && npm run build`)."
            )
        return bundle_path.read_text(encoding="utf-8")

    def _write_service_worker(self, version: str) -> Path:
        """Emit site/sw.js so the site works fully offline after first
        load. Strategy: install-time precache of /, /index.html, and
        /robots.txt (nothing else is same-origin and needed for the UI).
        Fetch handler is cache-first with a network-fallback — if the
        runner deploys a newer build, the SW swap picks it up on the
        next visit once it activates (skipWaiting). Version is the
        build version ("vYYYY.MM.DD"); embedded in cache names so old
        caches get pruned on activate.
        """
        sw = (
            "// Auto-generated by playa.builder — do not edit by hand.\n"
            "// Version: " + version + "\n"
            "const VERSION = " + json.dumps(version) + ";\n"
            "const CACHE = 'playa-' + VERSION;\n"
            "const SHELL = ['./', './index.html', './robots.txt', "
            "'./manifest.webmanifest', './icon.svg'];\n"
            "self.addEventListener('install', (e) => {\n"
            "  self.skipWaiting();\n"
            "  // Per-URL fetch with cache: 'reload' bypasses the HTTP\n"
            "  // cache. The simpler addAll() respects HTTP caching, so a\n"
            "  // GH Pages max-age window can leave the brand-new SW\n"
            "  // cache populated with stale bytes — which then defeats\n"
            "  // forceRefresh until the next install. Per-URL failures\n"
            "  // are swallowed so a partial precache still ships.\n"
            "  e.waitUntil((async () => {\n"
            "    const cache = await caches.open(CACHE);\n"
            "    await Promise.all(SHELL.map(async (url) => {\n"
            "      try {\n"
            "        const r = await fetch(url, { cache: 'reload' });\n"
            "        if (r.ok) await cache.put(url, r.clone());\n"
            "      } catch (_err) { /* skip — try again on next install */ }\n"
            "    }));\n"
            "  })());\n"
            "});\n"
            "self.addEventListener('activate', (e) => {\n"
            "  e.waitUntil((async () => {\n"
            "    const keys = await caches.keys();\n"
            "    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));\n"
            "    await self.clients.claim();\n"
            "  })());\n"
            "});\n"
            "// Message handler — lets the page ask the SW to refresh its\n"
            "// shell cache from origin before a reload. Non-destructive:\n"
            "// if any fetch fails, the old cached entry stays in place,\n"
            "// so the next load still has a working copy of the site.\n"
            "self.addEventListener('message', (e) => {\n"
            "  if (e.data !== 'REFRESH_SHELL') return;\n"
            "  e.waitUntil((async () => {\n"
            "    const cache = await caches.open(CACHE);\n"
            "    await Promise.all(SHELL.map(async (url) => {\n"
            "      try {\n"
            "        const r = await fetch(url, { cache: 'reload' });\n"
            "        if (r.ok) await cache.put(url, r.clone());\n"
            "      } catch (_err) { /* keep existing entry */ }\n"
            "    }));\n"
            "    try { e.source && e.source.postMessage('SHELL_REFRESHED'); } catch (_) {}\n"
            "  })());\n"
            "});\n"
            "self.addEventListener('fetch', (e) => {\n"
            "  const req = e.request;\n"
            "  if (req.method !== 'GET') return;\n"
            "  const url = new URL(req.url);\n"
            "  if (url.origin !== self.location.origin) return;\n"
            "  // version.txt is the polling endpoint the client uses to\n"
            "  // detect a new deploy. Bypass the SW so polls always go\n"
            "  // to origin instead of serving the just-cached copy.\n"
            "  if (url.pathname.endsWith('/version.txt')) return;\n"
            "  // Cache-first for the precache shell + anything same-origin;\n"
            "  // falls back to network and caches the response on the way by.\n"
            "  e.respondWith((async () => {\n"
            "    const cached = await caches.match(req);\n"
            "    if (cached) {\n"
            "      // Refresh-in-background so next load gets latest without blocking.\n"
            "      fetch(req).then(r => r.ok && caches.open(CACHE).then(c => c.put(req, r.clone())))\n"
            "        .catch(() => {});\n"
            "      return cached;\n"
            "    }\n"
            "    try {\n"
            "      const net = await fetch(req);\n"
            "      if (net.ok) {\n"
            "        const copy = net.clone();\n"
            "        caches.open(CACHE).then(c => c.put(req, copy));\n"
            "      }\n"
            "      return net;\n"
            "    } catch (err) {\n"
            "      // Last resort — return the cached shell for navigation requests.\n"
            "      if (req.mode === 'navigate') {\n"
            "        const shell = await caches.match('./index.html');\n"
            "        if (shell) return shell;\n"
            "      }\n"
            "      throw err;\n"
            "    }\n"
            "  })());\n"
            "});\n"
        )
        out = self.config.site_dir / "sw.js"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(sw, encoding="utf-8")
        return out

    def _collect_release_notes(self, limit: int = 30) -> list[dict]:
        """Walk the most recent commits and return any whose subject line
        starts with `rn:` as structured release notes.

        Format: list of {ts, sha, message}, sorted oldest-first so the
        client can lex-compare timestamps to a watermark in localStorage
        and surface only notes newer than what the user has dismissed.

        Cap at `limit` entries — the embed lives in every page load and
        the most recent ~30 notes is plenty for any realistic gap
        between a user's last visit and "now". Older notes age out.
        """
        repo_root = self.config.root
        try:
            result = subprocess.run(
                [
                    "git", "log", f"-{limit * 4}",  # over-fetch then filter
                    "--pretty=format:%H%x1f%aI%x1f%s",
                ],
                cwd=repo_root,
                capture_output=True,
                text=True,
                check=False,
                timeout=10,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            # No git available (e.g., a tarball deploy) — quietly skip.
            return []
        if result.returncode != 0:
            return []

        notes: list[dict] = []
        for line in result.stdout.splitlines():
            parts = line.split("\x1f")
            if len(parts) != 3:
                continue
            sha, ts, subject = parts
            # Strict prefix match — `rnnnn` or "around: ..." don't qualify.
            if not subject.startswith("rn:"):
                continue
            message = subject[len("rn:"):].strip()
            if not message:
                continue
            notes.append({"ts": ts, "sha": sha[:7], "message": message})
            if len(notes) >= limit:
                break
        # git log is newest-first; reverse for oldest-first so the
        # client's "show notes after watermark" filter walks naturally.
        notes.reverse()
        return notes

    def build(self) -> Path:
        # Load each configured source. The MIN_CAMPS rail applies to
        # the FIRST (default) source — that's the "is the primary
        # data path broken?" signal CI uses to refuse a degraded
        # deploy. Secondary sources can be sparse without aborting.
        loaded: list[tuple[str, list[Camp]]] = []
        for spec in self.source_specs:
            try:
                camps = self.load_camps_for_source(spec)
            except FileNotFoundError as e:
                # API source asked for, no payload cached. Skip with a
                # warning rather than aborting — the user runs
                # `playa api-fetch --year YYYY` to populate it.
                print(f"  source {spec!r}: {e}; skipping")
                continue
            print(f"  source {spec!r}: {len(camps)} camps loaded")
            loaded.append((spec, camps))

        if not loaded:
            raise RuntimeError(
                "no sources loaded successfully — refusing to build."
            )

        primary_spec, primary_camps = loaded[0]
        # Sanity check on the primary source: a near-empty fetch
        # indicates something upstream broke. Refusing to build
        # preserves the last-good deployment.
        min_camps = int(os.environ.get("MIN_CAMPS", DEFAULT_MIN_CAMPS))
        if len(primary_camps) < min_camps:
            raise RuntimeError(
                f"refusing to build — primary source {primary_spec!r} "
                f"has only {len(primary_camps)} camp(s), minimum is "
                f"{min_camps}. This usually means the fetch or the "
                f"upstream source is broken. Set MIN_CAMPS=0 to "
                f"bypass, but do NOT set it in CI unless you want a "
                f"degraded build to overwrite the live site."
            )
        meta = self.load_meta()

        # Three build modes:
        #   1. SITE_TIERS set     → envelope encryption (D10)
        #   2. SITE_PASSWORD set  → per-source single-tier encryption
        #   3. neither            → per-source plaintext (gzip + base64)
        try:
            tiers = self.config.parsed_tiers()
        except ValueError as e:
            raise RuntimeError(f"SITE_TIERS misconfigured: {e}") from e

        if tiers:
            data_script, wrappers_meta, modes = self._envelope_data_scripts(
                loaded, tiers,
            )
        else:
            # Per-source single-tier emission (existing path).
            data_parts: list[str] = []
            modes = []
            for spec, camps in loaded:
                tag, mode = self._data_script(camps, spec)
                data_parts.append(tag)
                modes.append(f"{spec}={mode}")
            data_script = "\n".join(data_parts)
            wrappers_meta = ""   # no manifest in non-envelope builds

        # Comma-separated source list; client picks the first as
        # default if there's no `bm-source` in localStorage.
        sources_meta = (
            f'<meta name="bm-sources" content="'
            f'{",".join(spec for spec, _ in loaded)}">'
        )
        bundle_js = self._read_bundle()

        # Guard: our placeholder isn't a substring that could legally appear
        # inside minified JS. If it did, escape or rename. Two closing </script>
        # sequences inside the bundle itself would break embed — esbuild
        # doesn't produce those, but check defensively.
        if "</script>" in bundle_js.lower():
            raise RuntimeError("bundle contains a literal </script>; refusing to embed")

        # Release notes — commits whose subject starts with `rn:`. The
        # client polls this list against a localStorage watermark and
        # shows a banner with anything newer than what the user has
        # dismissed. `</` is escaped to `<\/` so a stray `</script>` in
        # an `rn:` message can't break the inline JSON embed.
        notes_json = (
            json.dumps(self._collect_release_notes(), separators=(",", ":"))
            .replace("</", "<\\/")
        )
        notes_script = (
            f'<script id="bm-release-notes" type="application/json">'
            f'{notes_json}'
            f'</script>'
        )

        # load_camps() already populated _effective_start. The client
        # derives calendar columns from burn_start + burn_end directly,
        # so no separate week-map tag is needed.
        html = (
            self._read_template()
            .replace("__DATA_SCRIPT__",        data_script)
            .replace("__SOURCES_META__",       sources_meta)
            .replace("__TIER_WRAPPERS_META__", wrappers_meta)
            .replace("__BUNDLE__",             bundle_js)
            .replace("__RELEASE_NOTES__",      notes_script)
            .replace("__CONTACT_EMAIL__",      self.config.contact_email)
            .replace("__VERSION__",            meta.get("version", "v0.0.0"))
            .replace("__FETCHED_DATE__",       meta.get("fetched_date", "unknown"))
            .replace("__FETCHED_AT__",         meta.get("fetched_at", "unknown"))
            .replace("__BURN_START__",         self._effective_start)
            .replace("__BURN_END__",           self.config.burn_end)
        )

        self.config.site_html.parent.mkdir(parents=True, exist_ok=True)
        self.config.site_html.write_text(html, encoding="utf-8")

        # Service worker so the site is usable offline after first load.
        # Version stamp pins a cache key — rebuilds evict old caches.
        sw_path = self._write_service_worker(meta.get("version", "v0.0.0"))

        # Tiny version pin file, polled by the client every ~15 min to
        # detect new deploys. Excluded from the SW's fetch handler
        # (see _write_service_worker) so polling always reaches origin
        # rather than serving the cached, just-loaded copy.
        version_path = self.config.site_dir / "version.txt"
        version_path.write_text(
            meta.get("version", "v0.0.0") + "\n", encoding="utf-8",
        )

        size_kb = self.config.site_html.stat().st_size / 1024
        print(f"wrote {self.config.site_html}")
        print(f"wrote {sw_path}")
        print(f"  modes: {', '.join(modes)}")
        print(f"  contact: {self.config.contact_email}")
        print(f"  version: {meta.get('version', '?')} ({meta.get('fetched_date', '?')})")
        for spec, camps in loaded:
            total_events = sum(len(c.events) for c in camps)
            with_web = sum(1 for c in camps if c.website)
            tagged = sum(1 for c in camps if c.tags)
            print(f"  [{spec}] {len(camps)} camps · {with_web} with website "
                  f"· {total_events} events · {tagged} tagged")
        print(f"  {size_kb:.1f} KB")
        return self.config.site_html
