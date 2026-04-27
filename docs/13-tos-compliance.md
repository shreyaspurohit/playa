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
   + S3 archives + GIS data we may migrate to. Friendlier license,
   but adds explicit display + embargo requirements.

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
| Innovate §6.2 location embargo | When/if we migrate to the live API, gate per-camp `location` fields until the embargo lifts. Currently irrelevant since we use only the directory. |
| Innovate §7.2 trademark | App name "Playa Camps" avoids "Burning Man", "Black Rock City", "Decompression", "Playa Events". |
| Innovate §5.5 modification | Tags and calendar dates are app-side transformations. About modal labels both: *"tags are keyword-matched by this app — not from Burning Man Project"* + *"calendar dates come from a configured burn-week window."* |
| Innovate §2.3 permissions | GPS is opt-in and explained in the About modal. No camera, no notifications, no clipboard read. |

### Compliance checklist before any switch to Innovate API

These are gate-items, not nice-to-haves. CLAUDE.md tracks the same
list near the API migration section.

- [ ] §4 disclaimer in footer + About modal (already present)
- [ ] §6.2 location embargo wired into `Config.burn_start` /
      `burn_end` and gated in `SiteBuilder.load_camps` based on
      `datetime.now(tz=ZoneInfo("America/Los_Angeles"))`.
- [ ] §7.2 trademark — re-check if renaming.
- [ ] §5.3 republishing — using data in the app is fine; don't
      mirror as a standalone dataset.
- [ ] §5.5 modification — keep transformation labels current as
      the pipeline grows.
- [ ] §2.3 permissions — extend the GPS paragraph if we add camera
      / push.
- [ ] §9 revocation — `revocation-plan.md` has the runbook.
- [ ] `MIN_CAMPS` rail — never override below 500 in CI; protects
      against an empty-API fallback overwriting the last-good
      deploy.

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
- **Innovate API migration is gated**, not opportunistic. Don't
  flip endpoints until every checkbox above is closed.

## Code references

- `.gitignore` — public-code/private-data stance enforced here
- `data/denylist.txt` — committed list, takedown workflow target
- `backend/src/playa/builder.py::load_camps` — applies denylist
- `client/src/components/InfoModal.tsx` — About-modal disclaimer
  text + GPS permission language
- `client/src/components/Footer.tsx` — affiliate disclaimer +
  contact mailto
- `site/robots.txt` — `Disallow: /`
- `backend/src/playa/templates/site.html` — `noindex, nofollow,
  noarchive` meta
- `docs/revocation-plan.md` — the runbook
- `CLAUDE.md` "Official BM APIs + datasets (migration path)" —
  living checklist mirrored here
