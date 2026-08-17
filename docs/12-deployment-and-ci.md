# Deployment and CI

**Status:** Accepted
**Last updated:** 2026-08-16

## Overview

GitHub Actions validates pull requests. A merge or direct push to `main`, or an
operator dispatch, tests and builds the API-only PWA, uploads `site/` as a Pages
artifact, and deploys it to GitHub Pages. Cloudflare proxies the custom domain.
Event Data never enters git. There is no scheduled workflow.

## Workflow

The test job installs pinned Python/Node versions, restores npm dependencies,
and runs Python tests, typecheck, and client tests.

The build job:

1. Restores an exact-revision annual GIS cache.
2. Restores only the `ask-embeddings-v2` content-hash cache.
3. Downloads every configured encrypted `data-api-YYYY` Release asset.
4. Fails if a cache is missing unless that year was explicitly selected for a
   manual refresh.
5. Permits API fetch/replacement only for years explicitly selected by a manual
   `refresh_api_years` dispatch.
6. Resolves the password-free spirit window at build time.
7. Runs `python3 -m playa all`, which refreshes GIS best-effort and builds only
   from local annual snapshots.
8. Uploads `site/` with hidden files included.

The deploy job uses only `pages: write` and `id-token: write` to publish the
artifact. The build job has `contents: write` solely for encrypted Release
assets during explicit refreshes. Deploy/refresh runs share a non-cancelling
concurrency group so a push cannot interrupt a manual Release replacement.

## Required configuration

- Secret `BM_API_KEY`: used only during manual annual refresh.
- Secret `BM_CACHE_PASSWORD` (or `SITE_PASSWORD` fallback): encrypts/releases
  and decrypts annual snapshots.
- Secret `SITE_PASSWORD` or `SITE_TIERS`: browser data gate.
- Variable `BM_API_YEARS`: required annual snapshot list.
- Variable `BRC_MAP_YEAR`: current year and required member of that list.
- Variables `BURN_WINDOW_OPEN_FROM` / `BURN_WINDOW_OPEN_TO`: schedule calendar.
- Variables `CAMP_LOCATION_RELEASE_AT` / `ART_LOCATION_RELEASE_AT`: disclosure
  gates.
- Optional Dropbox and site-unlock variables documented in `CLAUDE.md`.

`SITE_TIERS` must contain only configured API sources. The conventional roles
are all-years trusted god, all-years normal demigod, and current-year-only
spirit. Invalid references fail the build.

## Deployment verification

- `bm-sources` contains only annual API names, current first.
- Visible `Updated` matches the primary cache timestamp.
- Spirit unlock exposes only current year; demigod/god expose all configured
  years; only god bypasses current-year location masks.
- The generated worker uses the current shell/vector cache namespaces and
  removes the retired namespaces on activation.
- The generated site contains no unsupported source IDs, old metadata names,
  record-level upstream links, or retired payload IDs.

## Failure modes and operations

- A missing Release blocks deployment and must be repaired by an explicit
  refresh, never an implicit fetch.
- With no schedule, `SITE_UNLOCK_START/END` take effect on the next push or
  manual dispatch. Operators must dispatch on the opening and closing dates if
  no code deployment will occur. Location-release timestamps and live schedule
  state are client-side and do not need a rebuild.
- GitHub Pages may briefly serve an older shell; version polling and force
  refresh handle propagation.
- Cloudflare needs no routine deployment step. After a data-source cutover or
  revocation, delete old Actions artifacts and semantic caches, deploy the
  replacement, then purge the custom hostname so stale edge objects cannot be
  served. See `revocation-plan.md`.

## Code references

- `.github/workflows/refresh.yml`
- `.github/workflows/ci.yml`
- `backend/src/playa/builder.py`
- `site/CNAME`
- `site/.nojekyll`
