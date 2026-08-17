"""Build the self-contained site/index.html.

Reads the HTML template from `playa/templates/site.html`, loads annual API
snapshots, applies tags,
optionally encrypts each source's payload via openssl + PBKDF2 +
AES-256-CBC, substitutes placeholders, and writes the result.

Placeholders in the template:
    __DATA_SCRIPT__     — concatenated <script> tags, one per source,
                          each id-suffixed with the source name
                          (e.g., camps-data-api-2024-encrypted)
    __SOURCES_META__    — <meta name="bm-sources" content="…"> listing
                          embedded sources (default-first)
    __BODY_CLASS__      — "gated" when any source is encrypted
    __GATE_HIDDEN__     — "" when encrypted (shown), "gate-hidden" otherwise
    __VERSION__         — build/deploy version vYYYY.MM.DD.HHMM
    __FETCHED_DATE__    — YYYY-MM-DD
    __FETCHED_AT__      — YYYY-MM-DDTHH:MM:SSZ (tooltip)
    __LOCATION_RELEASE_YEAR__ — current live API/map year
    __CAMP_LOCATION_RELEASE_AT__ — camp public-release ISO timestamp
    __ART_LOCATION_RELEASE_AT__  — art public-release ISO timestamp
    __SYNC_META__        — optional Dropbox provider/App-key metadata
"""
from __future__ import annotations

import base64
import gzip
import html as html_lib
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import Config
from .gis import validate_normalized_gis
from .models import Art, Camp
from .sources import Source, SourceSnapshot, make_source
from .tagger import Tagger
from .timeparser import (
    canonical_week_map,
    earliest_day_in_map,
    effective_burn_start,
    format_display,
    parse_event_time,
    resolve_end_date,
    resolve_single_start_date,
)


TEMPLATE_PATH = Path(__file__).parent / "templates" / "site.html"
PRIVACY_TEMPLATE_PATH = Path(__file__).parent / "templates" / "privacy.html"
# The client bundle lives at <repo_root>/client/dist/bundle.js. We derive
# it from `config.root` at call time (see _read_bundle) rather than via
# __file__ so it's test-injectable (tests pass a tmp_path root).
PACIFIC = ZoneInfo("America/Los_Angeles")

