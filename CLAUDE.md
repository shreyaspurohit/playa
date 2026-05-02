# bm-camps

Directory fetcher + single-file static site for the Burning Man theme-camp directory
(`https://directory.burningman.org/camps/`). Goal: public-code, private-data
GitHub Pages deploy with password gate at `playa.purohit.dev`, for
personal/friends use only — **not** a general-public site. See "ToS risk +
mitigations" below for the reasoning.

## Architecture docs

System-decisions docs live in `docs/`. Read these before planning any
non-trivial change so the why-it-works-this-way isn't re-derived from
code each time. Always cross-check against the relevant doc when a
change touches one of these subsystems.

- [`docs/00-index.md`](docs/00-index.md) — table of contents + template
- [`docs/01-overview.md`](docs/01-overview.md) — system overview
- [`docs/02-tech-stack.md`](docs/02-tech-stack.md) — Preact, Python, esbuild, GH Actions, Renovate
- [`docs/03-build-pipeline.md`](docs/03-build-pipeline.md) — fetch → tag → bundle → encrypt → embed
- [`docs/04-data-encryption.md`](docs/04-data-encryption.md) — PBKDF2 + AES-CBC for camp data
- [`docs/05-password-management.md`](docs/05-password-management.md) — Gate + AES-GCM wrapping in IndexedDB
- [`docs/06-multi-tab-sync.md`](docs/06-multi-tab-sync.md) — `storage` events + BroadcastChannel
- [`docs/07-offline-pwa.md`](docs/07-offline-pwa.md) — service worker + install + manifest
- [`docs/08-versioning-and-release-notes.md`](docs/08-versioning-and-release-notes.md) — `vYYYY.MM.DD.HHMM`, polling, `rn:` commits
- [`docs/09-share-and-import.md`](docs/09-share-and-import.md) — share links + JSON snapshots + self-recognition
- [`docs/10-map-system.md`](docs/10-map-system.md) — SVG BRC grid, GPS, zoom/pan
- [`docs/11-schedule-system.md`](docs/11-schedule-system.md) — event time parsing + calendar
- [`docs/12-deployment-and-ci.md`](docs/12-deployment-and-ci.md) — GH Actions, Pages, custom domain
- [`docs/13-tos-compliance.md`](docs/13-tos-compliance.md) — directory + Innovate API stance
- [`docs/14-refresh-cycle.md`](docs/14-refresh-cycle.md) — refresh / force-refresh paths + SW interaction
- [`docs/15-data-sources.md`](docs/15-data-sources.md) — multi-source architecture (directory + `api.burningman.org`), per-source state, normalization
- [`docs/revocation-plan.md`](docs/revocation-plan.md) — operational runbook for takedowns

When adding a new subsystem worth of decisions, follow the template in
`docs/00-index.md` and add a row to its index + a bullet here.

## Public repo, private data

**The repo is public. The fetched camp data is not in the repo.** This is
the core architectural decision — see `.gitignore` for the list of paths
that are never committed:

- `data/pages/*.json` — raw fetched per-camp payloads (owned by camps per §6)
- `data/meta.json`, `data/camps.csv`, `data/camps_tagged.csv` — derived
- `site/index.html` — the compiled site (even encrypted, keeps it out of
  GitHub code search and permanent git history)

Every CI run fetches fresh on the ephemeral GH Actions runner, builds the
site from scratch, uploads it as a Pages artifact, and the runner
evaporates. Nothing camp-specific ever hits git.

Committed: scripts, tests, workflow, `Makefile`, `CLAUDE.md`, `LICENSE`,
`data/denylist.txt` (just IDs, no text), `site/CNAME`, `site/robots.txt`,
`site/.nojekyll`.

## ToS risk + mitigations

Reviewed 2026-04-22. The directory's
[Terms of Service](https://directory.burningman.org/about/terms/) has three
relevant clauses:

1. **§5 — Non-Commercial Use:** *"The Playa Info Directory is for the
   personal use of individual users only and may not be used in connection
   with any commercial endeavors. Organizations, companies, and/or
   businesses may not become users and may not use the Playa Info Directory
   for any purpose."*
2. **§6 — Proprietary Rights:** Camp descriptions are copyrighted by the
   camps themselves, not Burning Man — Burning Man only has a service-
   provision license. Republishing camp text is a rights-holder question
   per-camp.
3. **§7(d) — Prohibited Activities:** *"…unauthorized framing of or linking
   to the Playa Info Directory will be investigated…"*

The Privacy Policy and Community Guidelines do not add anything relevant.
None of the three explicitly prohibits fetching or automated access.

Mitigations baked into this project (so we can point to them if challenged):

- **Public code, private data.** The repo is public for portability / as a
  portfolio piece, but `.gitignore` keeps every byte of fetched camp
  content out of git and out of GitHub code search. The live site is the
  *only* place the data exists in reachable form, and it's password-gated.
- **Password gate.** If `SITE_PASSWORD` is set at build time the JSON data
  payload is AES-256-CBC encrypted (PBKDF2-HMAC-SHA256, default 200k iter)
  via `openssl`, decrypted in the browser via Web Crypto. Narrows the
  audience to friends, keeps crawlers out even if noindex is ignored.
- **`noindex, nofollow, noarchive`** meta tag + `site/robots.txt` blocking
  all crawlers. Reduces discovery surface.
- **Attribution + disclaimer** in the site footer and the about modal
  ("Built for Burners, not commercial" badge, explicit attribution to
  directory.burningman.org, no-affiliation note).
- **Canonical link per camp card** pointing back to the official directory
  page for that camp, so there's a clear path to the authoritative copy.
- **Takedown workflow.** Footer / about-modal mailto opens a pre-filled
  request to `CONTACT_EMAIL`. Reported camp IDs get appended to
  `data/denylist.txt` and are filtered out at the next fetch+build. Since
  raw data isn't committed, takedowns are genuine removals (no git
  history to unwind). Reversing a takedown is removing the id from
  `denylist.txt`.
- **No ads, no analytics, no monetization.** Keeps the "commercial
  endeavor" clause from applying.

**Remaining residual risk:** §6 still applies to every camp's description
text as it exists in the live site. This is mitigated (password-gated,
non-indexed, takedown available, not in the public code repo) but not
eliminated. If Burning Man or a specific camp objects, fulfill the
takedown and move on. Don't push back against a removal request.

## Pipeline

Two-stage build. The **client** (TypeScript + Preact + htm) lives in
`client/` and is bundled by esbuild into one minified IIFE.
The **server-side fetcher/builder** (Python) pulls the directory,
assembles the HTML template, and injects the bundle + data payload.

```
npm run build             → client/dist/bundle.js   (~34 KB minified)
python -m playa fetch <N>   → data/pages/page_NN.json
python -m playa fetch-all   → all 30 pages in parallel (ThreadPoolExecutor)
python -m playa meta         → data/meta.json
python -m playa merge        → data/camps.csv
python -m playa tag          → data/camps_tagged.csv
python -m playa build        → site/index.html            (injects bundle)
python -m playa all          → nightly pipeline (bundle must already exist)
```

`make fetch`, `make rebuild`, `make build` all include the bundle step
as a dependency, so you don't need to think about it day to day.

**Python side:** stdlib only + `openssl` CLI for the encrypted payload.
**Client side:** `preact` at runtime; `esbuild`, `typescript`, `tsx`,
`happy-dom` as dev deps. Lives at the repo root in `client/`, sibling
of `playa/` — not nested, because it's an npm/TS project, not a
Python module. Dev deps restored via `npm ci`.

