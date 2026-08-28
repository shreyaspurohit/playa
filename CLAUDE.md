# bm-camps

`AGENTS.md` is a symlink to this file. Keep one source of truth: edit
`CLAUDE.md`, never replace the symlink. These instructions are shared by human
contributors and coding assistants. Prefer focused changes and preserve
accurate operational knowledge.

API-snapshot-backed static PWA for Burning Man camps, events, art, food,
schedule, map, journal, and opt-in on-device semantic search. The deployed app
at `playa.purohit.dev` is password-gated for personal/friends use, not intended
as a general-public service.

## Architecture documents

Read the relevant decision document before planning a non-trivial change.

- `docs/00-index.md` — index and ADR template
- `docs/01-overview.md` — system overview
- `docs/02-tech-stack.md` — Python, Preact, esbuild, Actions, Renovate
- `docs/03-build-pipeline.md` — cached API snapshot to encrypted PWA
- `docs/04-data-encryption.md` — PBKDF2 + AES-CBC payloads
- `docs/05-password-management.md` — gate and AES-GCM browser wrapping
- `docs/06-multi-tab-sync.md` — storage events + BroadcastChannel
- `docs/07-offline-pwa.md` — worker, install, and offline behavior
- `docs/08-versioning-and-release-notes.md` — version polling and `rn:` commits
- `docs/09-share-and-import.md` — API-tagged shares and JSON snapshots
- `docs/10-map-system.md` — SVG BRC grid, annual GIS, GPS, zoom/pan
- `docs/11-schedule-system.md` — event time normalization and calendar
- `docs/12-deployment-and-ci.md` — Actions, Pages, Cloudflare
- `docs/13-tos-compliance.md` — API/GIS terms obligations
- `docs/14-refresh-cycle.md` — refresh and service-worker interaction
- `docs/15-data-sources.md` — annual `api-YYYY` snapshots and tiers
- `docs/16-cloud-sync.md` — optional Dropbox App-folder backup
- `docs/17-food-tab.md` — food classification and availability
- `docs/18-mobile-scroll-chrome.md` — mobile header/control behavior
- `docs/19-food-classification-audit.md` — local Ollama semantic audit
- `docs/20-journal.md` — offline year-owned journal
- `docs/21-on-device-assistant.md` — opt-in on-device semantic search
- `docs/22-tag-taxonomy-audit.md` — local Ollama tag-taxonomy audit
- `docs/23-tab-counts.md` — per-tab saved-item count badges
- `docs/revocation-plan.md` — Event Data shutdown and destruction runbook
- `docs/dev/client-architecture.md` — compact client reference
- `docs/dev/site-ui.md` — UI/embed reference
- `docs/dev/mobile-visual-testing.md` — safe 390×844 visual review
- `docs/dev/annual-map-update.md` — yearly map/source release checklist
- `docs/dev/on-device-model-hosting.md` — R2-hosted model/runtime provenance
- `docs/roadmap.md` — future ideas, not current architecture

Add a new ADR and index entry when a subsystem gains durable design decisions.

## Public code, private Event Data

The repository is public. Event Data and derived content are not committed:

- `data/api/YYYY.json` — annual API snapshot, plaintext or encrypted locally
- `data/gis/` — downloaded official annual GIS inputs and normalized payloads
- `data/embeddings/` — semantic working data and content-hash cache
- `site/index.html`, `site/embeddings-*.json`, `site/semantic-backend.js`
- generated `site/privacy.html`, `site/sw.js`, and `site/version.txt`

CI restores encrypted annual snapshots from GitHub Releases, builds on an
ephemeral runner, uploads a Pages artifact, and leaves no Event Data in git.
Committed site files are source-independent shell/config assets such as CNAME,
robots, manifest, icons, and `.nojekyll`.

## Terms and product constraints

The controlling terms are at
<https://innovate.burningman.org/terms-of-service-for-burning-man-apis-and-datasets/>.
Review them annually and update `docs/13-tos-compliance.md`.

Never weaken these invariants:

- The app is free and non-commercial: no ads, paid access, promotion, commercial
  branding, accounts, or application tracking.
- The exact sentence “This app is not affiliated, endorsed, or verified by
  Burning Man Project.” renders prominently for every source.
- `BM_API_KEY` stays server-side, secret, app-specific, and out of logs/client
  artifacts.
- Source descriptions/event text are not rewritten. App-generated tags, food
  classifications, and formatted times are disclosed as transformations.
