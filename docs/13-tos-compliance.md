---
title: ToS Compliance
date: 2026-04-27
status: current
---

# ToS Compliance

## Overview

Playa Camps re-uses public Burning Man data. Two terms-of-service
documents apply, depending on the source:

1. **`directory.burningman.org` ToS** — covers the HTML scrape we use
   today. Personal-use only, camp-text is camp-copyrighted.
2. **`innovate.burningman.org` API ToS** — covers the structured API
   + S3 archives + GIS data. The application now embeds configured
   `api-YYYY` snapshots, so its display, key-handling, transformation, and
   embargo requirements are active—not a future migration concern.

This doc is the central compliance record so a future maintainer
doesn't have to re-derive what's a hard rule vs. a nice-to-have.

The operational counterpart is the
[revocation runbook](./revocation-plan.md) — what to do if a
takedown lands.

## Decisions

### Public-code, private-data stance

The repo is public for portability and as a portfolio piece. The
camp content (which is per-camp copyrighted, NOT Burning Man's to
relicense) is **never committed to git**. `.gitignore` covers:

- `data/pages/*.json` — raw fetch
- `data/pages-backups/` — fetch snapshots from `make fetch`
- `data/meta.json`, `data/camps.csv`, `data/camps_tagged.csv` —
  derived
- `site/index.html`, `site/sw.js`, `site/version.txt` — built
  artifacts (encrypted or not, still derived from camp content)

Every CI run produces the artifact fresh and uploads it as a Pages
artifact; no commit. Takedowns become genuine deletions: add the
camp id to `data/denylist.txt`, the next build filters it out, the
old artifact is overwritten.

### Mitigations baked in

| Concern | Mitigation |
|---|---|
| §5 non-commercial use | No ads, no analytics, no tracking, no monetization, no accounts. About modal calls this out verbatim. |
| §6 camp-copyright on descriptions | Password gate narrows audience to friends; `noindex, nofollow, noarchive` keeps crawlers out; takedown mailto in footer + About modal. |
| §7(d) prohibited framing/linking | Each card carries a canonical "on directory ↗" link to the official entry, and the About modal reminds users to verify there. |
| Innovate §4 disclaimer | App carries the verbatim *"This app is not affiliated, endorsed, or verified by Burning Man Project"* in the footer + About modal. |
| Innovate §6.2 location embargo | Current-year API camp locations are client-masked until `CAMP_LOCATION_RELEASE_AT`; art locations independently remain masked until `ART_LOCATION_RELEASE_AT`. Directory and past years are unaffected. Spirit-mode remains masked; trusted god-mode may bypass for internal testing by explicit operator decision. |
| Innovate §7.2 trademark | App name "Playa Camps" avoids "Burning Man", "Black Rock City", "Decompression", "Playa Events". |
| Innovate §5.5 modification | Tags and calendar dates are app-side transformations. About modal labels both: *"tags are keyword-matched by this app — not from Burning Man Project"* + *"calendar dates come from a configured burn-week window."* |
| Innovate §2.3 permissions | GPS is opt-in and explained in the About modal. No camera, no notifications, no clipboard read. |

### Active Innovate compliance checklist

These are gate-items, not nice-to-haves. CLAUDE.md tracks the same
list near the API migration section.

- [x] §4 disclaimer in footer + About modal for every source.
- [x] §6.2 camp and art location masking wired to their separate,
      timezone-aware annual timestamps in `client/src/utils/embargo.ts`.
      The current-year API build fails if either value is missing, naive,
      reversed, or belongs to another `BRC_MAP_YEAR`; future API years fail
      closed in the client. `BURN_WINDOW_OPEN_FROM` is not a disclosure gate.
      Client masking and the trusted internal bypass are documented accepted
      risk, not hard confidentiality.
- [x] §7.2 trademark — re-check if renaming.
- [x] §5.3 republishing — using data in the app is fine; don't
      mirror as a standalone dataset.
- [x] §5.5 modification — keep transformation labels current as
      the pipeline grows.
- [x] §2.3 permissions — extend the GPS paragraph if we add camera
      / push.
- [x] §9 revocation — `revocation-plan.md` has the runbook.
- [x] `MIN_CAMPS` rail — never override below 500 in CI; protects
      against an empty-API fallback overwriting the last-good
      deploy.

### Source-specific disclosure rules

- The exact Innovate §4 no-affiliation sentence, transformation labels, and
  non-commercial/no-tracking statement render for every source.
- Directory attribution, “verify on directory” guidance, canonical directory
  links, and directory camp-owner takedown wording render only while
  `directory` is selected.
- The visible source must be resolved from sources actually unlocked by the
  current password before these disclosures render; a stale persisted
  `directory` choice must not flash directory copy to an API-only user.

### Accepted operator decisions

- Tags are app-generated keyword overlays and event times are normalized for
  presentation. Source descriptions and event text are not rewritten. The
  About modal identifies both transformations; the operator accepts remaining
  interpretation risk under §5.5.
- Raw current-year API locations remain in encrypted payloads so the deployed
  app can reveal them after the cutoff. `god-mode` wrappers can be marked
  trusted to bypass client masking for internal testing. Spirit-mode users do
  not receive that bypass. This is intentional accepted risk; do not broaden it.

## Mechanism

### Takedown flow

```mermaid
sequenceDiagram
  participant Camp as Camp owner
  participant Owner as Site owner
  participant Repo
  participant CI
  participant Site

  Camp->>Owner: emails CONTACT_EMAIL with camp name + URL
  Owner->>Repo: append camp id to data/denylist.txt
  Owner->>Repo: git push
  Note over CI: nightly cron OR manual dispatch
  CI->>CI: SiteBuilder.load_camps filters denylisted ids
  CI->>Site: deploy site/index.html
  Note over Site: camp gone from new artifact;<br>no git history to unwind because<br>data was never committed.
```

### What we do NOT do

- **No re-export of the dataset.** We don't publish a standalone
  CSV or JSON dump of the camps. The data is read inside the app
  only.
- **No bulk-republish.** Sharing happens at user-fav granularity
  (a list of starred ids), not "here's everyone's directory."
- **No social graph.** The app has no notion of public usernames,
  friend invites, or anything that creates a discoverability
  surface.

## Failure modes & trade-offs

- **Residual §6 risk**: encrypted-but-readable camp text still
  exists in the password-gated artifact. Mitigated by the password
  gate, takedown workflow, and the no-public-indexing posture, but
  not eliminated.
- **Audience drift**: the password being shared with friends-of-
  friends could blow the "personal use" stance over time. Owner's
  job to rotate occasionally; runbook in `revocation-plan.md`.
- **API safeguards can regress during UI/source changes.** Keep the checklist
  closed, verify both directory and API-only unlocks, and treat any new source
  or transformation as requiring another disclosure/embargo review.

## Code references

- `.gitignore` — public-code/private-data stance enforced here
- `data/denylist*.txt` — committed IDs for directory/API camps/art
- `backend/src/playa/sources/directory.py` and `sources/api.py` — apply
  source-family denylists
- `client/src/components/InfoModal.tsx` — About-modal disclaimer
  text + GPS permission language
- `client/src/components/Footer.tsx` — affiliate disclaimer +
  contact mailto
- `site/robots.txt` — `Disallow: /`
- `backend/src/playa/templates/site.html` — `noindex, nofollow,
  noarchive` meta
- `docs/revocation-plan.md` — the runbook
- `CLAUDE.md` "Official BM APIs + datasets" —
  living checklist mirrored here