## Package layout (`backend/src/playa/`)

- `config.py` — `Config` dataclass. Single source of truth for paths
  (derived from `root`) + env-tunable knobs (SITE_PASSWORD, PAGES,
  PARALLEL, PBKDF2_ITER, CONTACT_EMAIL). Tests construct a `Config`
  with `root=tmp_path`; production uses `Config.from_env()`.
- `models.py` — `Camp` and `Event` dataclasses with `to_dict()` /
  `from_dict()`. Replaces the stringly-typed dicts we used to pass around.
- `parsers.py` — `ListingParser` and `DetailParser`. Stateless classes,
  each namespaces its regexes next to the `parse()` classmethod. Also
  exposes `_clean()` helper (HTML entity decode + tag strip + whitespace
  collapse).
- `fetcher.py` — `Fetcher(config)`. Only class that touches the network.
  `fetch()` with retries + backoff, `fetch_page()` / `fetch_page_to_file()`.
- `tagger.py` — `TAGS` dict (taxonomy of ~120 tags) + `Tagger(taxonomy)`
  class. `tag(text)`, `tag_camp(camp)`, `haystack(camp)` helpers.
- `timeparser.py` — normalizes raw event time strings into a structured
  parse + a clean display line. Pure functions only (no class). See the
  dedicated "Event time parsing" section below.
- `meta.py` — `write_meta(config)` function (no class — one-shot op).
- `merger.py` — `merge_csv(config)` function + `write_tagged_csv` helper.
- `builder.py` — `SiteBuilder(config, tagger)`. `load_camps()`,
  `load_denylist()`, `load_meta()`, `encrypt_payload()`, `build()`.
  Reads the HTML template from `templates/site.html`.
- `templates/site.html` — the full HTML + CSS + JS with placeholder
  tokens (`__DATA_SCRIPT__`, `__CONTACT_EMAIL__`, `__VERSION__`, etc.).
  Kept as a real .html file rather than a Python string for syntax
  highlighting + readability.
- `cli.py` — argparse entry point. Each `cmd_*()` function drives one
  subcommand; `cmd_all()` stitches them together for nightly runs.
- `__main__.py` — enables `python -m playa`.

Classes are used where state + behavior cohere (`Fetcher` holds
Config+HTTP settings, `Tagger` holds compiled regexes, `SiteBuilder`
holds template + config). `write_meta` / `merge_csv` are plain functions —
wrapping them in classes would have been pure ceremony.

## Build-time config (env vars)

| Var                  | Default                       | Effect                                                                                           |
|----------------------|-------------------------------|--------------------------------------------------------------------------------------------------|
| `SITE_PASSWORD`      | *(unset)*                     | If set, encrypt the deployed JSON payload at build time                                          |
| `CONTACT_EMAIL`      | `bm-camps@example.com`        | Address used in footer `mailto:` takedown link                                                   |
| `PBKDF2_ITER`        | `200000`                      | PBKDF2 iteration count (used for both site + cache encryption)                                   |
| `PAGES`              | `30`                          | Listing pages to fetch (used by `fetch_all.sh`)                                                  |
| `PARALLEL`           | `5`                           | Parallelism for fetch (used by `fetch_all.sh`)                                                   |
| `BM_API_KEY`         | *(unset)*                     | api.burningman.org access key — required by `playa api-fetch` and the CI cache-fetch step        |
| `BM_API_BASE_URL`    | `https://api.burningman.org`  | Override the API base (testing / staging only)                                                   |
| `BM_API_YEARS`       | *(unset)*                     | Comma-separated years (`2024,2025`) — auto-derives `--sources directory,api-2024,api-2025`       |
| `BM_CACHE_PASSWORD`  | falls back to `SITE_PASSWORD` | Password used to AES-256-CBC encrypt API cache assets uploaded to GitHub Releases                |
| `SITE_TIERS`         | *(unset)*                     | Multi-tier access. Format: `name1:pw1=src1+src2,name2:pw2=src3,…`. Each tier (name + password) unlocks its source list via per-source envelope encryption. Tier names required — `spirit-mode` is the reserved name D13 looks up for burn-key.json; `god-mode` is the reserved name D8 looks up to flag wrappers as trusted (location-embargo bypass). Conventional shape: `god-mode:$GOD_PW=directory+api-2025+api-2026,demigod-mode:$DEMIGOD_PW=api-2025+api-2026,spirit-mode:$SPIRIT_PW=api-2026`. Unset → falls through to single-tier `SITE_PASSWORD`. See ADR D10. |
| `BURN_OPEN`          | `0` / unset                   | `workflow_dispatch` override for D13 burn-window auto-unlock. When `1`, deploys `site/burn-key.json` alongside `index.html` so the client auto-unlocks `spirit-mode` without a password. `god-mode` / `demigod-mode` stay password-gated. |
| `BURN_WINDOW_OPEN_FROM` / `BURN_WINDOW_OPEN_TO` | unset | Repo *variables* (Settings → Secrets and variables → Actions → Variables). ISO dates. When both set, the nightly cron evaluates today-in-window and auto-includes / auto-removes `burn-key.json` — set-once-forget, no manual flip per burn. Manual `BURN_OPEN` input always wins. See ADR D13. |
| `PLAYA_GO_LIVE`      | unset / `false`               | Repo *variable* (truthy/falsy). Forces `BURN_OPEN=1` on builds whose date is BEFORE `BURN_WINDOW_OPEN_FROM` so spirit-mode auto-unlocks ahead of the burn week (e.g., for early stress-testing or operator preview). Past `BURN_WINDOW_OPEN_TO` the flag is ignored — the deploy closes regardless. Manual `workflow_dispatch` `burn_open` input still wins over this. |

Local dev: leave `SITE_PASSWORD` unset to produce a plaintext build for
quick preview. CI sets both via repo secrets. The API source caches are
held as encrypted Release assets — see `docs/15-data-sources.md`
decision D7. To wire CI for API sources:
1. Repo secret: `BM_API_KEY`.
2. Repo secret: `BM_CACHE_PASSWORD` (or rely on `SITE_PASSWORD` fallback).
3. Repo *variable* (Settings → Secrets and variables → Actions →
   Variables): `BM_API_YEARS`, e.g., `2024,2025`.

## One-shot run

First time only:
```bash
make bootstrap        # pip install -e ./backend  +  npm ci in client/
```

Then:
```bash
make fetch           # or: playa all   (or: python3 -m playa all)
# env overrides: PAGES=30 PARALLEL=5 SITE_PASSWORD=… CONTACT_EMAIL=…
```

Cleans `data/pages/`, fetches in parallel (Python `ThreadPoolExecutor`,
no more xargs shell loop), writes `data/meta.json`, then merges + tags
+ builds the site.

Note: the `playa` console script is created by
`[project.scripts] playa = "playa.cli:main"` in `backend/pyproject.toml`.
After `pip install -e ./backend`, both `playa all` and
`python3 -m playa all` work.

## Project layout