- Current-year API locations remain encrypted for later reveal. Normal tiers
  follow separate camp/art release timestamps; only trusted `god-mode` wrappers
  may bypass the mask for internal testing. Do not broaden that exception.
- The app explains GPS permission and on-device use.
- If access is terminated, stop refresh/deploy, remove Event Data from the live
  site, delete Releases/artifacts/derived caches, and destroy local copies. Do
  not preserve a last-good data deployment.

The user-facing freshness text says the app uses an official API snapshot that
may be stale or incomplete and that critical details should be checked against
current official Burning Man communications. Individual records have no
upstream API links.

## Source architecture

The only source identifier is `api-YYYY`. A build requires explicit `--sources`
or nonempty `BM_API_YEARS`, and the set must contain `BRC_MAP_YEAR`. Resolution
is `api-BRC_MAP_YEAR` first, then remaining years newest-first. Missing
configured snapshots, invalid tier source names, or an absent current year fail
the build.

`APISource.load_snapshot()` decrypts/parses once and returns camps (with nested
events), art, and `fetched_at`. The primary cache timestamp drives visible
“Updated”; build time independently creates `vYYYY.MM.DD.HHMM` for worker/update
versioning. `MIN_CAMPS` applies to the primary current-year API snapshot.

State is scoped by source. Preserve existing `api-2026` localStorage and Dropbox
keys exactly. Do not map unsupported namespaces or unrelated record IDs. New
share links always carry `api-YYYY`; source-less links are rejected. Snapshot
export/import helpers require an explicit source.

## Build pipeline

The client (TypeScript + Preact + htm) lives in `client/` and is bundled by
esbuild. Python under `backend/src/playa/` normalizes cached API data, adds tags
and formatted times, encrypts/embeds payloads, and emits the site.

```text
npm run build                         -> client/dist/bundle.js
                                        client/dist/semantic-backend.js
python -m playa api-fetch --year YYYY -> data/api/YYYY.json
python -m playa gis-fetch [options]   -> data/gis/YYYY/normalized.json
python -m playa map-audit ...         -> read-only annual geometry report
python -m playa food-audit            -> aggregate classification report
python -m playa build                 -> generated site from cached snapshots
python -m playa all                   -> best-effort GIS refresh + cached build
```

`all` never fetches Event Data. API refresh is explicit through `make fetch-api`
or the Actions `refresh_api_years` dispatch input. Scheduled builds reuse
encrypted Release snapshots and fail on a miss.

`make fetch`, `make rebuild`, `make build`, and `make dev` bundle the client and
enable semantic embedding generation. Tests call the builder directly with
embedding generation off.

## Client dependencies and splitting

- Preact + htm form the main client.
- The exact-pinned Dropbox SDK supports optional App-folder OAuth/transport and
  makes no request without sync metadata.
- `@khmyznikov/pwa-install` is imported lazily from the UI but remains folded
  into the single IIFE build.
- `@huggingface/transformers` and `@orama/orama` power opt-in semantic search.
  They are a second ESM entry point (`semantic-backend.js`) and never enter the
  main bundle. `onnxruntime-node` and `sharp` are externalized.
- per-source `site/embeddings-<source>.json` indexes are fetched only after
  opt-in, one per year viewed, and are not shell-precached.

The service worker has a versioned shell cache, `playa-img-v2`, and
`playa-ask-v3`. Activation prunes every older `playa-` namespace (old shells,
pre-v3 image/Ask caches, incl. the pre-split single `embeddings.json`) while
preserving the source-independent `transformers-cache`.

## Python package layout

- `config.py` — `Config`, paths, environment validation
- `models.py` — Camp, Event, Art dataclasses
- `sources/__init__.py` — strict registry + `SourceSnapshot`
- `sources/api.py` — API client, retry policy, cache encryption/load/normalizing
- `gis.py` — official annual GIS fetch, allowlist, validation, atomic cache
- `mapaudit.py` — read-only base-grid candidate report
- `tagger.py` — camp/art/food taxonomies and classifiers
- `schedule.py` — reviewed annual event windows and occurrence display
- `foodreview.py` — local, loopback-only semantic food audit
- `builder.py` — source load, tiers, encryption, HTML/worker/privacy generation
- `templates/site.html`, `templates/privacy.html` — build templates
- `cli.py`, `__main__.py` — command entry points

The package uses strict src layout. Run `pip install -e ./backend` (or
`make bootstrap`) before importing it from a fresh clone.

