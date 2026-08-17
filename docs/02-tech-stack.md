---
title: Tech Stack & Tool Choices
date: 2026-04-27
updated: 2026-08-13
status: current
---

# Tech Stack & Tool Choices

## Overview

Each library and tool was picked to minimize ongoing operational cost.
The site lives at the edge (Pages CDN); code changes deploy from `main`, while
data refreshes remain explicit operator actions.

## Decisions

### Server side — Python 3.14.4, stdlib only

- **Python over Node**: the fetch + parse + transform pipeline is
  imperative I/O glue. Python's stdlib has `urllib`, `re`, `csv`,
  `concurrent.futures`, `json`, `zoneinfo` — everything we need.
- **No third-party dependencies**: the only external program is
  `openssl` (pre-installed on `ubuntu-latest`). Means CI has no
  `pip install` step beyond an editable install of the project itself,
  no Renovate noise on Python packages.
- **One local/CI toolchain**: `.tool-versions` pins Python 3.14.4 and
  Node 26.7.0; both GitHub Actions workflows read that same file. The
  `pyproject.toml` accepts compatible Python 3.14 patch releases and
  `package.json` requires the selected Node release. The exact tool file remains
  the shared local/CI selection, without making the Python package uninstallable
  on the next 3.14 security patch.
- **`openssl` CLI for crypto**: shells out for the camp-data
  encryption (`AES-256-CBC + PBKDF2`). Battle-tested, available
  everywhere, and the JS-side decryption uses the same well-known
  parameters via Web Crypto. Round-trip tests verify both sides agree.

### Client side — Preact + TypeScript + esbuild

- **Preact (3 KB) over React (40 KB)**: same hooks API, much smaller.
  At our scale we never hit a Preact gap. Bundle ships in the same
  request as the page, so size matters.
- **TypeScript strict**: every flag on (`strict`, `noImplicitAny`,
  `noUnusedLocals`, `noImplicitReturns`). Catches state-shape bugs
  before they ship — the alternative would be runtime crashes on
  someone's phone in the desert.
- **JSX via esbuild's automatic runtime**: standard JSX with
  `jsxImportSource: "preact"`. We tried `htm` early on; dropped it
  because it hadn't been updated in 4+ years and standard JSX gets
  better editor + linter support.
- **esbuild over Webpack/Rollup**: zero config, single binary, sub-100ms
  builds. The whole "build the client" step is `node esbuild.config.mjs`
  — no plugin ecosystem to babysit.
- **Official Dropbox SDK for optional sync**: exact-pinned, MIT-licensed, and
  bundled locally. It owns PKCE, access-token refresh, and generated Dropbox
  file routes; the app retains its own merge and conflict semantics. Builds
  without sync metadata never construct the adapter or contact Dropbox.
- **Bundled license notices**: esbuild prepends the complete Preact,
  `pwa-install`, and Dropbox SDK notices to the minified IIFE. Because the
  builder inlines that file, the notices remain in every distributed HTML.

### Test runner — `node --test` + happy-dom + tsx

- `node --test` is built into Node; CI uses Node 26 and runs TypeScript
  via `tsx`.
  No Jest/Vitest config surface, no transformer chain.
- `happy-dom` over `jsdom`: faster, lighter, runs in Node without a
  shim for `localStorage`/`SubtleCrypto` (we use both).
- Tests render real Preact into a happy-dom document — they exercise
  actual DOM output, not snapshot fixtures.

### CI/CD — GitHub Actions + GitHub Pages

- **Pages over a real host**: free, custom-domain-ready, and the
  deploy story is just "upload an artifact." No DNS rewriting, no
  CDN config, no SSL renewal.
- **Three-job workflow** (test → build → deploy): test gate prevents a
  broken parser from ever overwriting the live site. See
  `.github/workflows/refresh.yml`.
- **No scheduled build**: PRs get validation-only CI; merges and direct pushes
  to `main` test and deploy. Manual dispatches refresh selected API years and
  handle date-boundary spirit unlocks without spending minutes every night.

### Dependency management — Renovate

- Bot opens grouped non-major PRs weekly with a 14-day cooling-off
  window. Auto-merges when CI passes.
- Major bumps land as separate PRs labelled `major`, no auto-merge.
  TypeScript / esbuild / preact major jumps usually carry breaking
  changes worth a human read.
- **Mostly caret ranges**: the lockfile pins reproducible versions. The Dropbox
  SDK is exact-pinned because it handles credentials and provider transport;
  upgrades require an explicit reviewed package change.

## Mechanism

```mermaid
flowchart TD
  subgraph Build["Build (Python on CI)"]
    Fetch[Fetcher]
    Parse[Parsers]
    Tag[Tagger]
    Time[Time parser]
    Builder[SiteBuilder]
    Fetch --> Parse --> Tag --> Time --> Builder
  end

  subgraph Bundle["Client bundle (esbuild)"]
    SrcTSX[src/*.tsx]
    SrcTS[src/*.ts]
    Esb[esbuild]
    SrcTSX --> Esb
    SrcTS --> Esb
    Esb --> BundleJS[dist/bundle.js]
  end

  Builder --> Index[site/index.html]
  BundleJS --> Builder
  Template[templates/site.html] --> Builder
  Builder --> SW[site/sw.js]
  Builder --> Ver[site/version.txt]
```

## Failure modes & trade-offs

- **No backend = no per-user features**. Wishlist items like push
  notifications or live event updates would require infra we
  deliberately don't have. We accept that gap.
- **Stdlib-only Python locks us in to standard parsers**. If the
  upstream HTML structure changes, we patch regex; we don't pull in
  a beautifulsoup-shaped dep.
- **Preact gaps vs React**: rare bugs in third-party React libs that
  hit Preact's compatibility layer. We mostly write our own components,
  so this almost never bites.

## Code references

- `backend/pyproject.toml` — Python project / `playa` console script
- `client/package.json` — Node dependency list
- `client/esbuild.config.mjs` — bundler config
- `client/tsconfig.json` — TS strict flags
- `renovate.json` — bot schedule + grouping rules