```
bm-camps/                       ← repo root (the folder name stays as-is)
├── backend/
│   ├── src/playa/              ← the Python package (strict src-layout)
│   ├── tests/                  ← Python unit tests
│   └── pyproject.toml          ← setuptools build + `playa` console script
├── client/
│   ├── src/                    ← TypeScript + Preact + JSX sources
│   ├── tests/                  ← JS/TS unit tests (happy-dom)
│   ├── dist/                   ← gitignored; esbuild output
│   ├── node_modules/           ← gitignored
│   ├── package.json, tsconfig.json, esbuild.config.mjs
├── data/                       ← fetch artifacts (mostly gitignored)
├── site/                       ← published artifacts; index.html gitignored
├── scripts/fetch_all.sh
├── .github/workflows/refresh.yml
├── .claude/skills/update-tags/
├── CLAUDE.md, LICENSE, Makefile, README.md
├── renovate.json
└── .gitignore
```

**Why src-layout**: forcing `pip install -e ./backend` before imports
catches bugs where code happens to work via cwd coincidence. It's the
PEP 517/518-recommended shape. Downside: one extra bootstrap step
(`make bootstrap` handles it, and `make test-py` / `make fetch` etc.
also ensure the install is in place via the `install-backend` target).

**Why `playa`?** The package name matches the domain (`playa.purohit.dev`)
and the project identity. The repo folder stays `bm-camps` — that's a
historical artifact and renaming would break anyone who's cloned it.

**Top-level files**:
- `Makefile` — targets: `make bootstrap` (one-time), `make test`,
  `make fetch`, `make rebuild`, `make build`, etc. Targets that use
  the Python package list `install-backend` as a dep.
- `scripts/fetch_all.sh` — thin compat shim that execs
  `python3 -m playa all`. Kept so muscle-memory
  `bash scripts/fetch_all.sh` still works.
- `renovate.json` — Renovate bot config (see "Dependency updates"
  section below).

Python tests live at `backend/tests/` (one file per `playa` module:
`test_parsers.py`, `test_tagger.py`, `test_timeparser.py`,
`test_meta.py`, `test_merger.py`, `test_builder.py`). JS tests live at
`client/tests/`.
- `data/` — fetch artifacts. **Gitignored in full except `denylist.txt`**
  (public-repo / private-data stance, see top of file).
  - `pages/page_NN.json` — raw per-page fetch. Each camp dict maps 1:1
    to `Camp.to_dict()`: `{id, name, location, description, website,
    url, events: [{id, name, description, time}], tags: []}`.
  - `meta.json` — fetch timestamp + counts; drives the "Updated …" badge.
  - `denylist.txt` — one camp id per line (`#` comments allowed).
    Filtered out of the site at build. Takedown requests land here.
  - `camps.csv` — merged CSV (tags blank).
  - `camps_tagged.csv` — final CSV.
- `site/` — published artifacts. **`index.html` is gitignored**; other
  files are Pages config that ride along in the artifact.
  - `index.html` — self-contained site (plaintext ~1.7 MB, encrypted ~2.2 MB).
  - `robots.txt` — `Disallow: /` for all user-agents.
  - `.nojekyll` — disables Jekyll processing on GH Pages.
  - `CNAME` — `playa.purohit.dev`. DNS side: a `CNAME` record for `playa`
    at `purohit.dev` pointing to `<github-user>.github.io` is required
    before Pages can verify the custom domain.
## GitHub Actions workflow

`.github/workflows/refresh.yml` — nightly cron (08:00 UTC) + manual
dispatch. Three jobs: `test` (runs the unit suite), `build` (runs
`python -m playa all` on the runner, uploads Pages artifact —
**does not commit anything**), `deploy` (publishes to GitHub Pages via
`actions/deploy-pages@v4`). `build` needs `test`, so a broken parser
can never produce a broken nightly. Secrets consumed: `SITE_PASSWORD`,
`CONTACT_EMAIL`. Permission set is `contents: read` (no push needed).

**Runtime dependencies** (all pre-installed on `ubuntu-latest` —
nothing to apt-get): `openssl` (encrypted-payload path). Python 3.12
comes from `actions/setup-python`. Node 20 comes from
`actions/setup-node` (for the client bundle + JS tests). Python
project code is stdlib-only; JS project restores deps via
`npm ci` (cached on `package-lock.json`).

**How deploy works** — the runner generates `site/index.html` etc. on
its local filesystem, `actions/upload-pages-artifact@v3` tars up
`site/` and uploads it as the `github-pages` artifact,
`actions/deploy-pages@v4` takes that artifact and serves it from
Pages. At no point does the fetched data touch git. Verified against
the official docs for both actions.

**Triggering a build on demand**: Actions → "Refresh camps directory"
→ Run workflow → branch `main`. Same thing the nightly cron does.
There's no `rebuild-only` CI mode (it only made sense when data was
committed). For template/tag/CSS tweaks, **rebuild locally** with
`make rebuild` and preview before pushing code changes.

## Source HTML patterns

**Listing** (`/camps/?page=N`, 30 pages, 50 camps each, ~1458 total):
```html
<a class="list-group-item" href="/camps/{id}/">
  <div class="row">
    <div class="col-sm-3">{name}</div>
    <div class="col-sm-2">{location}</div>
    <div class="col-sm-7">{truncated desc}</div>
  </div>
</a>
```

**Detail** (`/camps/{id}/`):
- `<h1>Camp: {name}</h1>`
- `Website: <tt>{url}</tt><br />` (optional)
- `Location: <tt>{loc}</tt><br />`
- `<h2>Description: </h2><p>{desc}</p>`
- `<h2>Camp Events</h2>` followed by repeated
  `<a class="list-group-item" href="/events/{id}/">` blocks with the same
  3-col row shape (col-sm-3 name, col-sm-6 desc, col-sm-3 time).

All regexes live at the top of `fetch_page.py`.

## Rerun from scratch

```bash
make fetch     # or: python -m playa all
```

**Page count can change** — check the pagination block at the bottom of
any listing page (`<nav aria-label="Page pagination">`) and set
`PAGES=N python -m playa all`. At last fetch: 30 pages, 1458 camps,
583 with website, 4167 events, 1271 tagged (~87%).

Individual steps if you need them:

```bash
python -m playa fetch-all   # just the fetch (parallel threads)
python -m playa meta         # just data/meta.json
python -m playa merge        # just data/camps.csv
python -m playa tag          # just data/camps_tagged.csv
python -m playa build        # just site/index.html
python -m playa fetch 5     # single page (debug)
```

## Retag / rebuild site without re-fetching

Changing `TAGS` in `tagger.py` or the HTML template does **not** require
re-fetching:

```bash
make rebuild    # or: python -m playa {meta,merge,tag,build}
```

## Editing the tag taxonomy

All tag definitions live in the `TAGS` dict in `backend/src/playa/tagger.py`.
Each entry is `"tag_name": [regex, regex, …]`.

**For a structured audit**: invoke the project skill
`.claude/skills/update-tags/` (auto-loaded as `update-tags` when running
Claude Code in this repo). It walks through: baseline snapshot → find
thinly-tagged camps → cluster into proposed patterns → validate with
`\b` boundaries + grep sanity checks → show diff → apply on approval
→ run tests + rebuild → report delta. Good for after a fresh fetch
when the untagged count drifts up.

**Pattern rules:**
- Patterns are matched with `re.IGNORECASE`, so don't worry about case.
- Use `\b` word boundaries to avoid false matches. Bad: `r"art"` will
  match inside `heart`, `party`, `start`. Good: `r"\bart(?:s|ist|work|works)?\b"`.
- Patterns match against `name + description + event.name + event.description`
  (see `Tagger.haystack()` in `backend/src/playa/tagger.py`), so tags fire whether
  the keyword is in the camp description *or* any of its events.