## Build-time configuration

| Variable | Default | Purpose |
|---|---:|---|
| `SITE_PASSWORD` | unset | single-tier payload encryption |
| `ALLOW_PLAINTEXT_BUILD` | `0` | explicit local-only plaintext site opt-in; never set in CI |
| `PBKDF2_ITER` | `200000` | payload/cache PBKDF2 work factor |
| `BM_API_KEY` | unset | required only for explicit `api-fetch` |
| `BM_API_BASE_URL` | official API | testing/staging override |
| `BM_API_TIMEOUT` | `120` | bulk API request timeout |
| `BM_API_RETRIES` | `3` | API retry count |
| `BM_API_BACKOFF` | `1.5` | exponential retry base seconds |
| `BM_API_YEARS` | unset | required comma-separated annual sources |
| `BM_CACHE_PASSWORD` | `SITE_PASSWORD` | annual cache encryption/decryption |
| `BRC_MAP_YEAR` | required | explicit current API/GIS/burn year; no fallback |
| `BM_GIS_BASE_URL` | official GIS repo | test override |
| `BM_GIS_TIMEOUT` | `30` | GIS request timeout |
| `MIN_CAMPS` | `500` | current-year primary safety rail; use `0` only for fixtures |
| `SITE_TIERS` | unset | named tier password/source manifest |
| `BURN_OPEN` | `0` | spirit wrapper auto-unlock flag, resolved from the SITE_UNLOCK window at build time |
| `SITE_UNLOCK_START/END` | unset | password-free spirit access window, evaluated at build time |
| `CAMP_LOCATION_RELEASE_AT` | required for current year | camp disclosure instant |
| `ART_LOCATION_RELEASE_AT` | required for current year | art disclosure instant |
| `SYNC_PROVIDER` | unset | set `dropbox` to emit sync UI |
| `SYNC_CLIENT_ID` | unset | public Dropbox PKCE app key |
| `BM_EMBEDDINGS` | `0` | generate Ask vectors when `1` |

`SITE_TIERS` format is
`name:password=api-YYYY+api-YYYY,name:password=api-YYYY`. Conventional roles:

- `god-mode`: every configured API year, trusted location reveal
- `demigod-mode`: every configured API year, normal embargo
- `spirit-mode`: only `api-BRC_MAP_YEAR`, normal embargo

Tier names are required; the three names above are reserved by the client/build
policy. Any unregistered source fails the build.

## Local commands

```bash
make bootstrap
make test
BM_API_KEY=... make fetch-api YEAR=2026
BRC_MAP_YEAR=2026 BM_API_YEARS=2026 make rebuild
make preview
make review-mobile
```

Local development keeps the same encryption vars as production in `.env`
(`SITE_PASSWORD`/`SITE_TIERS`, plus `BM_CACHE_PASSWORD`), so local builds are
encrypted like prod. An intentional quick plaintext preview requires the
explicit local-only `ALLOW_PLAINTEXT_BUILD=1`; a missing password alone fails
closed. `make review-mobile` uses that opt-in only for its temporary capture,
then verifies the restored build is encrypted and fails on a plaintext restore.
Treat generated HTML and screenshots as private Event Data regardless. `make
clean` removes generated embeddings/site/client artifacts but preserves
`data/api/` and `data/gis/`.

## Project layout

```text
backend/src/playa/       Python package
backend/tests/           Python unit/integration tests
client/src/              TypeScript/Preact client
client/tests/            node:test + happy-dom tests
client/scripts/          semantic embedding tooling
data/api/                gitignored annual snapshots
data/gis/                gitignored official GIS cache
site/                    committed shell assets + generated deploy artifacts
scripts/                 mobile review and operator helpers
.github/workflows/       CI and Pages deployment
.claude/skills/          annual tag/map maintenance workflows
docs/                    architecture decisions and runbooks
```

## GitHub Actions

`.github/workflows/ci.yml` validates pull requests. A merge or direct push to
`main` runs `.github/workflows/refresh.yml`; an operator may also dispatch it
manually to refresh selected API years or control spirit unlock. In that
workflow `test` gates `build`, and `deploy` consumes the generated Pages
artifact. The runner versions come from `.tool-versions` (Python 3.14.4, Node
26.7.0). `openssl`, `bash`, and `gh` are available on `ubuntu-latest`; Python
runtime code is stdlib-only.

