# bm-camps

Scraper + single-file static site for the Burning Man theme-camp directory
(`https://directory.burningman.org/camps/`). Goal: public-code, private-data
GitHub Pages deploy with password gate at `playa.purohit.dev`, for
personal/friends use only — **not** a general-public site. See "ToS risk +
mitigations" below for the reasoning.

## Public repo, private data

**The repo is public. The scraped camp data is not in the repo.** This is
the core architectural decision — see `.gitignore` for the list of paths
that are never committed:

- `data/pages/*.json` — raw scraped per-camp payloads (owned by camps per §6)
- `data/meta.json`, `data/camps.csv`, `data/camps_tagged.csv` — derived
- `site/index.html` — the compiled site (even encrypted, keeps it out of
  GitHub code search and permanent git history)

Every CI run scrapes fresh on the ephemeral GH Actions runner, builds the
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
None of the three explicitly prohibits scraping or automated access.

Mitigations baked into this project (so we can point to them if challenged):

- **Public code, private data.** The repo is public for portability / as a
  portfolio piece, but `.gitignore` keeps every byte of scraped camp
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
  `data/denylist.txt` and are filtered out at the next scrape+build. Since
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

The pipeline lives in the `bm_camps/` package. Invoke via
`python -m bm_camps <subcommand>` (or `make <target>` for common ones):

```
python -m bm_camps scrape <N>   →  data/pages/page_NN.json  (raw per-page)
python -m bm_camps scrape-all   →  all 30 pages in parallel (ThreadPoolExecutor)
python -m bm_camps meta         →  data/meta.json          (scrape timestamp + counts)
python -m bm_camps merge        →  data/camps.csv          (merged, tags blank)
python -m bm_camps tag          →  data/camps_tagged.csv   (final CSV)
python -m bm_camps build        →  site/index.html         (self-contained site)
python -m bm_camps all          →  the whole nightly pipeline
```

All Python **stdlib only** plus `openssl` CLI (universally available) for
optional encryption. No `requests`/BeautifulSoup. Parsing is regex over
the site's stable HTML shape.

## Package layout (bm_camps/)

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
- `scraper.py` — `Scraper(config)`. Only class that touches the network.
  `fetch()` with retries + backoff, `scrape_page()` / `scrape_page_to_file()`.
- `tagger.py` — `TAGS` dict (taxonomy of ~120 tags) + `Tagger(taxonomy)`
  class. `tag(text)`, `tag_camp(camp)`, `haystack(camp)` helpers.
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
- `__main__.py` — enables `python -m bm_camps`.

Classes are used where state + behavior cohere (Scraper holds
Config+HTTP settings, Tagger holds compiled regexes, SiteBuilder holds
template + config). `write_meta` / `merge_csv` are plain functions —
wrapping them in classes would have been pure ceremony.

## Build-time config (env vars)

| Var              | Default                | Effect                                              |
|------------------|------------------------|-----------------------------------------------------|
| `SITE_PASSWORD`  | *(unset)*              | If set, encrypt the JSON payload at build time      |
| `CONTACT_EMAIL`  | `bm-camps@example.com` | Address used in footer `mailto:` takedown link      |
| `PBKDF2_ITER`    | `200000`               | PBKDF2 iteration count                              |
| `PAGES`          | `30`                   | Listing pages to scrape (used by `scrape_all.sh`)   |
| `PARALLEL`       | `5`                    | Parallelism for scrape (used by `scrape_all.sh`)    |

Local dev: leave `SITE_PASSWORD` unset to produce a plaintext build for
quick preview. CI sets both via repo secrets.

## One-shot run

```bash
python -m bm_camps all    # or: make scrape
# env overrides: PAGES=30 PARALLEL=5 SITE_PASSWORD=… CONTACT_EMAIL=…
```

Cleans `data/pages/`, scrapes in parallel (Python `ThreadPoolExecutor`,
no more xargs shell loop), writes `data/meta.json`, then merges + tags
+ builds the site.

## Project layout (outside the package)