# Safety rail: refuse to build a site with fewer camps than this. A build with
# 10 camps is likely a broken or incomplete current-year API snapshot; fail so CI
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
        # Year-specific dates have NO code defaults — operator sets
        # them via repo variables in CI (BURN_WINDOW_OPEN_FROM /
        # BURN_WINDOW_OPEN_TO) or `.env` locally. Fail loud here
        # rather than later with an unhelpful "Invalid isoformat: ''"
        # deep in the event parser. These dates drive the calendar
        # fallback and public-access window only; D8 location release
        # timestamps are validated separately when the current API
        # source is included.
        if not config.burn_start or not config.burn_end:
            raise RuntimeError(
                "BURN_WINDOW_OPEN_FROM and BURN_WINDOW_OPEN_TO must "
                "both be set (repo variables in CI; `export "
                "BURN_WINDOW_OPEN_FROM=YYYY-MM-DD "
                "BURN_WINDOW_OPEN_TO=YYYY-MM-DD` locally, or in "
                "`.env` at the repo root). "
                f"Currently: BURN_WINDOW_OPEN_FROM={config.burn_start!r}, "
                f"BURN_WINDOW_OPEN_TO={config.burn_end!r}.",
            )
        self.config = config
        self.tagger = tagger or Tagger()
        # Populated by _enrich_event_times. The calendar window is derived
        # from fetched events (earliest event date) + configured burn_end,
        # so it can't be known until events are loaded.
        self._effective_start: str = config.burn_start
        self._week_map: dict[str, str] = {}
        self.source_specs: list[str] = list(sources or [])

    def _validate_location_release_policy(self) -> None:
        """Fail closed for a current-year API build with bad D8 dates.

        Past-year API records are already public, so only the API source matching
        ``brc_map_year`` requires the annual release timestamps.
        """
        current_api = f"api-{self.config.brc_map_year}"
        if current_api not in self.source_specs:
            return

        values = {
            "CAMP_LOCATION_RELEASE_AT": self.config.camp_location_release_at,
            "ART_LOCATION_RELEASE_AT": self.config.art_location_release_at,
        }
        parsed: dict[str, datetime] = {}
        for name, value in values.items():
            if not value:
                raise RuntimeError(
                    f"{name} must be set when {current_api} is embedded. "
                    "Use a timezone-aware ISO-8601 timestamp, for example "
                    "2026-08-23T00:00:00-07:00.",
                )
            try:
                stamp = datetime.fromisoformat(value)
            except ValueError as e:
                raise RuntimeError(
                    f"{name}={value!r} is not a valid ISO-8601 timestamp.",
                ) from e
            if stamp.tzinfo is None or stamp.utcoffset() is None:
                raise RuntimeError(
                    f"{name}={value!r} must include an explicit timezone "
                    "offset (for example -07:00 for PDT).",
                )
            if stamp.year != self.config.brc_map_year:
                raise RuntimeError(
                    f"{name} year {stamp.year} does not match BRC_MAP_YEAR="
                    f"{self.config.brc_map_year}.",
                )
            parsed[name] = stamp

        if parsed["CAMP_LOCATION_RELEASE_AT"] >= parsed["ART_LOCATION_RELEASE_AT"]:
            raise RuntimeError(
                "CAMP_LOCATION_RELEASE_AT must be earlier than "
                "ART_LOCATION_RELEASE_AT; the official camp release "
                "precedes the art/gate-open release.",
            )

    def _sync_meta(self) -> str:
        """Build-gated Dropbox config; default HTML has no provider metadata."""
        provider = self.config.sync_provider
        client_id = self.config.sync_client_id
        if not provider and not client_id:
            return ""
        if provider != "dropbox":
            raise RuntimeError(
                "SYNC_PROVIDER must be unset or 'dropbox' for this build."
            )
        if not client_id:
            raise RuntimeError(
                "SYNC_CLIENT_ID must be set when SYNC_PROVIDER=dropbox."
            )
        if len(client_id) > 128 or not all(
            c.isalnum() or c in "_-" for c in client_id
        ):
            raise RuntimeError("SYNC_CLIENT_ID contains invalid characters.")
        values = {
            "bm-sync-provider": "dropbox",
            "bm-sync-client-id": client_id,
        }
        return "\n".join(
            f'<meta name="{name}" content="{html_lib.escape(value, quote=True)}">'
            for name, value in values.items()
        )

    # --- data loading -----------------------------------------------------

    def load_food_exclusions(self, source_spec: str) -> set[tuple[str, str]]:
        """Read API-year Food-only `kind:id` exclusions.

        Valid kinds are `camp` and `event`. Fail on malformed lines so an
        operator typo cannot silently leave a reviewed false positive deployed.
        """
        path = self.config.food_exclusion_file(source_spec)
        if not path.exists():
            return set()
        exclusions: set[tuple[str, str]] = set()
        for line_number, raw in enumerate(path.read_text().splitlines(), start=1):
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            kind, separator, item_id = line.partition(":")
            kind = kind.strip()
            item_id = item_id.strip()
            if separator != ":" or kind not in {"camp", "event"} or not item_id:
                raise ValueError(
                    f"invalid Food exclusion at {path}:{line_number}; "
                    "expected `camp:<id>` or `event:<id>`",
                )
            exclusions.add((kind, item_id))
        return exclusions

    def load_snapshot_for_source(self, spec: str) -> SourceSnapshot:
        """Load one API cache once, then tag and enrich its entities.

        Note: the current-year API location embargo is enforced
        **client-side**, not here. Build artifacts retain full location
        data; the UI compares camp and art against their independent
        annual public-release timestamps.
        See `client/src/utils/embargo.ts` and ADR D8.
        """
        source: Source = make_source(spec)
        snapshot = source.load_snapshot(self.config)
        camps = snapshot.camps
        food_exclusions = self.load_food_exclusions(spec)
        applied_food_exclusions: set[tuple[str, str]] = set()
        suppressed_camps = 0
        suppressed_events = 0
        for camp in camps:
            camp.tags = self.tagger.tag_camp(camp)
            camp.food_tags = self.tagger.food_types_for_camp(camp)
            if camp.food_tags and ("camp", camp.id) in food_exclusions:
                camp.food_tags = []
                applied_food_exclusions.add(("camp", camp.id))
                suppressed_camps += 1
            for event in camp.events:
                event.food_tags = self.tagger.tag_event_food(event)
                if event.food_tags and ("event", event.id) in food_exclusions:
                    event.food_tags = []
                    applied_food_exclusions.add(("event", event.id))
                    suppressed_events += 1
        if suppressed_camps or suppressed_events:
            print(
                f"  [{spec}] suppressed Food classification for "
                f"{suppressed_camps} camp(s), {suppressed_events} event(s)",
            )
        unmatched_food_exclusions = food_exclusions - applied_food_exclusions
        if unmatched_food_exclusions:
            print(
                f"  [{spec}] warning: {len(unmatched_food_exclusions)} Food "
                "exclusion(s) did not match a classified record",
            )
        camps.sort(key=lambda c: c.name.lower())
        self._enrich_event_times(camps)
        for piece in snapshot.art:
            piece.tags = self.tagger.tag_art(piece)
        snapshot.art.sort(key=lambda a: a.name.lower())
        return snapshot

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

        # Derive this source's calendar window + canonical day→date map.
        # Preserve the earliest start seen across every embedded source;
        # otherwise the last-loaded API year can overwrite an earlier date.
        source_effective_start = effective_burn_start(
            parsed_only, self.config.burn_start, self.config.burn_end,
        )
        self._effective_start = min(self._effective_start, source_effective_start)
        week_map = canonical_week_map(source_effective_start, self.config.burn_end)
        self._week_map = canonical_week_map(
            self._effective_start, self.config.burn_end,
        )

        # Pass 2: stamp canonical dates + format display strings.
        recognized = 0
        for ev, p in parses:
            if p:
                # Override fetched start_date + fill end_date from canonical map.
                end_day = p["end_day"] or p["start_day"]
                p["end_day"] = end_day
                if p["kind"] == "recurring" and p.get("days"):
                    # Stamp the earliest occurrence date (the same one the
                    # display's "(starts M/D)" uses) so the client can date-gate
                    # recurring availability rather than matching weekday-only.
                    earliest = earliest_day_in_map(p["days"], week_map)
                    p["start_date"] = week_map.get(earliest or "") or p.get("start_date")
                else:
                    p["start_date"] = resolve_single_start_date(
                        p, week_map, source_effective_start, self.config.burn_end,
                    )
            s = format_display(p, week_map)
            if s:
                ev.display_time = s
                recognized += 1
            if p:
                ev.parsed_time = {
                    **p,
                    "end_date": resolve_end_date(p, week_map),
                }
        if parses:
            print(f"  event times parsed: {recognized}/{len(parses)} "
                  f"({100 * recognized // len(parses)}%); "
                  f"source window: {source_effective_start} → "
                  f"{self.config.burn_end}; "
                  f"site start: {self._effective_start}; "
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
        # size for a one-shot deployment build.
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
        tiers: list[tuple[str, str, list[str]]],
        loaded_art: list[tuple[str, list[Art]]] | None = None,
    ) -> tuple[str, str, list[str], dict[str, tuple[bytes, bytes]]]:
        """Build all the per-source ciphers + per-(source, tier) DEK
        wrappers + the manifest meta tag(s) for envelope-mode deploys
        (ADR D10).

        Returns `(scripts_block, wrappers_meta_tag, modes, source_keys)` where:
          * `scripts_block` concatenates every embed (cipher + wrappers)
          * `wrappers_meta_tag` is one or two `<meta>` lines: always
            `bm-tier-wrappers` (per-source wrapper indices), plus
            `bm-trusted-wrappers` when a `god-mode` tier exists. The
            trusted manifest lists which (source, wrapper_idx) pairs
            were emitted for `god-mode` so the client can grant that
            tier's user a per-tier privilege (today: bypassing the
            pre-burn location embargo) without leaking the tier NAME
            into the DOM. Demigod / spirit / unnamed tiers are not
            listed — they remain ToS-bound.
          * `modes` is a one-line summary for the build log
          * `source_keys` is the `{source: (DEK, IV)}` map — needed by
            D13's `BURN_OPEN` path to expose the spirit-mode DEK in
            `site/burn-key.json`. Caller MUST NOT leak this otherwise.

        Raises if a tier lists a source not in `loaded` (typo guard).
        """
        loaded_specs = {spec for spec, _ in loaded}
        for name, _pw, srcs in tiers:
            for s in srcs:
                if s not in loaded_specs:
                    raise RuntimeError(
                        f"SITE_TIERS tier {name!r} lists source {s!r} "
                        f"but it isn't in the loaded set "
                        f"{sorted(loaded_specs)}. Either extend "
                        "--sources or fix the tier definition.",
                    )

        parts: list[str] = []
        wrappers_by_source: dict[str, list[int]] = {spec: [] for spec, _ in loaded}
        # Track DEK+IV per source so wrappers can re-encrypt the same
        # 48-byte blob multiple times (one per tier that includes the
        # source).
        source_keys: dict[str, tuple[bytes, bytes]] = {}
        # Wrapper indices that belong to the `god-mode` tier — emitted
        # in a parallel manifest so the client can grant per-tier
        # privileges without exposing tier names. Stays empty if no
        # tier is named `god-mode`.
        trusted_by_source: dict[str, list[int]] = {spec: [] for spec, _ in loaded}

        # 1) Encrypt each source's gzipped JSON with a fresh random DEK.
        # Camps + art (when present) for the same source share ONE DEK
        # but use SEPARATE IVs — IV reuse across distinct plaintexts in
        # CBC mode leaks first-block XOR, and gzip headers are mostly
        # deterministic in the first 10 bytes (magic + flags + zero
        # mtime), making that leak meaningful. Wrapper still carries
        # DEK + camps-IV so existing wire format / unwrapDek behavior
        # is unchanged; the art cipher's IV travels in its own script
        # tag and the client reads `cipher.iv` directly.
        art_by_source: dict[str, list[Art]] = {
            spec: lst for spec, lst in (loaded_art or [])
        }
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

            # Art cipher for this source (when art was loaded). Reuses
            # the camps DEK; fresh random IV. Empty art lists still
            # emit a cipher (decrypts to "[]") so the client always has
            # a known shape per source.
            art_pieces = art_by_source.get(spec, [])
            art_payload = json.dumps(
                [a.to_dict() for a in art_pieces],
                ensure_ascii=False, separators=(",", ":"),
            ).encode("utf-8")
            art_compressed = gzip.compress(art_payload, compresslevel=6)
            art_iv = os.urandom(16)
            art_ct = self._aes_cbc_encrypt(art_compressed, dek, art_iv)
            art_cipher = {
                "iv": base64.b64encode(art_iv).decode("ascii"),
                "ct": base64.b64encode(art_ct).decode("ascii"),
                "compressed": True,
            }
            parts.append(
                f'<script id="art-data-{spec}-cipher" '
                f'type="application/json">'
                + json.dumps(art_cipher, separators=(",", ":"))
                + '</script>'
            )

        # 2) For each (tier, source-in-tier) pair, wrap the source's
        #    DEK+IV with the tier's password.
        for name, pw, tier_srcs in tiers:
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
                if name == "god-mode":
                    trusted_by_source[spec].append(wrapper_idx)

        # 3) Manifest(s). Sources with zero wrappers are omitted — they
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

        # Trusted manifest: only emit when god-mode is configured AND
        # actually owns wrappers. Format mirrors `bm-tier-wrappers` so
        # the client's parser can be reused. Empty god-mode (no
        # sources) silently skips — same as a missing tier.
        trusted_segs = []
        for spec, _ in loaded:
            idxs = trusted_by_source[spec]
            if idxs:
                trusted_segs.append(f"{spec}:{','.join(str(i) for i in idxs)}")
        if trusted_segs:
            wrappers_meta += (
                f'\n<meta name="bm-trusted-wrappers" '
                f'content="{";".join(trusted_segs)}">'
            )

        modes = [
            f"envelope ({len(tiers)} tiers, "
            f"{len(loaded)} sources, "
            f"{sum(len(v) for v in wrappers_by_source.values())} wrappers)"
        ]
        return "\n".join(parts), wrappers_meta, modes, source_keys

    # --- template + write -------------------------------------------------

    @staticmethod
    def _read_template() -> str:
        return TEMPLATE_PATH.read_text(encoding="utf-8")

    def _write_privacy_page(self) -> Path:
        """Emit a public policy without app payloads or password gating."""
        policy = PRIVACY_TEMPLATE_PATH.read_text(encoding="utf-8")
        out = self.config.site_dir / "privacy.html"
        out.write_text(policy, encoding="utf-8")
        return out

    def _data_script(
        self, camps: list[Camp], source: str,
    ) -> tuple[str, str]:
        """Return (data_script_tag, mode_label) for one source's CAMPS.

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
        return self._typed_data_script(
            [c.to_dict() for c in camps], source, kind="camps",
        )

    def _art_script(
        self, art: list[Art], source: str,
    ) -> tuple[str, str]:
        """Return (data_script_tag, mode_label) for one source's ART.
        Mirrors `_data_script` exactly — same encryption / gzip rules,
        just under the `art-data-…` script ids."""
        return self._typed_data_script(
            [a.to_dict() for a in art], source, kind="art",
        )

    def _typed_data_script(
        self, items: list[dict], source: str, *, kind: str,
    ) -> tuple[str, str]:
        """Shared emitter for both `camps-data-…` and `art-data-…`
        script tags. `kind` controls the id prefix only — the
        encryption/compression path is identical for both."""
        payload_bytes = json.dumps(
            items, ensure_ascii=False, separators=(",", ":"),
        ).encode("utf-8")

        if self.config.site_password:
            enc = self.encrypt_payload(payload_bytes)
            tag = (
                f'<script id="{kind}-data-{source}-encrypted" '
                f'type="application/json">'
                + json.dumps(enc, separators=(",", ":"))
                + "</script>"
            )
            return tag, f"encrypted (PBKDF2 iter={self.config.pbkdf2_iter})"

        compressed = gzip.compress(payload_bytes, compresslevel=6)
        payload_b64 = base64.b64encode(compressed).decode("ascii")
        tag = (
            f'<script id="{kind}-data-{source}" '
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

    def _copy_semantic_backend(self) -> Path | None:
        """Copy the code-split semantic-search chunk (ADR 21) next to index.html
        as `site/semantic-backend.js`.

        This holds @huggingface/transformers + @orama/orama and is loaded by the
        main bundle at runtime ONLY when a user opts into the model download —
        deliberately NOT inlined and NOT in the SW precache SHELL, so users who
        never open Ask don't pay its weight. esbuild always emits it alongside
        dist/bundle.js; a missing chunk means a broken/partial client build, so
        fail loud like _read_bundle.
        """
        src = self.config.root / "client" / "dist" / "semantic-backend.js"
        if not src.exists():
            raise RuntimeError(
                f"semantic backend chunk missing at {src}. "
                "Build it with `make bundle` (or `cd client && "
                "npm ci && npm run build`)."
            )
        if "</script>" in src.read_text(encoding="utf-8").lower():
            # Served as its own file, so this can't break an embed, but a
            # literal close tag would still be a red flag for a corrupt build.
            print("  WARNING: semantic-backend.js contains a literal </script>")
        out = self.config.site_dir / "semantic-backend.js"
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, out)
        return out

    def _write_embeddings(
        self,
        loaded: list[tuple[str, list["Camp"]]],
        loaded_art: list[tuple[str, list["Art"]]],
    ) -> list[str]:
        """Generate self-hosted MiniLM vectors for camps + events + art and write
        one file PER SOURCE — `site/embeddings-<source>.json` (ADR 21 D9). Opt-in
        via `BM_EMBEDDINGS` so tests and quick rebuilds skip the node + model step.

        The vectors are SEPARATE files (not inlined into index.html), each fetched
        by the client only when the user opts into the model download and only for
        the year being viewed — so the page stays small for everyone else and a
        multi-year user downloads only the index they search. Returns the shipped
        sources (current-year first) for the `bm-embeddings` meta manifest.

        Flow: write `data/embeddings/records.json` (id + text) → shell the
        incremental Node embedder (`client/scripts/embed.mjs`, content-hash cached,
        one `vectors.json` keyed `source:kind:id`) → partition by source → write
        `site/embeddings-<source>.json` each. Any failure warns and returns an empty
        list so a build never breaks over the optional AI feature.
        """
        if os.environ.get("BM_EMBEDDINGS", "").lower() not in ("1", "true", "yes"):
            return []

        def camp_text(c: "Camp") -> str:
            return ". ".join(p for p in [c.name, " ".join(c.tags), c.description] if p)

        def art_text(a: "Art") -> str:
            bits = [a.name, f"by {a.artist}" if a.artist else "", a.category, a.description]
            return ". ".join(p for p in bits if p)

        def event_text(e, camp_name: str) -> str:
            bits = [e.name, e.description, f"at {camp_name}" if camp_name else ""]
            return ". ".join(p for p in bits if p)

        # Key by source:kind:id. Prefixing with the source keeps a shared API
        # uid (the same camp in api-2025 AND api-2026) from getting one year's
        # vector for both — each source embeds its own records, and the client
        # looks up vectors under the ACTIVE source's prefix.
        records: list[dict] = []
        seen: set[str] = set()
        for spec, camps in loaded:
            for c in camps:
                key = f"{spec}:camp:{c.id}"
                if key not in seen:
                    seen.add(key)
                    records.append({"key": key, "text": camp_text(c)})
                for e in c.events or []:
                    ekey = f"{spec}:event:{e.id}"
                    if ekey in seen:
                        continue
                    seen.add(ekey)
                    records.append({"key": ekey, "text": event_text(e, c.name)})
        for spec, art in loaded_art:
            for a in art:
                key = f"{spec}:art:{a.id}"
                if key in seen:
                    continue
                seen.add(key)
                records.append({"key": key, "text": art_text(a)})

        emb_dir = self.config.root / "data" / "embeddings"
        emb_dir.mkdir(parents=True, exist_ok=True)
        (emb_dir / "records.json").write_text(json.dumps(records), encoding="utf-8")

        client_dir = self.config.root / "client"
        try:
            subprocess.run(
                ["node", "scripts/embed.mjs"],
                cwd=client_dir,
                env={**os.environ, "PLAYA_ROOT": str(self.config.root)},
                check=True,
            )
        except (OSError, subprocess.CalledProcessError) as exc:
            print(f"  WARNING: embedding step failed ({exc}); shipping without vectors")
            return []

        vectors_path = emb_dir / "vectors.json"
        if not vectors_path.exists():
            print("  WARNING: embedder produced no vectors.json; shipping without vectors")
            return []

        # `vectors.json` = {model, dim, q:'int8', sig, keys:[source:kind:id...],
        # data:base64(concat of dim-byte int8 rows, in `keys` order)}. Partition
        # it by source prefix into one `embeddings-<source>.json` per source, so a
        # multi-year user downloads only the year they view (ADR 21 D9). Keys keep
        # the full `source:kind:id` form; the client filters to the active source.
        payload = json.loads(vectors_path.read_bytes())
        keys: list[str] = payload.get("keys", [])
        dim = int(payload["dim"])
        blob = base64.b64decode(payload["data"])
        grouped: dict[str, tuple[list[str], bytearray]] = {}
        for i, key in enumerate(keys):
            src = key.split(":", 1)[0]
            slot = grouped.setdefault(src, ([], bytearray()))
            slot[0].append(key)
            slot[1].extend(blob[i * dim:(i + 1) * dim])

        self.config.site_dir.mkdir(parents=True, exist_ok=True)
        # Clear any stale index — the pre-split single `embeddings.json` and any
        # per-source file for a year not in this build — so a local rebuild never
        # leaves an orphaned index in site/ (CI builds are already clean checkouts).
        for stale in self.config.site_dir.glob("embeddings*.json"):
            stale.unlink()
        shipped: list[str] = []
        # Order current-year first, matching the loaded source order, so the meta
        # manifest's first entry is the client's default source.
        for spec, _ in loaded:
            group = grouped.get(spec)
            if not group:
                continue
            src_keys, src_bytes = group
            per = {
                "model": payload.get("model"),
                "dim": dim,
                "q": payload.get("q"),
                "sig": payload.get("sig"),
                "keys": src_keys,
                "data": base64.b64encode(bytes(src_bytes)).decode("ascii"),
            }
            out = self.config.site_dir / f"embeddings-{spec}.json"
            body = json.dumps(per)
            out.write_text(body, encoding="utf-8")
            shipped.append(spec)
            print(
                f"  embeddings: {len(src_keys)} vectors → site/{out.name} "
                f"({len(body) // 1024} KB, served gzipped)",
            )
        return shipped

    def _gis_data_scripts(self, sources: list[str]) -> tuple[str, list[str]]:
        """Embed one public, normalized GIS payload per active map year.

        GIS is shared across passwords and sources for the same year, so it is
        gzip/base64 encoded but not duplicated into source encryption
        envelopes. Missing local GIS is a development fallback: the hand-built
        base map still works and the build logs a loud warning. The deployment
        pipeline fetches/validates GIS before calling the builder.
        """
        years: set[int] = set()
        for source in sources:
            if source.startswith("api-"):
                try:
                    years.add(int(source[4:]))
                except ValueError:
                    continue
        tags: list[str] = []
        embedded: list[str] = []
        for year in sorted(years):
            path = self.config.gis_payload_file(year)
            if not path.exists():
                print(
                    f"  WARNING: GIS {year} cache missing at {path}; "
                    f"run `python -m playa gis-fetch --year {year}`. "
                    "Building the base map without official overlays."
                )
                continue
            try:
                raw = path.read_bytes()
                # Parsing here catches a truncated/manual cache before it
                # reaches the browser; the GIS loader owns deeper schema
                # validation. GIS is an optional subsystem, so an unusable
                # cache removes only that year's overlay—not the whole site.
                parsed = json.loads(raw)
                validate_normalized_gis(parsed, year)
                b64 = base64.b64encode(
                    gzip.compress(raw, compresslevel=9),
                ).decode("ascii")
            except Exception as exc:
                print(
                    f"  WARNING: GIS {year} cache unusable at {path} "
                    f"({type(exc).__name__}: {exc}). Building without that "
                    "year's official overlays."
                )
                continue
            tags.append(
                f'<script id="gis-data-{year}" '
                f'type="application/x-gzip-base64">{b64}</script>'
            )
            embedded.append(str(year))
        return "\n".join(tags), embedded

    def _write_service_worker(self, version: str) -> Path:
        """Emit site/sw.js so the site works fully offline after first
        load. Four caches:

          1. Versioned shell cache (`playa-<VERSION>`) — index.html,
             SW, manifest, icon. Pruned on activate so old versions
             evaporate when a new build deploys.
          2. Cross-origin runtime image cache (`playa-img-v2`) —
             stale-while-revalidate for art thumbnails fetched from
             BM's CDN. Survives version bumps so users keep their
             starred-art images offline across deploys.
          3. Durable Ask cache (`playa-ask-v3`) — the lazy semantic chunk and
             the per-source `embeddings-<source>.json` indexes (D9). Populated
             only after opt-in and preserved across deploy version bumps so a
             previously-set-up Ask stays offline-capable. Activation prunes older
             `playa-ask-*` namespaces (incl. the pre-split single embeddings.json).
          4. Transformers.js's `transformers-cache` — model + ONNX runtime
             assets. The worker does not populate it, but shell-cache eviction
             must leave this library-owned cache alone.

             (browser HTTP cache sits below all of this — invisible to us)

        The fetch handler:
          - Same-origin: cache-first against the shell (existing).
          - Cross-origin GET image: stale-while-revalidate against
            the image cache. First view streams +
            stores; subsequent loads (and full offline) serve from
            the cache. Failures on first view return a 404-ish empty
            response so ArtCard's `onError` hides the broken slot.
          - Everything else cross-origin: pass through (no SW handling).
        """
        sw = (
            "// Auto-generated by playa.builder — do not edit by hand.\n"
            "// Version: " + version + "\n"
            "const VERSION = " + json.dumps(version) + ";\n"
            "const CACHE = 'playa-' + VERSION;\n"
            "// Cross-origin image cache (art thumbnails). Decoupled\n"
            "// from VERSION so cached images survive deploys.\n"
            "const IMG_CACHE = 'playa-img-v2';\n"
            "// Ask's lazy same-origin assets survive shell version changes.\n"
            "// v3 drops the pre-split single embeddings.json; per-source\n"
            "// embeddings-<source>.json are runtime-cached on first fetch (D9).\n"
            "// transformers.js separately owns MODEL_CACHE for model/ORT files.\n"
            "const ASK_CACHE = 'playa-ask-v3';\n"
            "const MODEL_CACHE = 'transformers-cache';\n"
            "const ASK_ASSETS = ['./semantic-backend.js'];\n"
            "// Cap image-cache entries — eviction is best-effort\n"
            "// LRU via insertion order (Cache.keys() returns FIFO).\n"
            "// Sized to hold the whole art set (a few hundred pieces) with\n"
            "// headroom so idle warming fills a complete offline set instead\n"
            "// of churning; the browser's own storage quota is the real\n"
            "// backstop past this.\n"
            "const IMG_CACHE_MAX = 2000;\n"
            "const SHELL = ['./', './index.html', './privacy.html', "
            "'./robots.txt', './manifest.webmanifest', './icon.svg'];\n"
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
            "    // Purge every prior app cache — old shells and pre-v3 image/Ask\n"
            "    // namespaces (incl. the single-file embeddings cache) — while\n"
            "    // preserving the current three and the source-independent\n"
            "    // transformers.js model cache (no 'playa-' prefix).\n"
            "    await Promise.all(keys\n"
            "      .filter(k => k.startsWith('playa-')\n"
            "        && k !== CACHE && k !== IMG_CACHE && k !== ASK_CACHE)\n"
            "      .map(k => caches.delete(k)));\n"
            "    await self.clients.claim();\n"
            "  })());\n"
            "});\n"
            "// Message handler — lets the page ask the SW to refresh its\n"
            "// shell cache from origin before a reload. Non-destructive:\n"
            "// if any fetch fails, the old cached entry stays in place,\n"
            "// so the next load still has a working copy of the site.\n"
            "self.addEventListener('message', (e) => {\n"
            "  if (e.data && e.data.type === 'CACHE_ART_IMAGE') {\n"
            "    const reply = e.ports && e.ports[0];\n"
            "    e.waitUntil(cacheArtImage(e.data.url).then((ok) => {\n"
            "      try { reply && reply.postMessage({ ok }); } catch (_) {}\n"
            "    }).catch(() => {\n"
            "      try { reply && reply.postMessage({ ok: false }); } catch (_) {}\n"
            "    }));\n"
            "    return;\n"
            "  }\n"
            "  if (e.data === 'CLEAR_IMAGE_CACHE') {\n"
            "    // Backward-compatible message name used by 'Clear all local\n"
            "    // data'. Clear every durable app/model cache, not user state.\n"
            "    e.waitUntil(Promise.all([\n"
            "      caches.delete(IMG_CACHE),\n"
            "      caches.delete(ASK_CACHE),\n"
            "      caches.delete(MODEL_CACHE),\n"
            "    ]).then(() => {\n"
            "      try { e.source && e.source.postMessage('IMAGE_CACHE_CLEARED'); } catch (_) {}\n"
            "    }));\n"
            "    return;\n"
            "  }\n"
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
            "// Trim the image cache when it grows past the cap. Drops\n"
            "// the oldest entries (insertion order = FIFO ≈ LRU since\n"
            "// browsers re-insert on hit only via cache.put, not match).\n"
            "async function pruneImageCache() {\n"
            "  const cache = await caches.open(IMG_CACHE);\n"
            "  const keys = await cache.keys();\n"
            "  if (keys.length <= IMG_CACHE_MAX) return;\n"
            "  const drop = keys.slice(0, keys.length - IMG_CACHE_MAX);\n"
            "  await Promise.all(drop.map(k => cache.delete(k)));\n"
            "}\n"
            "// Called one URL at a time by the page's idle scheduler.\n"
            "// Visible <img> requests use the fetch handler below; both paths\n"
            "// share the same durable cache and entry cap.\n"
            "async function cacheArtImage(rawUrl) {\n"
            "  if (typeof rawUrl !== 'string' || rawUrl.length > 4096) return false;\n"
            "  let url;\n"
            "  try { url = new URL(rawUrl); } catch (_) { return false; }\n"
            "  if (url.protocol !== 'https:') return false;\n"
            "  const req = new Request(url.href, { mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer' });\n"
            "  const cache = await caches.open(IMG_CACHE);\n"
            "  if (await cache.match(req)) return true;\n"
            "  const response = await fetch(req);\n"
            "  if (!response || !(response.ok || response.type === 'opaque')) return false;\n"
            "  await cache.put(req, response.clone());\n"
            "  await pruneImageCache();\n"
            "  return true;\n"
            "}\n"
            "self.addEventListener('fetch', (e) => {\n"
            "  const req = e.request;\n"
            "  if (req.method !== 'GET') return;\n"
            "  const url = new URL(req.url);\n"
            "  // Cross-origin path: cache-fill for art images, pass\n"
            "  // through for everything else.\n"
            "  if (url.origin !== self.location.origin) {\n"
            "    if (req.destination !== 'image') return;\n"
            "    e.respondWith((async () => {\n"
            "      const cache = await caches.open(IMG_CACHE);\n"
            "      const cached = await cache.match(req);\n"
            "      if (cached) {\n"
            "        // Background revalidate — refresh latest copy.\n"
            "        fetch(req).then((r) => {\n"
            "          // Cache opaque (no-cors) responses too — they're\n"
            "          // valid for <img> serving even though their\n"
            "          // body isn't readable. status === 0 + type ===\n"
            "          // 'opaque' is the success signal here.\n"
            "          if (r && (r.ok || r.type === 'opaque')) {\n"
            "            cache.put(req, r.clone()).then(pruneImageCache);\n"
            "          }\n"
            "        }).catch(() => { /* offline → keep cached copy */ });\n"
            "        return cached;\n"
            "      }\n"
            "      try {\n"
            "        const net = await fetch(req);\n"
            "        if (net && (net.ok || net.type === 'opaque')) {\n"
            "          cache.put(req, net.clone()).then(pruneImageCache);\n"
            "        }\n"
            "        return net;\n"
            "      } catch (err) {\n"
            "        // Offline + uncached. Synthesize a 404 so the\n"
            "        // <img> fires `onError` and the ArtCard hides\n"
            "        // the slot cleanly.\n"
            "        return new Response('', { status: 404, statusText: 'Offline' });\n"
            "      }\n"
            "    })());\n"
            "    return;\n"
            "  }\n"
            "  // version.txt is the polling endpoint the client uses to\n"
            "  // detect a new deploy. Bypass the SW so polls always go\n"
            "  // to origin instead of serving the just-cached copy.\n"
            "  if (url.pathname.endsWith('/version.txt')) return;\n"
            "  // Ask files are opt-in and network-first while online, with a\n"
            "  // durable fallback that survives shell-cache eviction.\n"
            "  const isAskAsset = ASK_ASSETS.some((p) => url.pathname.endsWith(p.slice(1)))\n"
            "    || /\\/embeddings-[\\w.-]+\\.json$/.test(url.pathname);\n"
            "  if (isAskAsset) {\n"
            "    e.respondWith((async () => {\n"
            "      const cache = await caches.open(ASK_CACHE);\n"
            "      try {\n"
            "        const net = await fetch(req);\n"
            "        if (net.ok) await cache.put(req, net.clone());\n"
            "        return net;\n"
            "      } catch (err) {\n"
            "        const cached = await cache.match(req);\n"
            "        if (cached) return cached;\n"
            "        throw err;\n"
            "      }\n"
            "    })());\n"
            "    return;\n"
            "  }\n"
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

    @staticmethod
    def _build_meta(fetched_at: str) -> dict[str, str]:
        """Keep data freshness and deploy identity on separate clocks."""
        try:
            fetched = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise RuntimeError(
                f"primary API cache has invalid fetched_at {fetched_at!r}",
            ) from exc
        if fetched.tzinfo is None or fetched.utcoffset() is None:
            raise RuntimeError(
                f"primary API cache fetched_at must be timezone-aware: {fetched_at!r}",
            )
        built = datetime.now(timezone.utc).astimezone(PACIFIC)
        return {
            "fetched_at": fetched.astimezone(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ",
            ),
            "fetched_date": fetched.astimezone(PACIFIC).strftime("%Y-%m-%d"),
            "version": "v" + built.strftime("%Y.%m.%d.%H%M"),
        }

    def build(self) -> Path:
        # `__init__` already validated BURN_START / BURN_END are set.
        # Validate the independent, year-specific D8 location cutoffs
        # before loading any potentially expensive source data.
        self._validate_location_release_policy()
        sync_meta = self._sync_meta()
        current_spec = f"api-{self.config.brc_map_year}"
        if not self.source_specs:
            raise RuntimeError(
                "no API sources configured; pass --sources or set BM_API_YEARS",
            )
        if self.source_specs[0] != current_spec:
            raise RuntimeError(
                f"primary source must be {current_spec}; got {self.source_specs[0]!r}",
            )
        # Load every configured snapshot strictly. A missing historical cache
        # must not silently change the embedded source set or tier semantics.
        loaded: list[tuple[str, list[Camp]]] = []
        loaded_art: list[tuple[str, list[Art]]] = []
        loaded_snapshots: list[tuple[str, SourceSnapshot]] = []
        for spec in self.source_specs:
            snapshot = self.load_snapshot_for_source(spec)
            camps = snapshot.camps
            print(f"  source {spec!r}: {len(camps)} camps loaded")
            loaded.append((spec, camps))
            art = snapshot.art
            print(f"  source {spec!r}: {len(art)} art loaded")
            loaded_art.append((spec, art))
            loaded_snapshots.append((spec, snapshot))

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
        meta = self._build_meta(loaded_snapshots[0][1].fetched_at)

        # Three build modes:
        #   1. SITE_TIERS set     → envelope encryption (D10)
        #   2. SITE_PASSWORD set  → per-source single-tier encryption
        #   3. neither            → per-source plaintext (gzip + base64)
        try:
            tiers = self.config.parsed_tiers()
        except ValueError as e:
            raise RuntimeError(f"SITE_TIERS misconfigured: {e}") from e

        burn_open = os.environ.get("BURN_OPEN", "").strip() in (
            "1", "true", "yes", "on",
        )
        burn_key_path = self.config.site_dir / "burn-key.json"

        if tiers:
            data_script, wrappers_meta, modes, source_keys = (
                self._envelope_data_scripts(loaded, tiers, loaded_art)
            )
            # D13: write site/burn-key.json with the spirit-mode
            # source(s)' DEK+IV when BURN_OPEN=1. Spirit is identified
            # by tier NAME (`spirit-mode`) — operator labels each
            # entry in SITE_TIERS so the build can validate setup
            # rather than relying on a fragile last-position
            # convention.
            if burn_open:
                spirit_tier = next(
                    (t for t in tiers if t[0] == "spirit-mode"),
                    None,
                )
                if spirit_tier is None:
                    raise RuntimeError(
                        "BURN_OPEN=1 requires a tier named 'spirit-mode' "
                        "in SITE_TIERS. Got tier names: "
                        f"{[t[0] for t in tiers]}.",
                    )
                _name, _pw, spirit_sources = spirit_tier
                burn_data = {
                    s: base64.b64encode(
                        source_keys[s][0] + source_keys[s][1]
                    ).decode("ascii")
                    for s in spirit_sources
                }
                self.config.site_dir.mkdir(parents=True, exist_ok=True)
                burn_key_path.write_text(
                    json.dumps(burn_data, separators=(",", ":")),
                )
                modes.append(
                    f"BURN_OPEN: spirit-mode auto-unlocks "
                    f"{','.join(spirit_sources)}"
                )
            elif burn_key_path.exists():
                # Stale file from a previous BURN_OPEN=1 build —
                # remove so this deploy is closed.
                burn_key_path.unlink()
        else:
            # Per-source single-tier emission (existing path). Camps
            # and art are emitted as parallel script tags per source
            # — same encryption/gzip mode, distinct DOM ids.
            data_parts: list[str] = []
            modes = []
            art_by_source: dict[str, list[Art]] = {
                s: lst for s, lst in loaded_art
            }
            for spec, camps in loaded:
                tag, mode = self._data_script(camps, spec)
                data_parts.append(tag)
                art_tag, _art_mode = self._art_script(
                    art_by_source.get(spec, []), spec,
                )
                data_parts.append(art_tag)
                modes.append(f"{spec}={mode}")
            data_script = "\n".join(data_parts)
            wrappers_meta = ""   # no manifest in non-envelope builds
            if burn_open:
                # ADR D13 sanity check: BURN_OPEN without SITE_TIERS
                # means there's no spirit-mode tier to auto-unlock —
                # operator confusion. Fail loud.
                raise RuntimeError(
                    "BURN_OPEN=1 requires SITE_TIERS to be set "
                    "(no spirit-mode tier to auto-unlock).",
                )
            elif burn_key_path.exists():
                # Same staleness sweep for non-envelope builds.
                burn_key_path.unlink()

        # Comma-separated source list; client picks the first as
        # default if there's no `bm-source` in localStorage.
        sources_meta = (
            f'<meta name="bm-sources" content="'
            f'{",".join(spec for spec, _ in loaded)}">\n'
            f'<meta name="bm-brc-map-year" '
            f'content="{self.config.brc_map_year}">'
        )
        gis_script, gis_years = self._gis_data_scripts(
            [spec for spec, _ in loaded],
        )
        if gis_script:
            data_script = data_script + "\n" + gis_script
        embedding_sources = self._write_embeddings(loaded, loaded_art)
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

        # Snapshot loading already populated _effective_start. The client
        # derives calendar columns from burn_start + burn_end directly,
        # so no separate week-map tag is needed.
        html = (
            self._read_template()
            .replace("__DATA_SCRIPT__",        data_script)
            .replace("__SOURCES_META__",       sources_meta)
            .replace("__TIER_WRAPPERS_META__", wrappers_meta)
            .replace("__SYNC_META__",          sync_meta)
            .replace("__BUNDLE__",             bundle_js)
            .replace("__RELEASE_NOTES__",      notes_script)
            .replace("__VERSION__",            meta.get("version", "v0.0.0"))
            .replace("__FETCHED_DATE__",       meta.get("fetched_date", "unknown"))
            .replace("__FETCHED_AT__",         meta.get("fetched_at", "unknown"))
            .replace("__BURN_START__",         self._effective_start)
            .replace("__BURN_END__",           self.config.burn_end)
            .replace(
                "__LOCATION_RELEASE_YEAR__",
                str(self.config.brc_map_year),
            )
            .replace(
                "__CAMP_LOCATION_RELEASE_AT__",
                self.config.camp_location_release_at,
            )
            .replace(
                "__ART_LOCATION_RELEASE_AT__",
                self.config.art_location_release_at,
            )
            .replace("__HAS_EMBEDDINGS__", ",".join(embedding_sources))
        )

        self.config.site_html.parent.mkdir(parents=True, exist_ok=True)
        self.config.site_html.write_text(html, encoding="utf-8")

        # Dropbox requires an app-specific policy available to users. Keep it
        # outside the password-gated SPA and free of embedded source records.
        self._write_privacy_page()

        # Code-split semantic-search backend (ADR 21). Sits beside index.html;
        # the main bundle imports it lazily only on opt-in.
        self._copy_semantic_backend()

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
        print(f"  version: {meta.get('version', '?')} ({meta.get('fetched_date', '?')})")
        print(f"  GIS years: {', '.join(gis_years) if gis_years else 'none'}")
        art_by_source: dict[str, list[Art]] = {s: lst for s, lst in loaded_art}
        for spec, camps in loaded:
            total_events = sum(len(c.events) for c in camps)
            with_web = sum(1 for c in camps if c.website)
            tagged = sum(1 for c in camps if c.tags)
            food_events = sum(1 for c in camps for e in c.events if e.food_tags)
            food_camps = sum(1 for c in camps if any(e.food_tags for e in c.events))
            art_pieces = art_by_source.get(spec, [])
            art_tagged = sum(1 for a in art_pieces if a.tags)
            with_image = sum(1 for a in art_pieces if a.image_url)
            print(f"  [{spec}] {len(camps)} camps · {with_web} with website "
                  f"· {total_events} events · {tagged} tagged")
            food_pct = (100 * food_events // total_events) if total_events else 0
            print(f"  [{spec}] food: {food_events}/{total_events} events "
                  f"({food_pct}%) · {food_camps} camps offering food")
            print(f"  [{spec}] {len(art_pieces)} art · {with_image} with image "
                  f"· {art_tagged} tagged")
        print(f"  {size_kb:.1f} KB")
        return self.config.site_html