A lightweight daily Actions trigger checks the repository
`SITE_UNLOCK_START/END` variables in Playa time and runs the full deployment
only on those two boundary dates. The window is half-open: START is the first
password-free date and END is the first re-locked date. Local `.env` values do
not affect CI. Pushes and manual dispatches resolve the same window; the
`SITE_UNLOCK_START/END` variables are the single source of truth with no
one-off operator override. Client-side location-release
timestamps and schedule time logic do not require a rebuild. GitHub may disable
scheduled workflows after 60 days without public-repository activity, so verify
the deploy workflow remains enabled before a long-dormant boundary.

The GIS Actions cache is exact-revision and year-set keyed. The semantic cache
namespace is `ask-embeddings-v2` and stores only content-hash vectors. Never
restore a pre-cutover mixed-source semantic cache.

Before production deployment, verify the repository `SITE_TIERS` secret contains
only configured `api-YYYY` sources. Password values cannot be retrieved from
GitHub; an operator must replace the secret if its manifest is obsolete.

## UI and state invariants

- Camps, events, art, map results, food, and schedule render no upstream record
  links. Camp-owned `website` remains an ordinary optional external link.
- `bm-sources` is API-only and current-year-first.
- `bm-brc-map-year` supplies current burn/journal defaults; annual source names
  determine source-specific map years.
- Spirit exposes only current year. Demigod/god expose every configured year.
- Normal tiers mask current-year camp/art locations until their independent
  release instants; trusted god does not.
- Footer/About preserve mandatory affiliation, non-commercial, privacy, GPS,
  transformation, freshness, and location-release copy.
- The app itself sets no cookies or tracking scripts. GitHub Pages and
  Cloudflare process ordinary request metadata and can expose aggregate traffic
  statistics; user-facing copy must not claim flat anonymity/no analytics.
- Dropbox is opt-in, App-folder scoped, PKCE-based, and local-first. Journal data
  remains year-owned and independent from record-source availability.

## Tag and food maintenance

`TAGS` and `FOOD_TYPES` live in `backend/src/playa/tagger.py`. Patterns are
case-insensitive; use bounded regexes to prevent substring false positives.
Camp tags consider camp plus event text; food tags distinguish event offerings
from camp-prose fallback.

For a structured taxonomy audit use `.claude/skills/update-tags/SKILL.md`:
baseline aggregate coverage, inspect thinly tagged records locally, cluster and
validate bounded patterns, present an aggregate proposal, wait for approval,
then edit/test/rebuild. Never emit source records into chat or logs.

`make food-review` is operator-only and must remain loopback Ollama-only. Its
reports/checkpoints live outside the repo and contain advisory IDs, not copied
source text. Reviewed API-year decisions remain tracked as
`data/food-exclusions-api-YYYY.txt`; directory-scoped exclusion files are not
supported.

## Annual map update

Follow `docs/dev/annual-map-update.md` and `.claude/skills/update-map/SKILL.md`.
Use official current-year measurements/GIS, preserve reviewed stable POI IDs,
validate polygons/holes, and never copy last year's geometry as a production
estimate. Exact-year unavailability is acceptable and should disable only
geometry-dependent controls.

## Testing and acceptance

```bash
make test-py
make test-js
cd client && npm run typecheck && npm run build
BRC_MAP_YEAR=2026 BM_API_YEARS=2026 make rebuild
node --check site/sw.js
git diff --check
```

Backend coverage must include API loading/retries, cached freshness, source
ordering/validation, missing snapshots, `MIN_CAMPS`, tier manifests, trusted
embargo bypass, and service-worker cache eviction. Client coverage must include
annual fallback/switching, API share round-trips, source-less rejection, no
external record links, and exact preservation of `api-2026` state.

Inspect generated HTML for source order, tier exposure, location masking,
cached freshness, and absence of unsupported payload IDs/metadata/copy. Run a
repository scan for removed fetch commands, HTML parser symbols, old page-cache
paths, old environment knobs, and obsolete source identifiers. Ordinary terms
such as GitHub Pages or a filesystem working folder are not legacy-source hits.

## Destructive/data operations

Preserve `data/api/` and `data/gis/` during normal cleanup. Generated site,
embedding, page-review, screenshot, and browser-profile artifacts may contain
private data and should be deleted after use. For a terms termination, follow
`docs/revocation-plan.md`; that explicit runbook overrides normal cache
preservation.

Public git history is not rewritten for this cutover. Offline devices can keep
an older encrypted worker cache until they reconnect; the new worker deletes
the prior data-bearing cache namespaces on activation.