- `bm_camps/` — the Python package. See "Package layout" above.
- `tests/` — unit tests, one file per `bm_camps/` submodule:
  `test_parsers.py`, `test_tagger.py`, `test_meta.py`, `test_merger.py`,
  `test_builder.py`.
- `scripts/scrape_all.sh` — thin compat shim that execs
  `python -m bm_camps all`. Kept so muscle-memory
  `bash scripts/scrape_all.sh` still works.
- `Makefile` — convenience targets (`make test`, `make scrape`,
  `make rebuild`, etc.). Each just shells out to `python -m bm_camps`.
- `data/` — scrape artifacts. **Gitignored in full except `denylist.txt`**
  (public-repo / private-data stance, see top of file).
  - `pages/page_NN.json` — raw per-page scrape. Each camp dict maps 1:1
    to `Camp.to_dict()`: `{id, name, location, description, website,
    url, events: [{id, name, description, time}], tags: []}`.
  - `meta.json` — scrape timestamp + counts; drives the "Updated …" badge.
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
`python -m bm_camps all` on the runner, uploads Pages artifact —
**does not commit anything**), `deploy` (publishes to GitHub Pages via
`actions/deploy-pages@v4`). `build` needs `test`, so a broken parser
can never produce a broken nightly. Secrets consumed: `SITE_PASSWORD`,
`CONTACT_EMAIL`. Permission set is `contents: read` (no push needed).

**Runtime dependencies** (all pre-installed on `ubuntu-latest` —
nothing to apt-get): `openssl` (encrypted-payload path). Python 3.12
comes from `actions/setup-python`. Project code is stdlib-only;
**no `pip install` step needed**.