- A camp gets a tag if **any** of the tag's patterns hits. Multiple tags
  can fire from the same text.

**Workflow for adding or changing a tag:**

1. Edit `TAGS` in `backend/src/playa/tagger.py`.
2. Add a quick test in `tests/test_tagger.py` — a positive case (should
   tag) and ideally a negative case (should not tag):
   ```python
   def test_new_tag_hot_tub(self):
       self.assertIn("hot_tub", self.match("soak in our hot tub"))
       self.assertNotIn("hot_tub", self.match("hot chocolate"))
   ```
3. Run `make test` — make sure you haven't broken word-boundary invariants.
4. Run `make rebuild` to regenerate `camps_tagged.csv` and
   `site/index.html` without re-fetching.
5. Check the `top 30 tags` summary that the `tag` command prints — if
   your new tag isn't hitting as expected, your regex is probably too strict.

**Debugging a tag that fires too often:**
Grep for the offending text: `grep -i "substring" data/pages/*.json` to
find camps that matched. Refine the regex with tighter boundaries.

**Debugging a tag that doesn't fire:**
Drop into a REPL:
```python
from playa import Tagger
t = Tagger()
print(t.tag("your test string here"))
```

## Site UI (backend/src/playa/builder.py + templates/site.html)

- Data embed, two modes:
  - **Plaintext:** `<script id="camps-data" type="application/json">` with
    `</` escaped as `<\/` (so stray `</script>` in data can't break it).
  - **Encrypted:** `<script id="camps-data-encrypted" type="application/json">`
    holding `{salt, iter, ct}` (all base64). The in-page JS shows a
    password gate, derives key||iv via `crypto.subtle.deriveBits`
    (PBKDF2-HMAC-SHA256, `iter` iterations, 48 bytes), and decrypts with
    `AES-CBC`. Successful password cached in `sessionStorage` (per-tab,
    auto-clears on close).
- Theming: 5 themes (paper / daylight / dusk / night / eclipse), pill of
  emoji buttons in header, applied pre-body via inline script in `<head>`
  to avoid flash of wrong theme, persisted in `localStorage`.
- Search across name/location/description/website/tags/events/time
  (debounced, highlights hits, auto-opens `<details>` on event match);
  click-to-toggle tag chips (AND filter); tag badges inside cards are also
  clickable; top-50 tags shown by default with "show all" toggle; `/`
  focuses search, `Esc` clears. Result cap 600 for snappy render.
- Each card shows `location · website ↗ · on directory ↗`, where the
  "on directory" link is the canonical `/camps/{id}/` page. This is part
  of the ToS mitigation stance (see top of file).
- **About / disclaimer modal.** Small `i` button (Georgia italic glyph) in
  the header topline, between the version pill and the theme switcher.
  Opens a modal with: "unofficial & best-effort" banner, "always verify on
  directory.burningman.org", explanation of what to trust less (auto tags,
  event times, anything changed after the nightly refresh), no-ads/no-
  analytics note, takedown mailto. Button pulses the first 2 visits
  (`localStorage` flag `bm-info-seen`). Modal closes on ✕, backdrop click,
  or Escape. Escape also still clears the search if the modal is closed.

## Encryption round-trip

Python side: `SiteBuilder.encrypt_payload()` shells out to
`openssl enc -aes-256-cbc -salt -pbkdf2 -iter N -pass pass:…` and parses
the `Salted__||salt(8)||ciphertext` output. Embedded in the HTML as
`{salt:b64, iter:N, ct:b64}`.

JS side: imports raw password → PBKDF2 → 48 bytes → first 32 = AES key,
last 16 = IV → `AES-CBC` decrypt → UTF-8 decode → `JSON.parse`. See the
JS in `backend/src/playa/templates/site.html` (look for `async function loadCamps`).

`tests/test_builder.py::EncryptPayloadTests` does a full round-trip:
encrypt via Python, decrypt via `openssl enc -d` with the same
parameters, assert the plaintext matches. If you change iteration count
or algorithm, update **both** sides (Python + JS in the template) and
re-run `make test`.

## Client architecture (`client/`)

The client is a small **Preact + htm + TypeScript** app bundled by
**esbuild** into a single minified IIFE (`dist/bundle.js`, ~34 KB) that
the Python builder inlines into the HTML. Zero runtime network
dependencies — everything ships in the one static file.

### Why this stack

- **Preact** (3 KB): React-compatible API, hooks, tiny. React would add
  40 KB for no real benefit at this scale.
- **JSX** via esbuild's automatic runtime (`jsx: "automatic"`,
  `jsxImportSource: "preact"`). No htm, no tagged-template parser at
  runtime — standard JSX compiled inline.
- **esbuild**: zero-config bundler, ~100 ms builds. Single binary,
  no Webpack/Rollup config surface. Handles TSX natively.
- **TypeScript** (strict mode): catches state-shape bugs before they
  ship. `tsconfig.json` has `strict`, `noImplicitAny`,
  `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` all on,
  and `jsx: "react-jsx"` + `jsxImportSource: "preact"`.
- **happy-dom** + **node --test** + **tsx**: fast, no Jest/Vitest
  overhead. Tests run with `npm test`.

We previously tried **htm** for JSX-like tagged-template syntax —
dropped it because it hasn't been updated in 4+ years and JSX via
esbuild's automatic runtime does the same thing with first-class
tooling (editor syntax highlighting, IntelliSense, prettier).

### Source tree

```
client/
  package.json          esbuild.config.mjs     tsconfig.json
  src/
    index.tsx           # entry — mounts <App/> into #app
    types.ts            # Camp / Event / EncryptedPayload / LS & SS keys
    data.ts             # readEmbeddedPayload, indexHaystacks, haystackOf
    crypto.ts           # Web Crypto AES-CBC + PBKDF2 decrypt
    utils/
      storage.ts        # safe localStorage wrappers (Safari private mode safe)
      highlight.ts      # text + <mark> VNode output for search highlighting
    hooks/
      useFavorites.ts   # generic Set + localStorage, used for camps AND events
      useTheme.ts       # theme name + data-theme on <html>, persisted
    components/
      App.tsx           # root state + wiring; owns .site-chrome wrapper
      Gate.tsx          # password prompt; pops only when payload is encrypted
      Header.tsx        # title, version pill, report-bug, info button, themes
      Toolbar.tsx       # search + filter pane (left) + action pane (right)
      TagCloud.tsx      # tag chip cloud with "show all N tags"
      CampCard.tsx      # one camp article
      EventItem.tsx     # one event <li> with star + directory link
      CampsView.tsx     # grid of cards (cap 600 with overflow hint)
      InfoModal.tsx     # disclaimer + "Clear all local data"
      Footer.tsx        # attribution / takedown
  tests/
    _dom.ts             # happy-dom install/teardown helpers
    storage.test.ts
    highlight.test.ts
    useFavorites.test.ts
    data.test.ts
    crypto.test.ts      # round-trips against openssl CLI
    CampCard.test.ts
    Toolbar.test.ts
```

**Sticky chrome.** `<App>` wraps `<Header>` + `<Toolbar>` in a
`<div class="site-chrome">`. The CSS makes `.site-chrome` `position:
sticky; top: 0` (not `<header>` itself), so the title bar, stats line,
search box, and filters/actions pane all stay pinned together when
you scroll. Pre-JSX-migration this was implicit because `<header>`
contained the controls; post-migration the wrapper makes it explicit.

