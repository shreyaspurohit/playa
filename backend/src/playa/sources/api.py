"""api.burningman.org source.

Three bulk endpoints, all single-shot per year:
  GET /api/camp?year=YYYY     → list[CampModel]
  GET /api/event?year=YYYY    → list[EventModel]
  GET /api/art?year=YYYY      → list[ArtModel]

Auth: header `X-API-Key`. Spec at https://api.burningman.org/docs.

Caching strategy:
  * Fetched payloads land in `<root>/data/api/<year>.json` (gitignored).
  * When `BM_CACHE_PASSWORD` (or its `SITE_PASSWORD` fallback) is set
    at write time, the on-disk file is encrypted with AES-256-CBC +
    PBKDF2 via openssl — same algorithm as the deployed site, but in
    openssl's native binary "Salted__||salt||ciphertext" format
    (the cache is read back by Python, never by a browser, so we
    skip the JSON envelope).
  * `load_snapshot()` decrypts on read with the same key. If the file
    looks plaintext (legacy local dev), it falls through and parses
    as JSON.
  * The CI workflow (.github/workflows/refresh.yml) treats one cache file per
    year as a GitHub Release asset: push-triggered and ordinary manual builds
    require and download the encrypted blob; only an explicit refresh dispatch
    may replace it.

Schema mapping notes:
  * `Camp.id` ← `uid` (18-char SFDC). User state remains per annual source.
  * `Camp.location` ← `location_string` (e.g., "Esplanade & 6:30");
    the existing address parser handles this format.
  * Events come back flat with `hosted_by_camp` (camp uid). We group
    by uid and attach to the matching camp.
  * `EventOccurrenceModel.start_time` / `end_time` are ISO-8601 strings
    with timezone — we synthesize `parsed_time` directly. See
    `_events_from_api()` for the recurring-vs-single decision.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from ..config import Config
from ..models import Art, Camp, Event
from ..schedule import format_schedule_display
from . import SourceSnapshot


# Openssl produces files starting with this 8-byte literal when
# `-salt` is set; we use the prefix to distinguish encrypted caches
# from legacy plaintext caches written by older builds.
_OPENSSL_MAGIC = b"Salted__"


# Event occurrences are Black Rock City wall-clock data.  The API currently
# sends explicit Pacific offsets, but normalize every aware timestamp so a
# future UTC or other-offset response cannot move a late-night event to the
# wrong calendar day.
PLAYA_TIME_ZONE = ZoneInfo("America/Los_Angeles")


_DAY_BY_WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


class APISource:
    """Source for one API year. Re-instantiate per year."""

    def __init__(self, year: int):
        self.year = year
        self.name = f"api-{year}"

    # ---- public surface ------------------------------------------------

    def load_snapshot(self, config: Config) -> SourceSnapshot:
        """Read and normalize camps, events, art, and cache freshness once.

        The file may be either an openssl-encrypted blob (when
        BM_CACHE_PASSWORD or SITE_PASSWORD was set at fetch time) or
        legacy plaintext JSON. We sniff the magic bytes to pick the
        right path.
        """
        f = config.api_payload_file(self.year)
        if not f.exists():
            raise FileNotFoundError(
                f"no cached payload at {f}. Run "
                f"`playa api-fetch --year {self.year}` first."
            )
        blob = f.read_bytes()
        if blob.startswith(_OPENSSL_MAGIC):
            password = config.effective_cache_password
            if not password:
                raise RuntimeError(
                    f"{f} is encrypted but no cache password is set. "
                    "Set BM_CACHE_PASSWORD or SITE_PASSWORD."
                )
            blob = _openssl_decrypt(blob, password, config.pbkdf2_iter)
        raw = json.loads(blob.decode("utf-8"))
        camps_raw = raw.get("camps", [])
        events_raw = raw.get("events", [])
        art_raw = raw.get("art", [])
        fetched_at = raw.get("fetched_at")
        if not isinstance(fetched_at, str) or not fetched_at.strip():
            raise RuntimeError(f"API cache {f} has no valid fetched_at timestamp")

        # Group events by hosted_by_camp uid for O(1) attachment. The bulk
        # endpoint can repeat an EventModel verbatim (observed in the 2026
        # snapshot), so treat its stable uid as record identity. Do this
        # before normalization because one legitimate EventModel may expand
        # into several occurrence-specific Event records below.
        events_by_camp: dict[str, list[Event]] = {}
        events_seen: dict[str, dict[str, Any]] = {}
        duplicate_events = 0
        for ev_raw in events_raw:
            event_uid = ev_raw.get("uid")
            if event_uid:
                event_key = str(event_uid)
                previous = events_seen.get(event_key)
                if previous is not None:
                    if ev_raw != previous:
                        raise RuntimeError(
                            f"API cache {f} contains conflicting event records "
                            f"with uid {event_key!r}"
                        )
                    duplicate_events += 1
                    continue
                events_seen[event_key] = ev_raw
            camp_uid = ev_raw.get("hosted_by_camp")
            if not camp_uid:
                continue
            evs = _events_from_api(ev_raw, source_year=self.year)
            if not evs:
                continue
            events_by_camp.setdefault(camp_uid, []).extend(evs)
        if duplicate_events:
            print(
                f"  api-{self.year}: ignored {duplicate_events} repeated "
                "event record(s)"
            )

        denied = _load_denylist(config)
        skipped = 0
        camps: list[Camp] = []
        for c_raw in camps_raw:
            camp = _camp_from_api(c_raw)
            if not camp:
                continue
            if camp.id in denied:
                skipped += 1
                continue
            camp.events = events_by_camp.get(camp.id, [])
            camps.append(camp)
        if skipped:
            print(f"  (skipped {skipped} camp(s) per denylist-api)")
        denied = _load_art_api_denylist(config)
        skipped = 0
        art: list[Art] = []
        for a_raw in art_raw:
            piece = _art_from_api(a_raw, year=self.year)
            if not piece:
                continue
            if piece.id in denied:
                skipped += 1
                continue
            art.append(piece)
        if skipped:
            print(f"  (skipped {skipped} art piece(s) per denylist-art-api)")
        return SourceSnapshot(camps=camps, art=art, fetched_at=fetched_at)

    def fetch_and_cache(self, config: Config) -> dict:
        """Hit the API, persist the raw payload to disk, return it.

        Three bulk requests for camps, events, and art. Stops on first failure
        (no half-cached file). When `BM_CACHE_PASSWORD` (or its
        `SITE_PASSWORD` fallback) is set, the on-disk file is
        AES-256-CBC encrypted in openssl's native format so the cache
        can be uploaded to a public GitHub Release without leaking
        camp data.
        """
        if not config.bm_api_key:
            raise RuntimeError(
                "BM_API_KEY is unset; cannot fetch api.burningman.org. "
                "Set it in env or skip this source.",
            )
        if self.year < config.bm_api_year_min:
            raise ValueError(
                f"year {self.year} is below API minimum "
                f"{config.bm_api_year_min} (per OpenAPI spec).",
            )

        # 404 → empty list. Pre-burn current-year /api/event commonly
        # returns 404 with `{"detail": "Event not found"}` — events
        # haven't been published yet (Aug 9 release for camps, gates
        # for art). Treat as zero events instead of failing the build.
        # Same allowance for camps in case a year has none on file.
        camps = _request_json(
            config, "/api/camp", {"year": self.year},
            default_on_404=[],
        )
        events = _request_json(
            config, "/api/event", {"year": self.year},
            default_on_404=[],
        )
        # Art locations release at gate-open per ToS §6.2; the API
        # may also 404 pre-burn for current-year art (`{"detail":
        # "Art not found"}`). Treat as zero like camps/events.
        art = _request_json(
            config, "/api/art", {"year": self.year},
            default_on_404=[],
        )
        payload = {
            "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "year": self.year,
            "camps": camps,
            "events": events,
            "art": art,
        }
        config.api_dir.mkdir(parents=True, exist_ok=True)
        f = config.api_payload_file(self.year)
        plaintext = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        password = config.effective_cache_password
        if password:
            blob = _openssl_encrypt(plaintext, password, config.pbkdf2_iter)
            f.write_bytes(blob)
            mode = "encrypted"
        else:
            f.write_bytes(plaintext)
            mode = "plaintext"
        print(f"  api-{self.year}: wrote {len(camps)} camps + "
              f"{len(events)} events + {len(art)} art → {f} ({mode})")
        return payload


# --- HTTP -----------------------------------------------------------------

_NO_DEFAULT = object()


def _request_json(
    config: Config, path: str, params: dict[str, Any],
    *, default_on_404: Any = _NO_DEFAULT,
) -> Any:
    """GET path with X-API-Key header, retry on 429 + 5xx with backoff.

    Returns parsed JSON. Raises on persistent failure.

    `default_on_404`: when provided, a 404 response returns this value
    instead of raising. The API documents 404 as "no items found for
    the given filter" (per the OpenAPI spec) — this happens routinely
    for the current-year events endpoint pre-burn, where camps already
    exist but events haven't been published yet.

    Why curl instead of urllib: api.burningman.org throttles HTTP/1.1
    clients (urllib speaks 1.1 only) but fast-paths HTTP/2 clients
    like curl. Empirically curl returns in <1s where urllib hangs
    past 120s. Same shell-out model as openssl — curl ships on every
    real machine + CI runner.
    """
    if not shutil.which("curl"):
        raise RuntimeError(
            "curl not found on PATH — required for api.burningman.org. "
            "Install it via your package manager (apt/brew/etc.).",
        )

    url = config.bm_api_base_url.rstrip("/") + path
    if params:
        url = url + "?" + urllib.parse.urlencode(params)

    last_err: str = ""
    for attempt in range(config.bm_api_retries):
        # `-w "\n%{http_code}"` appends the status code on its own
        # line after the body. `--compressed` requests + transparently
        # decodes gzip. `--http2` upgrades the TLS connection if the
        # server supports it (most do; falls back to 1.1 cleanly).
        proc = subprocess.run(
            [
                "curl",
                "--silent", "--show-error",
                "--max-time", str(config.bm_api_timeout),
                "--compressed",
                "--http2",
                "-H", f"X-API-Key: {config.bm_api_key}",
                "-H", f"User-Agent: {config.bm_api_user_agent}",
                "-H", "Accept: application/json",
                "-w", "\n%{http_code}",
                url,
            ],
            capture_output=True, check=False,
        )

        if proc.returncode != 0:
            stderr = proc.stderr.decode("utf-8", "replace").strip()
            last_err = f"curl exit {proc.returncode}: {stderr}"
            wait = config.bm_api_backoff ** attempt
            print(f"  api: network error ({stderr}), retrying in {wait:.1f}s")
            time.sleep(wait)
            continue

        # Split body from the trailing status line.
        out = proc.stdout
        nl = out.rfind(b"\n")
        if nl < 0:
            raise RuntimeError(
                f"unexpected curl output (no status line): {out[:200]!r}"
            )
        body = out[:nl]
        try:
            status = int(out[nl + 1:].strip())
        except ValueError:
            raise RuntimeError(
                f"could not parse status from curl output: {out[nl + 1:]!r}"
            )

        if status == 200:
            return json.loads(body)
        if status == 429:
            wait = config.bm_api_backoff ** attempt
            print(f"  api: 429 rate limit, waiting {wait:.1f}s")
            time.sleep(wait)
            last_err = "HTTP 429"
            continue
        if 500 <= status < 600:
            wait = config.bm_api_backoff ** attempt
            print(f"  api: HTTP {status}, retrying in {wait:.1f}s")
            time.sleep(wait)
            last_err = f"HTTP {status}"
            continue
        # 4xx other than 429 — won't retry. 404 with a caller-provided
        # default returns that default (no items for this filter is
        # documented as a normal response). Anything else surfaces.
        if status == 404 and default_on_404 is not _NO_DEFAULT:
            return default_on_404
        snippet = body.decode("utf-8", "replace")[:500]
        raise RuntimeError(
            f"api request to {url} failed with HTTP {status}: {snippet}",
        )

    raise RuntimeError(
        f"api request to {url} failed after "
        f"{config.bm_api_retries} attempts: {last_err}",
    )


# --- mapping --------------------------------------------------------------

def _camp_from_api(d: dict[str, Any]) -> Camp | None:
    """API CampModel → Camp. Returns None for entries missing a uid."""
    uid = d.get("uid")
    if not uid:
        return None
    return Camp(
        id=str(uid),
        name=d.get("name", "") or "",
        location=d.get("location_string") or "",
        description=d.get("description") or "",
        website=d.get("url") or "",
        events=[],
        tags=[],
    )


def _art_from_api(d: dict[str, Any], *, year: int) -> Art | None:
    """API ArtModel → Art. Returns None for entries missing a uid.

    Image: take the first `images[].thumbnail_url` if present (API
    returns a list; we only display one for the card).
    """
    uid = d.get("uid")
    if not uid:
        return None
    images = d.get("images") or []
    image_url = ""
    if images and isinstance(images, list):
        first = images[0]
        if isinstance(first, dict):
            image_url = first.get("thumbnail_url") or ""
    return Art(
        id=str(uid),
        name=d.get("name", "") or "",
        location=d.get("location_string") or "",
        description=d.get("description") or "",
        artist=d.get("artist") or "",
        hometown=d.get("hometown") or "",
        category=d.get("category") or "",
        program=d.get("program") or "",
        image_url=image_url,
        year=year,
        tags=[],
    )


def _load_art_api_denylist(config: Config) -> set[str]:
    """Per-API-art denylist (parallel to denylist-api.txt for camps)."""
    f = config.art_api_denylist_file
    if not f.exists():
        return set()
    ids: set[str] = set()
    for line in f.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            ids.add(line)
    return ids


def _events_from_api(d: dict[str, Any], *, source_year: int) -> list[Event]:
    """API EventModel → list[Event].

    Coalescing rule:
      * If all occurrences share start_time + end_time of day (same
        HH:MM in America/Los_Angeles), produce ONE recurring
        Event covering each day.
      * Otherwise, produce one Event per occurrence.

    This matches the schedule view's existing `kind=recurring` semantics
    and keeps "star this event" working in the common case (same time
    every day) without forcing the user to star each occurrence.
    """
    uid = d.get("uid")
    if not uid:
        return []
    title = d.get("title") or ""
    desc = d.get("description") or ""
    occurrences = d.get("occurrence_set") or []
    if not occurrences:
        return []

    parsed = []
    for occ in occurrences:
        st = _parse_iso(occ.get("start_time"))
        et = _parse_iso(occ.get("end_time"))
        if st is None or et is None:
            continue
        # Annual source identity is a hard boundary. A stale tuple from a
        # different edition, or an occurrence whose end crosses New Year,
        # must never enter this source's schedule payload.
        if st.year != source_year or et.year != source_year:
            continue
        parsed.append((st, et))
    if not parsed:
        return []

    # All occurrences share the same time-of-day → one Event carrying the exact
    # list of occurrence dates (ADR 11). The client places it on precisely those
    # calendar days — no weekday fan-out — so every night of a multi-night event
    # is kept and no phantom weekday is invented.
    times_of_day = {
        (st.strftime("%H:%M"), et.strftime("%H:%M"))
        for st, et in parsed
    }
    if len(times_of_day) == 1:
        pt = _occ_parsed_time(parsed)
        st0, et0 = sorted(parsed, key=lambda p: p[0])[0]
        if len(pt["dates"]) == 1:
            time_str = _single_time_str(st0, et0)
        else:
            # `time` is the card/Ask fallback when the builder filters every
            # occurrence out of the reviewed annual window. It must therefore
            # retain the exact API occurrence bounds instead of collapsing to
            # an ambiguous weekday-only label such as "on Sun, Mon".
            time_str = format_schedule_display(pt)
            if time_str is None:
                raise RuntimeError(
                    "normalized recurring occurrence set has no displayable dates"
                )
        return [Event(
            id=str(uid),
            name=title,
            description=desc,
            time=time_str,
            display_time="",
            parsed_time=pt,
        )]

    # Mixed times → one Event per occurrence.
    out: list[Event] = []
    for i, (st, et) in enumerate(parsed):
        out.append(_single_event(uid, title, desc, st, et, idx=i))
    return out


def _iso_date(dt: datetime) -> str:
    return dt.date().isoformat()


def _single_time_str(st: datetime, et: datetime) -> str:
    """Dated raw-fallback text, shown only when an event has no in-window date."""
    start_day = _day_abbrev(st)
    end_day = _day_abbrev(et)
    return (
        f"Begins {start_day} ({st.strftime('%-m/%-d')}) at "
        f"{st.strftime('%I:%M %p').lstrip('0')}, "
        f"Ends "
        + (f"{end_day} at " if end_day != start_day else "")
        + et.strftime('%I:%M %p').lstrip('0')
    )


def _occ_parsed_time(pairs: list[tuple[datetime, datetime]]) -> dict:
    """Structured schedule form from same-time-of-day occurrences (ADR 11).

    Carries the exact occurrence start dates (`dates`, ``YYYY-MM-DD``) so the
    client places the event on the literal days it happens — no weekday fan-out.
    `overnight` marks occurrences whose end crosses midnight (the client shows
    the end on the next day). `days` is retained only for the display label.
    """
    ordered = sorted(pairs, key=lambda p: p[0])
    st0, et0 = ordered[0]
    overnight = any(_day_abbrev(st) != _day_abbrev(et) for st, et in ordered)
    dates: list[str] = []
    seen_d: set[str] = set()
    days: list[str] = []
    seen_wd: set[str] = set()
    for st, _ in ordered:
        key = _iso_date(st)
        if key not in seen_d:
            seen_d.add(key)
            dates.append(key)
        wd = _day_abbrev(st)
        if wd not in seen_wd:
            seen_wd.add(wd)
            days.append(wd)
    return {
        "kind": "single" if len(dates) == 1 else "recurring",
        "dates": dates,
        "days": days,
        "start_time": st0.strftime("%H:%M"),
        "end_time": et0.strftime("%H:%M"),
        "overnight": overnight,
    }


def _single_event(
    uid: str, title: str, desc: str,
    st: datetime, et: datetime, idx: int,
) -> Event:
    """Build a single-occurrence Event. `idx` disambiguates ids when
    one EventModel produces multiple Events."""
    eid = str(uid) if idx == 0 else f"{uid}#{idx}"
    return Event(
        id=eid,
        name=title,
        description=desc,
        time=_single_time_str(st, et),
        display_time="",
        parsed_time=_occ_parsed_time([(st, et)]),
    )


def _parse_iso(s: str | None) -> datetime | None:
    if not isinstance(s, str) or not s.strip():
        return None
    try:
        # Python 3.11+ accepts 'Z' suffix; strip just in case for older.
        parsed = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    # Never let the runner's own timezone assign meaning to a naive API value.
    # Dropping it is safer than manufacturing a date; normalization coverage is
    # reported by the build so a broad upstream schema regression stays visible.
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(PLAYA_TIME_ZONE)


def _day_abbrev(dt: datetime) -> str:
    return _DAY_BY_WEEKDAY[dt.weekday()]


# --- encryption (cache asset) ---------------------------------------------

def _openssl_encrypt(plaintext: bytes, password: str, iters: int) -> bytes:
    """Native openssl `enc -aes-256-cbc -salt -pbkdf2 -iter N` output.

    Format: `Salted__` (8 bytes) + salt (8 bytes) + ciphertext.
    Decrypt with the matching `enc -d` invocation. Same algorithm
    family + iteration count as the deployed-site encryption (so a
    machine that can decrypt the live site can also decrypt the
    cache, given the right password).
    """
    proc = subprocess.run(
        [
            "openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2",
            "-iter", str(iters),
            "-pass", f"pass:{password}",
        ],
        input=plaintext, capture_output=True, check=True,
    )
    return proc.stdout


def _openssl_decrypt(blob: bytes, password: str, iters: int) -> bytes:
    """Reverse of `_openssl_encrypt`. Raises RuntimeError on bad
    password (openssl exits non-zero with its bad-decrypt message)."""
    proc = subprocess.run(
        [
            "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2",
            "-iter", str(iters),
            "-pass", f"pass:{password}",
        ],
        input=blob, capture_output=True, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "cache decrypt failed — wrong BM_CACHE_PASSWORD? "
            f"openssl stderr: {proc.stderr.decode('utf-8', 'replace').strip()}"
        )
    return proc.stdout


# --- denylist -------------------------------------------------------------

def _load_denylist(config: Config) -> set[str]:
    """Read data/denylist-api.txt, ignoring comments and blank lines."""
    if not config.api_denylist_file.exists():
        return set()
    ids: set[str] = set()
    for line in config.api_denylist_file.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            ids.add(line)
    return ids