**How deploy works** — the runner generates `site/index.html` etc. on
its local filesystem, `actions/upload-pages-artifact@v3` tars up
`site/` and uploads it as the `github-pages` artifact,
`actions/deploy-pages@v4` takes that artifact and serves it from
Pages. At no point does the scraped data touch git. Verified against
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
make scrape     # or: python -m bm_camps all
```

**Page count can change** — check the pagination block at the bottom of
any listing page (`<nav aria-label="Page pagination">`) and set
`PAGES=N python -m bm_camps all`. At last scrape: 30 pages, 1458 camps,
583 with website, 4167 events, 1271 tagged (~87%).

Individual steps if you need them:

```bash
python -m bm_camps scrape-all   # just the scrape (parallel threads)
python -m bm_camps meta         # just data/meta.json
python -m bm_camps merge        # just data/camps.csv
python -m bm_camps tag          # just data/camps_tagged.csv
python -m bm_camps build        # just site/index.html
python -m bm_camps scrape 5     # single page (debug)
```

## Retag / rebuild site without re-scraping

Changing `TAGS` in `tagger.py` or the HTML template does **not** require
re-scraping:

```bash
make rebuild    # or: python -m bm_camps {meta,merge,tag,build}
```

## Editing the tag taxonomy

All tag definitions live in the `TAGS` dict in `bm_camps/tagger.py`.
Each entry is `"tag_name": [regex, regex, …]`.

**For a structured audit**: invoke the project skill
`.claude/skills/update-tags/` (auto-loaded as `update-tags` when running
Claude Code in this repo). It walks through: baseline snapshot → find
thinly-tagged camps → cluster into proposed patterns → validate with
`\b` boundaries + grep sanity checks → show diff → apply on approval
→ run tests + rebuild → report delta. Good for after a fresh scrape
when the untagged count drifts up.

**Pattern rules:**
- Patterns are matched with `re.IGNORECASE`, so don't worry about case.
- Use `\b` word boundaries to avoid false matches. Bad: `r"art"` will
  match inside `heart`, `party`, `start`. Good: `r"\bart(?:s|ist|work|works)?\b"`.
- Patterns match against `name + description + event.name + event.description`
  (see `Tagger.haystack()` in `bm_camps/tagger.py`), so tags fire whether
  the keyword is in the camp description *or* any of its events.
- A camp gets a tag if **any** of the tag's patterns hits. Multiple tags
  can fire from the same text.

**Workflow for adding or changing a tag:**

1. Edit `TAGS` in `bm_camps/tagger.py`.
2. Add a quick test in `tests/test_tagger.py` — a positive case (should
   tag) and ideally a negative case (should not tag):
   ```python
   def test_new_tag_hot_tub(self):
       self.assertIn("hot_tub", self.match("soak in our hot tub"))
       self.assertNotIn("hot_tub", self.match("hot chocolate"))
   ```
3. Run `make test` — make sure you haven't broken word-boundary invariants.
4. Run `make rebuild` to regenerate `camps_tagged.csv` and
   `site/index.html` without re-scraping.
5. Check the `top 30 tags` summary that the `tag` command prints — if
   your new tag isn't hitting as expected, your regex is probably too strict.

**Debugging a tag that fires too often:**
Grep for the offending text: `grep -i "substring" data/pages/*.json` to
find camps that matched. Refine the regex with tighter boundaries.

**Debugging a tag that doesn't fire:**
Drop into a REPL:
```python
from bm_camps import Tagger
t = Tagger()
print(t.tag("your test string here"))
```

## Site UI (bm_camps/builder.py + templates/site.html)

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
JS in `bm_camps/templates/site.html` (look for `async function loadCamps`).

`tests/test_builder.py::EncryptPayloadTests` does a full round-trip:
encrypt via Python, decrypt via `openssl enc -d` with the same
parameters, assert the plaintext matches. If you change iteration count
or algorithm, update **both** sides (Python + JS in the template) and
re-run `make test`.

## Design notes / gotchas

- 0.2s sleep between detail fetches; 3 retries with backoff (see
  `Config.per_camp_sleep` + `fetch_retries` + `fetch_backoff`). Keep it polite.
- `Scraper` falls back to listing-page data if a detail fetch fails, so
  one bad camp doesn't abort a whole page.
- Some camps have `location: "None Listed"` or `description: "-"` — kept
  as-is; they just end up untagged.
- Tagging is keyword-based, not ML. Patterns use `\b` word boundaries so
  `art` doesn't match `heart`/`party`. The ~13% untagged are mostly
  one-line joke camps or blank descriptions — rarely worth chasing.
- Dependency graph: `config` is a leaf; `models` depends on nothing;
  `parsers` ← `models`; `scraper` ← `config, models, parsers`;
  `tagger` ← `models`; `builder` ← `config, models, tagger`;
  `meta` / `merger` ← `config`; `cli` ← everything. No cycles.

## Tests

```bash
make test        # stdlib `unittest`, 63 tests, ~0.1s
```

- `tests/test_parsers.py` — `_clean()`, `ListingParser.parse()`,
  `DetailParser.parse()`. Fixture HTML inlined; the network-touching
  `Scraper.fetch()` is deliberately not exercised (would make CI flaky).
- `tests/test_tagger.py` — core taxonomy invariants: `\b` boundaries
  (`art` ≠ `heart`), case-insensitivity, multi-tag firing, a floor of
  ~100 tags so accidental deletions are caught, `Tagger.haystack()`
  event-text inclusion.
- `tests/test_merger.py` — column order, dedupe by id, alphabetical
  sort, handling of legacy JSONs that predate the `website` field.
- `tests/test_meta.py` — scraped_at format (ISO-8601 UTC),
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
3. Next cron run (or manual dispatch) scrapes and builds fresh; the
   denylisted id is filtered out of the site. Because scraped data is
   never committed, this is a genuine removal — no lingering data in
   git history, no GitHub code-search hits. Reversing a takedown just
   means removing the id from `denylist.txt` and pushing.

## Likely future extensions

- Per-tag landing pages or tag co-occurrence view.
- Pull organizer URLs / social links from `/events/{id}/` pages (not yet
  scraped — only camp pages are fetched).
- "Search events only" toggle in the UI.
- Year-over-year diffing if the user wants to track camp changes across
  burns — current scrape is a single snapshot.
- Replace the shared-password gate with Cloudflare Access (free for ≤50
  users) if you want per-friend access control + audit log.