### How Python + client connect

1. `npm run build` produces `client/dist/bundle.js` — a self-contained
   IIFE that references no external modules.
2. `backend/src/playa/templates/site.html` is a thin shell: head (CSS, meta
   tags, early theme-apply script), `<div id="app"></div>`, placeholder
   `__DATA_SCRIPT__`, placeholder `<script>__BUNDLE__</script>`.
3. `SiteBuilder._read_bundle()` reads the bundle and substitutes it in.
   A defensive guard rejects bundles that contain a literal
   `</script>` (would break the HTML embed). Fetch metadata is
   injected as `<meta name="bm-version">`, `<meta name="bm-fetched-date">`,
   etc., and the client reads those on startup.
4. Data is still embedded via `<script id="camps-data">` (plaintext) or
   `<script id="camps-data-encrypted">` (encrypted envelope). The client
   `readEmbeddedPayload()` picks whichever is present.

### State model (in `App.ts`)

All cross-component state lives at the top:

- `query` / `queryLower` — search input
- `activeTags: Set<string>` — tag-chip AND filter
- `showAllTags: boolean` — expand the 50-tag cap
- `favOnly: boolean` — favorites-only filter engaged
- `campFavs`, `eventFavs` — two independent `useFavorites()` hooks
  backed by `bm-favs` + `bm-fav-events` localStorage keys
- `theme` — `useTheme()`
- `infoOpen`, `infoPulse` — modal
- `focusKey` — counter; bumping triggers the Toolbar's search to
  re-focus (used after Clear)

The two expensive derivations are memoized: `sortedTags` (recomputed
only when `camps` changes) and `filtered` (when any filter input
changes).

### Rendering highlights

- Search highlighting returns an array of text + `<mark>` VNodes
  (see `utils/highlight.ts`). Regex metacharacters in the query are
  escaped — the query is treated literally.
- `<details>` auto-opens when the query hits an event OR any event in
  that camp is starred. This keeps the section open across re-renders
  after a star click.
- Event times: prefer `display_time` (Python-side normalized), fall
  back to `time` (raw) when the parser couldn't handle the format.

### Tests (JS)

- `storage.test.ts` — `readString`/`writeString`, `readStringSet`/
  `writeStringSet`, bad-JSON fallback, coercion to strings.
- `highlight.test.ts` — VNode shape, case-insensitive match, regex
  metachar escaping ("foo.bar" doesn't match "fooXbar").
- `useFavorites.test.ts` — toggle, persist, clear, load-on-mount
  (fresh container).
- `data.test.ts` — plaintext vs encrypted payload discovery;
  haystack includes name/desc/tags/events.
- `crypto.test.ts` — **round-trip against openssl CLI**
  (`spawnSync openssl enc` as the encryption side). Same crypto the
  Python builder uses. Wrong-password rejection too.
- `CampCard.test.ts` — mounts real Preact into happy-dom, asserts on
  the rendered DOM: name, tags, fav star state + click, event link,
  event fav click, `display_time` fallback to raw.
- `Toolbar.test.ts` — filter pill state, unfav-all visibility
  (must be hidden unless filter is on AND something is starred),
  click handlers.

46 tests, ~4.5 s. Run with `make test-js` or `npm test` in the client dir.

### Dev loop

```
make bundle-watch   # esbuild watch mode, rebuilds dist/bundle.js on save
make rebuild        # regenerate site from existing data (bundle first)
make test-js        # TS type-check is run separately in CI via npm run typecheck
```

Refresh the browser manually — no hot reload. For 34 KB of JS it's
honestly not worth it.

## Event time parsing

Raw event times from `directory.burningman.org` come in two main shapes
(~99.98% of 4167 events in the last fetch):

  1. `Begins Tue (8/27) at 10:00 AM, Ends 11:15 AM`  — single-occurrence
  2. `Begins Thu (8/29) at 9:00 PM, Ends Fri at 2:00 AM`  — spans midnight
  3. `From 11:00 AM to 3:00 PM on Mon, Tue, Wed, Thu, Fri`  — recurring

`backend/src/playa/timeparser.py` normalizes these into:

  * A **structured parse** (for the future calendar view):
    ```
    {"kind": "single" | "recurring",
     "days": ["Tue"] | ["Mon", ..., "Fri"],
     "start_day", "start_date", "start_time",   # 24h "HH:MM"
     "end_day",   "end_time"}
    ```
  * A **display string** attached to each `Event` as `display_time`:
    ```
    Tue 8/27 · 10:00 AM – 11:15 AM
    Thu 8/29 9:00 PM – Fri 8/30 2:00 AM
    Mon–Fri · 11:00 AM – 3:00 PM (starts 8/26)
    Daily · 7:00 PM – 12:00 AM (starts 8/26)
    Tue, Thu · 10:00 AM – 11:00 AM (starts 8/27)
    ```

**Year is never hardcoded.** `derive_week_map()` scans every
single-occurrence parse in the fetch and builds `{day_abbrev: "M/D"}`
from the `(M/D)` tuples the directory itself posted. When burn rolls
over to the next year, the map self-adjusts on the next nightly fetch.
Recurring events (which have no date) then get their `(starts M/D)`
annotation from the earliest day in their day-list, looked up in that
map.

**Day-abbrev suffixes.** The directory uses `Sun2`/`Mon2` to
disambiguate the closing Sunday from the opening one (burn week spans
two Sundays). The parser strips the trailing digit and dedupes — so
`Mon, Tue, …, Sat, Sun2` collapses to `Mon–Sun`. The second-occurrence
info is lost at display time, which is fine for the current UI; the
calendar view can re-derive it by re-parsing the raw `time` field.

**Day compaction rules** (see `_compact_days()`):
  * 3+ contiguous days → range: `Mon–Fri`, `Tue–Thu`
  * All 7 → `Daily`
  * Non-contiguous → comma list: `Tue, Thu`
  * Exactly 2 days → always comma: `Mon, Tue` (avoids `Mon–Tue`
    reading like a single day label)
  * `WEEK_ORDER` in the module is **Mon-first** (not Sun-first) since
    camp usage in the directory overwhelmingly treats Mon as "day 1".

**Integration.** `SiteBuilder._enrich_event_times(camps)` runs at the
end of `load_camps()`. Two-pass: parse every event, derive the week map
from the collected parses, format each event with the map. Prints a
one-line coverage summary at build time:
```
event times parsed: 4166/4167 (99%); week map: {'Fri': '8/30', ...}
```

**Graceful fallback.** `display_time == ""` when the raw string
couldn't be parsed. The template renders `e.display_time || e.time`,
so any future format drift degrades to showing the raw text instead
of crashing or hiding the event.

**Display guarantees** (test-enforced):
  * No 4-digit year appears in any output (`test_no_year_in_any_output`
    runs a regex assertion against sample outputs)
  * AM/PM boundaries: `12:00 AM` ↔ `00:00`, `12:00 PM` ↔ `12:00`,
    `12:30 AM` ↔ `00:30` (see `TimeConversionTests`)

**If the directory introduces a new time format** that the parser
doesn't recognize, coverage drops but nothing breaks — those events
just show their raw strings. Watch the coverage percentage in the
build log; if it drops meaningfully below 99%, inspect the unparsed
samples and extend `_BEGINS_RE`/`_FROM_RE` or add a third regex.

## Design notes / gotchas

- 0.2s sleep between detail fetches; 3 retries with backoff (see
  `Config.per_camp_sleep` + `fetch_retries` + `fetch_backoff`). Keep it polite.
- `Fetcher` falls back to listing-page data if a detail fetch fails, so
  one bad camp doesn't abort a whole page.
- Some camps have `location: "None Listed"` or `description: "-"` — kept
  as-is; they just end up untagged.
- Tagging is keyword-based, not ML. Patterns use `\b` word boundaries so
  `art` doesn't match `heart`/`party`. The ~13% untagged are mostly
  one-line joke camps or blank descriptions — rarely worth chasing.
- Dependency graph: `config` is a leaf; `models` depends on nothing;
  `parsers` ← `models`; `fetcher` ← `config, models, parsers`;
  `tagger` ← `models`; `timeparser` is a leaf (pure functions on
  strings); `builder` ← `config, models, tagger, timeparser`;
  `meta` / `merger` ← `config`; `cli` ← everything. No cycles.

## Tests

```bash
make test        # runs both suites: Python (92) + JS (46)
make test-py     # Python unit tests only (stdlib unittest, ~0.15s)
make test-js     # JS/TS tests via node --test + happy-dom (~4.5s)
```

Combined: **138 tests, 0 failures**. CI runs both in the `test` job
before the `build` job touches anything.

- `tests/test_parsers.py` — `_clean()`, `ListingParser.parse()`,
  `DetailParser.parse()`. Fixture HTML inlined; the network-touching
  `Fetcher.fetch()` is deliberately not exercised (would make CI flaky).
- `tests/test_tagger.py` — core taxonomy invariants: `\b` boundaries
  (`art` ≠ `heart`), case-insensitivity, multi-tag firing, a floor of
  ~100 tags so accidental deletions are caught, `Tagger.haystack()`
  event-text inclusion.
- `tests/test_timeparser.py` — AM/PM↔24h boundary conversions, both
  `Begins`/`From` shapes, `Day2` suffix handling, week-map derivation
  (most-common-wins on conflicts), day compaction (range / daily /
  comma-list), and the year-free display guarantee.
- `tests/test_merger.py` — column order, dedupe by id, alphabetical
  sort, handling of legacy JSONs that predate the `website` field.
- `tests/test_meta.py` — `fetched_at` format (ISO-8601 UTC),
  version/date coupling, zero-page fallback, event counting.
- `tests/test_builder.py` — **OpenSSL encryption round-trip** (encrypt
  with Python → decrypt with `openssl enc -d`), denylist filtering +
  comment stripping, `SiteBuilder.load_meta()` fallback to page mtime,
  `load_camps()` dedupe + denylist + canonical URL, and a full
  plaintext build smoke test. Encryption tests require `openssl` on
  PATH (same hard dep as production).

All tests construct a `Config(root=tmp_path)` and operate entirely in
temp dirs — no module-level `patch.object` hacks. That's the main
testing win from the restructure.

Tests run in CI as a dedicated `test` job that blocks the `build` job
(`needs: test`), so a broken parser won't silently produce a broken
nightly build.

## Publishing to GitHub Pages

One-time setup in the repo:

1. Push to a private GitHub repo.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**
   (not "Deploy from a branch").
3. **Settings → Secrets and variables → Actions → New repository secret:**
   - `SITE_PASSWORD` — the shared password for friends.
   - `CONTACT_EMAIL` — where takedown mail should go.
4. Custom domain: `site/CNAME` is already committed with
   `playa.purohit.dev`. Add a `CNAME` DNS record for `playa` at
   `purohit.dev` pointing to `<github-user>.github.io`. **Settings →
   Pages** will show "Custom domain" once detected. Leave "Enforce
   HTTPS" on (GH Pages auto-provisions a Let's Encrypt cert once DNS
   validates).
