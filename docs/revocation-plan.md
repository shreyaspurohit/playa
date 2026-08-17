# Event Data Revocation and Shutdown Plan

**Last reviewed:** 2026-08-16

Use this runbook when Burning Man terminates or discontinues API/Event Data
access, revokes the key, or directs the operator to stop using or destroy the
data. Termination is a deletion event. Do not keep serving a last-known-good
snapshot.

## Immediate sequence

1. Disable push-triggered and manual data-refresh/deploy workflow runs.
2. Revoke or rotate the API key and remove `BM_API_KEY` from GitHub Actions.
3. Replace the live deployment with a data-free shutdown page, or disable Pages
   entirely. Confirm that `index.html`, semantic vectors, and worker responses
   expose no Event Data.
4. Delete every `data-api-YYYY` GitHub Release and its assets/tags.
5. Delete pre-shutdown Pages/build artifacts from Actions runs.
6. Delete Actions caches containing semantic embedding vectors. The standalone
   Transformers model cache contains no Event Data and may remain.
7. Purge Cloudflare's cache for `playa.purohit.dev` so cached HTML, workers, and
   vectors are not served at the edge.
8. Delete local `data/api/`, `data/embeddings/`, generated site artifacts,
   downloaded Actions artifacts, archives, screenshots, and other copies under
   the operator's control.
9. Record what was removed, when, and why without copying source records into
   the incident log.

## Verification

- The public URL is disabled or serves only the data-free shutdown page.
- No Release named `data-api-YYYY` remains.
- No retained Actions artifact contains an old Pages build.
- No semantic cache from the data-bearing namespace remains.
- A repository and workstation scan finds no local Event Data copies.
- Push-triggered or manual builds cannot silently recreate or redeploy a snapshot.

## Offline limitation

Previously installed offline clients may retain an encrypted service-worker
cache until they reconnect. A replacement worker should delete the old shell,
image, and Ask-vector cache namespaces during activation. This cannot erase an
offline device remotely; document that limitation in the incident record.

## Scope boundaries

Public git history and third-party clones remain unchanged because Event Data
was never intentionally committed. Source-independent code, annual GIS review
notes, and the Transformers model cache can remain unless the termination notice
says otherwise.
