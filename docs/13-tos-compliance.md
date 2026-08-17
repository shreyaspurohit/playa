# API and GIS Terms Compliance

**Status:** Accepted
**Last reviewed:** 2026-08-16

## Overview

The app uses annual Event Data snapshots from the keyed Burning Man API and
official annual GIS files. It is a free, personal, non-commercial tool for
participants. The code is public; Event Data, derived vectors, deployed builds,
and API keys are not committed.

The controlling source is the current
[Terms of Service for Burning Man APIs and Datasets](https://innovate.burningman.org/terms-of-service-for-burning-man-apis-and-datasets/).
Those terms can change without notice, so review them before each annual data
refresh and record the review date here.

## Decisions

### Event Data stays outside git

- `data/api/YYYY.json` is local or restored from an encrypted GitHub Release.
- `site/index.html`, `site/embeddings.json`, generated service workers, and
  embedding working files are gitignored.
- CI builds on an ephemeral runner and deploys a Pages artifact.
- A password gate, crawler exclusion, and encryption narrow the audience but do
  not replace the terms obligations.

### Non-commercial use is absolute

The app is free, carries no advertising or commercial branding, has no paid
access, and is not used to promote unrelated events, products, or services.
The visible “Built for Burners, not commercial” notice documents this stance.

### The mandatory notice is exact

The Footer and About view must prominently render:

> This app is not affiliated, endorsed, or verified by Burning Man Project.

Do not paraphrase it. The surrounding copy says that the app uses an official
API snapshot, that it may be stale or incomplete, and that critical details
should be checked against current official Burning Man communications.

### Keys remain secret and app-specific

`BM_API_KEY` is a local environment value or GitHub Actions secret. It is never
embedded in the client, logged, committed, transferred, or used for another
application. Registration and contact information must remain accurate.

### Location confidentiality is enforced independently

Current-year camp and art locations can exist in encrypted snapshots before
public release. `CAMP_LOCATION_RELEASE_AT` and `ART_LOCATION_RELEASE_AT` are
timezone-aware release instants. Normal and spirit wrappers remain masked until
their respective instant. Only the named `god-mode` wrapper is trusted to bypass
the client mask for internal testing. This exception must not be broadened.

The About view discloses both release times, explains that events inherit camp
locations, and explains GPS permission and its on-device use.

### Source data is not distorted

Source descriptions and event text are not rewritten. The app adds search tags,
food classifications, formatted event times, and map projections; the About
view labels those transformations. Incorrect records should be corrected by a
new API snapshot or removed locally, never silently rewritten to imply that the
source said something else.

### Termination means deletion

If access is terminated or discontinued, stop API refresh and data-bearing
deployments immediately, remove Event Data from the live site, delete encrypted
Release snapshots and Actions artifacts/caches containing derived data, and
destroy local copies. Do not preserve or redeploy a last-known-good dataset.
Follow [revocation-plan.md](revocation-plan.md).

## Mechanism

The builder validates that every source is `api-YYYY`, that the current
`BRC_MAP_YEAR` is configured and primary, and that every tier names only a
registered source. Annual snapshots are decrypted once into a source snapshot
containing camps, events, art, and `fetched_at`. The primary snapshot timestamp
drives the visible freshness date; build time only versions the application
shell.

The UI has no record-level API links. It retains the privacy, GPS,
transformation, non-commercial, location-release, and mandatory affiliation
notices for every annual source.

## Failure modes and response

- Missing or revoked API key: do not work around it; stop refreshes.
- Missing configured snapshot: fail the build rather than promote an older year.
- Missing release timestamp: fail a current-year build rather than expose data.
- Terms change: pause refresh/deploy until the app is reviewed and updated.
- Data correction or removal request: remove the affected data without arguing
  against the request, then refresh from an authorized source when appropriate.

## Code references

- `backend/src/playa/sources/api.py`
- `backend/src/playa/builder.py`
- `backend/src/playa/config.py`
- `client/src/components/Footer.tsx`
- `client/src/components/InfoModal.tsx`
- `.github/workflows/refresh.yml`
- `docs/revocation-plan.md`