5. Trigger the workflow manually (Actions → "Refresh camps directory" →
   Run workflow) for the first deploy. After that the nightly cron takes
   over.

Takedown workflow:

1. Friend-of-camp emails the `CONTACT_EMAIL` via the footer link.
2. You add their camp id to `data/denylist.txt` and push.
3. Next cron run (or manual dispatch) fetches and builds fresh; the
   denylisted id is filtered out of the site. Because fetched data is
   never committed, this is a genuine removal — no lingering data in
   git history, no GitHub code-search hits. Reversing a takedown just
   means removing the id from `denylist.txt` and pushing.

## Dependency updates (Renovate)

`renovate.json` at the repo root drives **Renovate Bot**. The bot opens
pull requests to bump npm + GitHub Actions versions on a schedule, with
a **14-day cooling period** (`minimumReleaseAge: "14 days"`) so we never
land on freshly-published broken releases.

One-time setup: install the Renovate GitHub App
(<https://github.com/apps/renovate>) and grant it access to this repo.

Behavior, in short:
- **Non-major updates** are grouped into one PR per week (Monday before
  4am PT), auto-merged after CI passes (`platformAutomerge`).
- **Major updates** are never auto-merged — labels `dependencies` +
  `major`, human review required. Major jumps (e.g. TypeScript 5 → 6,
  or esbuild 0.24 → 0.28) often carry breaking changes.
- **Security updates** bypass the 14-day hold and open immediately,
  labelled `security`.
- **Lock-file maintenance** runs on the same Monday schedule to
  refresh transitive pins.
- **Concurrent PR cap: 5**, hourly cap: 2. Keeps the noise sane.

Change the schedule / cadence in `renovate.json` if it needs to be
quieter or louder.

## Share / import (friends' favorites)

- **`📤 Share`** button in the toolbar actions pane. Only visible when
  the user has ≥1 starred camp or event. Opens `ShareModal`:
  1. Prompts for a nickname (stored in `bm-nickname`) so recipients
     see whose list it is.
  2. Encodes `{name, campIds, eventIds}` as base64url-of-JSON and
     builds `https://playa.purohit.dev/#share=<encoded>`.
  3. Copies URL to clipboard; falls back to an inline `<textarea>` if
     the Clipboard API is blocked.
- **Import banner** appears at the top whenever the URL carries a
  `#share=…`. Shows sender name + counts. One-click import merges
  (union) into `localStorage['bm-shared']` under their nickname —
  separate from the user's own `bm-favs` / `bm-fav-events`. The
  banner is dismissible; either action strips `#share=` from the URL
  so refresh doesn't re-prompt.
- **Friends live in `useFriends`** (`hooks/useFriends.ts`). The fav
  filter and map/schedule views include friends' stars alongside
  yours. Camps display a "faved by: you, alice, bob" chip row when
  friends have starred them; events show a per-friend chip in their
  row. The user's own stars are always represented by the ★ button
  state — no chip for "you" unless friends have also starred.
- **Fragment-only**: the share payload never leaves the device. GitHub
  Pages servers only see the path; everything after `#` is
  client-side. The "Clear all local data" button in the About modal
  wipes `bm-favs`, `bm-fav-events`, `bm-nickname`, `bm-shared`, and
  the password cache.

## Schedule view (calendar)

- **Tab**: `📅 Schedule` in the top-of-page tab bar (`components/TabBar.tsx`,
  hash-routed via `useHashRoute` → `#schedule`).
- **Source**: starred events (both yours + any friend's), bucketed by
  the day(s) they occur on. Data comes from `event.parsed_time`, added
  server-side by `SiteBuilder._enrich_event_times` — each event carries
  its kind (`single` / `recurring`), days list, start/end 24-h times,
  and (for singles) a start date like `"8/27"` pulled from the
  year-agnostic `derive_week_map`.
- **Layout**: desktop = 7 columns Mon–Sun (CSS grid); mobile =
  collapsible `<details>` accordion per day (≤800px). Non-empty days
  are expanded by default.
- **Recurring events** appear on every day they recur (e.g., a
  "Mon–Fri" event shows 5 times).
- **Unscheduled**: events whose `parsed_time` is null land in a
  dashed-border section at the bottom — the raw `time` string still
  renders so nothing is lost.
- **Explicit-only**: starring a camp does NOT auto-include its events.
  A top-of-view notice spells this out. This matches the user's
  intent: a camp fav means "I want to visit this camp," an event fav
  means "I'll be at this exact thing at this exact time."

## Map view (Black Rock City)

Static SVG rendered from code — **zero external network calls**,
works offline after first load. Fits the privacy stance.

### Files

- `client/src/map/data.ts` — **year-specific** constants: Golden Spike
  lat/lng, 12:00 compass bearing, street letters / themed names /
  radii in feet, radial clock positions, fence pentagon. Updated
  annually by the `/update-map` Claude skill; see the file's header
  for the refresh procedure.
- `client/src/map/address.ts` — pure functions:
  `parseAddress("7:30 & F")`, `clockToCompass(hr)`,
  `destinationPoint(lat, lng, bearingDeg, distFt)`, `haversineMeters`,
  `bearingDeg`, `addressToLatLng`, `addressToSvgFeet`,
  `latLngToSvgFeet`. No state, pure math.
- `client/src/components/MapView.tsx` — SVG renderer. Draws the
  concentric streets (as big arcs from 2:00 → 10:00 the long way
  around the back of the city, so the 6:00 opening is empty), radial
  streets, the Man, labels, starred camps as pins, and a "you are
  here" dot + bearing line when GPS is granted.
- `client/src/hooks/useGeolocation.ts` — wraps
  `navigator.geolocation.watchPosition`. Opt-in — no permission
  prompt until the user clicks "Use my GPS".

### Geometry quick-reference (2026)

```
Golden Spike (the Man)   40.783242, -119.207871
True N aligns with       BRC 4:30 axis
Therefore BRC 12:00 bears 225° (SW); 6:00 → 45° (NE)
Esplanade radius         2500 ft
Block depths: Esp→A = 400, A→E = 250, E→F = 450 (mid-city plaza),
              F→I = 250, I→J = 150, J→K = 150
Streets: Esplanade + Ararat(A) Bodhi(B) Chomolungma(C) Delphi(D)
         Eternal(E) Fulcrum(F) Great Oak(G) Heiau(H) Iroko(I)
         Jiba(J) Kundalini(K)
```

The **SVG convention** is 12:00 at positive-y (up) with the viewBox
centered on the Man. The `addressToSvgFeet` output is in raw feet; the
component sets a ±6000ft viewBox so K street (5400ft) fits with ~10%
margin. Clock-hour rotation: `theta = (hour / 12) * 2π` clockwise from
"up" — so 3:00 is (+x, 0), 6:00 is (0, +y), 9:00 is (−x, 0).

### GPS → SVG

`latLngToSvgFeet` computes compass bearing + great-circle distance
from the Man, subtracts `twelveBearingDeg` to get the "hour-angle"
(degrees clockwise from BRC 12:00), then projects to the same unit
system. Round-trip with `addressToSvgFeet(addressToLatLng(addr))`
agrees to within ~20 ft (spherical trig vs flat polar).

### External map link

Each camp with a resolvable address gets an **"Open in Google Maps ↗"**
link (plain `https://www.google.com/maps?q=LAT,LNG` — no API key,
works on any platform). Handy for getting *to the playa*; the built-in
map is for *on the playa* where no tile server is reachable.

### `/update-map` skill

`.claude/skills/update-map/SKILL.md` — run yearly (or when the user
says "new year's plan is out"). It walks through pulling the Golden
Spike coords from `innovate.burningman.org`, the block depths from the
measurements PDF, and the themed street names from the city-plan page;
then does targeted edits to `client/src/map/data.ts` + bumps the
"Last refreshed" comment. Only rendering code stays hands-off.

## Official BM APIs + datasets (migration path)

Researched 2026-04-22. Burning Man publishes camp/event/art data through
two channels that we could lean on instead of (or alongside) the HTML
fetch. The fetch stays as the only pre-burn source for the *current*
year, but both channels reduce our fragility and open up new features.

### Channel 1 — JSON archive (no key, post-burn historical)

`https://bm-innovate.s3.amazonaws.com/archive/<YEAR>/` hosts three flat
JSON files per year: `camps.json`, `events.json`, `art.json`. Verified
2026-04-22: all three resolve with HTTP 200 for 2025 (last modified
2026-03-05). Years published: **2015–2025** (gaps in 2020–2021, no burn).
2026 lands here after the 2026 burn.

Schema is richer than what we fetch. Sample camp record:
```json
{"uid": "a1XVI000008yf262AA", "name": "…", "year": 2025, "url": null,
 "contact_email": "…", "hometown": "…", "description": "…",
 "landmark": "…",
 "location": {"frontage": "D", "intersection": "3:15",
              "intersection_type": "&", "dimensions": "…", ...}}
```

Advantages over HTML fetch:
- Structured `location` object (no regex, no `None Listed` strings)
- Stable `uid` (Salesforce-style) — our current fetch uses the
  numeric directory id
- `contact_email`, `hometown`, `landmark` — fields we don't surface today
- Licensed under the Terms of Service at
  `https://innovate.burningman.org/terms-of-service-for-burning-man-apis-and-datasets/`
  (review before publishing; stance is friendlier than directory ToS)

Advantage we lose: *it's last year's data.* Unusable for pre-burn
planning in the current year.

### Channel 2 — `api.burningman.org` (keyed, live-ish)

Official live API. Requires an API key (request at the endpoint). Per
the 2025 schedule on `innovate.burningman.org/apis-page/`:

| Data          | Developer release | Public release |
|---------------|-------------------|----------------|
| Camp locs     | Aug 4, 12am PDT   | Aug 17, 12am PDT |
| Art locs      | Aug 4, 12am PDT   | Aug 24, 12am PDT |

Release-timing restriction: *developers must not release art locations
to users until gates open.* We'd need to respect that if we auto-build
nightly during burn week.

Endpoint paths, response formats, and rate limits are **not documented
publicly** — available only after API-key request. Treat as unverified
until we pull a key and confirm.

### Channel 3 — GIS data (no key, city geometry)

`https://github.com/burningmantech/innovate-GIS-data` ships KMZ +
GeoJSON for street outlines, centerlines, plazas, city blocks, DMZ,
trash fence, portable toilets, and points of interest. The 2026 Golden
Spike + general city plan is separately published at
`https://innovate.burningman.org/dataset/2026-golden-spike-and-general-city-map-data/`
(KML + GeoJSON, released 2026-04-16).

This is the authoritative source for everything hand-coded in
`client/src/map/data.ts`. The `/update-map` skill already pulls from
`innovate.burningman.org` by hand; switching it to parse the GeoJSON
would eliminate most of the annual copy-paste work.

### Migration strategy

**Keep HTML fetch as the primary source** for the current-year use
case until the live API is opened to us and we've confirmed its shape.
The fetch is fragile but it's the only channel that gives us pre-burn
data without key friction, and we already have the infrastructure.

**Layer the archive JSON in as a secondary source** for historical /
year-over-year features (already listed as a future extension). A new
`playa.archive` module could fetch `camps.json` + `events.json` for a
given year and produce the same `Camp`/`Event` dataclasses our current
pipeline uses. No merge logic needed for single-year builds; only
matters if we add diffing.

**Request an API key** off-season (anytime before Aug 1) so the live
API is available as a fallback. Don't switch to it as primary until:
(1) the key is granted, (2) endpoints + schemas are documented, (3)
we've verified it returns pre-burn camp data (not just art locations).
The camp directory at `directory.burningman.org` is populated *weeks*
before Aug 4 developer access, so the API may never fully supersede
the fetch for our "plan your burn before gates open" use case.

**Migrate `map/data.ts` to GeoJSON first.** It's the lowest-risk
integration: pure geometry, one-shot annual refresh, no ToS mitigations
needed (the GeoJSON is explicitly licensed open). Would replace the
hand-edited constants (street radii, clock bearings, themed street
names) with a parsed GeoJSON build step in the `/update-map` skill.

### Compliance checklist — MUST do before switching to `api.burningman.org` / `bm-innovate.s3.amazonaws.com/archive/`

Source: <https://innovate.burningman.org/terms-of-service-for-burning-man-apis-and-datasets/>

Once we pull any camp/event/art data from those endpoints, the
Innovate ToS applies in addition to (or instead of) the
directory.burningman.org ToS. These items are gate-items for the
switch-over; none are optional.

- [ ] **§4 disclaimer**: keep the required verbatim string —
      *"This app is not affiliated, endorsed, or verified by Burning
      Man Project."* — in the footer + About modal (already shipping
      as of the rename to "Playa Camps"). Must appear "in a prominent
      location within your App and on any webpage from which your App
      may be downloaded."
- [x] **§6.2 location embargo (camps)**: enforced **client-side**
      in `client/src/utils/embargo.ts` (`isLocationEmbargoed` +
      `applyLocationEmbargo`). When the source is `api-<burn_year>`
      AND today (UTC, day-granularity) is strictly before
      `<meta name="bm-burn-start">`, `App.tsx` masks
      `camp.location = ''` on every camp at decrypt-time. Downstream
      consumers (CampCard, ScheduleView, MapView) see empty strings
      and naturally hide the data. Build artifacts (`index.html`,
      cache JSONs) keep full location data; the embargo is a UX
      gate, not a security boundary — relies on ToS §6.2's "shown
      to your users" wording rather than "stored anywhere". A user
      keeping the page open across burn-start needs to refresh to
      see locations appear (acceptable trade-off vs. ticking-clock
      state). Directory and past-year API sources are untouched.
      Conservative cutoff — uses gate-open rather than the ToS-
      allowed first Sunday of build week (~7 days earlier).
      **Per-tier bypass**: god-mode (inner circle) sees locations
      pre-burn — see ADR D8 in `docs/15-data-sources.md`. The build
      emits a parallel `<meta name="bm-trusted-wrappers">` so the
      client knows which wrappers earn the bypass without exposing
      tier names in the DOM. demigod / spirit / single-tier
      `SITE_PASSWORD` builds keep the embargo on.
- [ ] **§6.2 location embargo (art)**: not yet relevant — we don't
      surface art. When art is added, mirror the camp-embargo path
      but use gate-open (Day 1) as the cutoff instead of build-week
      Sunday.
- [ ] **§7.2 trademark**: app name must not contain "Burning Man",
      "Black Rock City", "Decompression", or "Playa Events". Current
      name is "Playa Camps" — OK. If renaming again, check this rule.
- [ ] **§5.3 republishing**: the expected reading (per project owner)
      is "don't distribute as if we are the provider" — using the
      data *in our app* is fine, as long as the §4 disclaimer is
      present and we don't mirror it as a standalone dataset.
- [ ] **§5.5 modification**: the auto-generated tags and the
      calendar-date canonicalization are both transformations on
      Event Data. The About modal already calls both out explicitly
      — *"tags are keyword-matched by this app — not from Burning
      Man Project"* + *"calendar dates come from a configured
      burn-week window"*. Keep those labels current if the pipeline
      adds more transforms.
- [ ] **§2.3 permissions transparency**: the GPS/location copy in
      the About modal already covers this. If we ever add camera
      or push access, extend that paragraph.
- [ ] **§9 revocation**: `docs/revocation-plan.md` has the runbook.
      The `SITE_PASSWORD` rotation path preserves the showcase
      value; the §5 "destroy all copies" path is only needed if the
      takedown explicitly targets data.
- [ ] **MIN_CAMPS rail**: `SiteBuilder.build()` refuses to produce
      `site/index.html` when fewer than 500 camps loaded. Don't
      override `MIN_CAMPS=0` in CI — the rail is specifically there
      so a broken fetch / empty API response doesn't overwrite the
      last-good deploy.

### Concrete next steps (when someone picks this up)

1. Write `backend/src/playa/archive.py` — fetches
   `bm-innovate.s3.amazonaws.com/archive/<year>/{camps,events}.json`,
   returns `list[Camp]` matching `models.Camp.from_dict()`. Good unit
   of work — pure network + mapping, no HTML.
2. Add `python -m playa fetch --source=archive --year=2025` switch,
   keep `directory` (HTML) as the default.
3. Once `archive.py` is landed, a "year dropdown" in the UI becomes a
   ~50-line client change (another `camps-data-<year>` payload).
4. `/update-map` skill: swap the hand-copy steps for `curl` + jq on
   the GeoJSON files. Keep the verification pass — the GeoJSON is
   authoritative for geometry, not for themed-street naming (those
   still come from the theme-year announcement).
5. Request `api.burningman.org` key (Calm/personal email). Document
   the schema here once the welcome packet lands. **Do not** hardcode
   endpoint paths from memory or from this CLAUDE.md — verify by
   hitting the real API first. (See user CLAUDE.md "VERIFY BEFORE
   STATING".)

### What to preserve across any migration

- **The public-code / private-data stance.** Even archive JSON is
  subject to the API ToS; don't commit payloads to git even though
  the source license is friendlier than the directory ToS.
- **Denylist + takedown workflow.** Denylist is keyed on the directory
  numeric id today. The archive JSON uses `uid` (SFDC-style). Any
  migration needs to either keep both ids in `Camp`, or do a one-time
  mapping pass so existing `denylist.txt` entries don't silently stop
  matching.
- **Coverage / parse-rate metric.** `_enrich_event_times` prints a
  coverage percentage at build time. If the archive ships structured
  start/end timestamps, we can skip `timeparser.py` for archive-sourced
  events and parse-coverage becomes 100% — but leave the parser around
  for the HTML path.

## Likely future extensions

- Per-tag landing pages or tag co-occurrence view.
- Pull organizer URLs / social links from `/events/{id}/` pages (not yet
  fetched — only camp pages are fetched).
- "Search events only" toggle in the UI.
- Year-over-year diffing if the user wants to track camp changes across
  burns — current fetch is a single snapshot. Now easy: `playa.archive`
  (see "Official BM APIs + datasets" above) gives us 2015–2025 for free.
- Replace the shared-password gate with Cloudflare Access (free for ≤50
  users) if you want per-friend access control + audit log.
