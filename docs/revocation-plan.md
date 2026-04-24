# Revocation + shutdown plan

What to do if Burning Man Project asks us to take the site down, or if
`directory.burningman.org` / `api.burningman.org` shuts off access to us.

The goal: comply quickly without deleting the project itself. `playa-camps`
stays on the author's resume as a portfolio artifact (architecture,
offline-first PWA, encrypted payload, BRC map rendering), just behind a
password gate that the public no longer has.

## Priorities, in order

1. **Stop serving fetched data to the public immediately.**
2. **Preserve the code + architecture** for personal/portfolio use.
3. **Preserve the most recent good build** in case the upstream source
   goes empty or degraded — don't let a broken fetch delete your last
   working deploy.
4. **Stop the nightly pipeline** so we're not refreshing against a
   directory that's asked us to stop.

## 1. Rotate the site password

Flip `SITE_PASSWORD` (the repo secret) to a new value. The site will
still deploy and still decrypt in-browser, but no one with the old
password gets in. Keep the new value for your own showcase use.

```
GitHub → repo → Settings → Secrets and variables → Actions
         → SITE_PASSWORD → Update secret
```

Trigger a rebuild (`Actions → Refresh camps directory → Run workflow`)
so the next deploy re-encrypts the payload with the new key. Anyone
still holding the old URL hits the gate; the gate rejects the old
password; nothing leaks.

**Why this is enough:** even if the old password somehow surfaces (via
browser history, a shared screenshot, a friend's note-app), it only
decrypts the *old* encrypted blob, which is no longer reachable — the
live `site/index.html` uses the new salt + key.

**What NOT to do:** don't delete the repo, don't rm -rf `site/`, don't
change the domain. That throws away the portfolio value unnecessarily.
The show-case angle is *the architecture + code*, not the camp data.

## 2. Stop the cron

Disable the scheduled workflow so we're not fetching (or API-calling)
every night against a source that has asked us to stop.

```
GitHub → repo → Actions → Refresh camps directory → "..." menu
         → Disable workflow
```

The last artifact stays live on Pages indefinitely — Pages doesn't
auto-expire deploys the way `actions/upload-artifact` does.

## 3. Never let an empty / broken fetch clobber a good deploy

The builder already refuses to produce `site/index.html` if fewer than
`MIN_CAMPS` (default 500) camps loaded. Rationale: parser breakage,
upstream directory reorg, ToS revocation, or end-of-year all show up
as "fetched 0–20 camps" — and if the build had succeeded with that,
CI's `actions/upload-pages-artifact` would then have replaced the
last-good deploy with a dead one.

With the sanity rail, CI aborts in the `build` job, `deploy` never
runs, the previous Pages artifact stays live. Self-healing: next day's
cron retries.

**Override** for intentional small-fixture work only:

```
MIN_CAMPS=0 python -m playa all
```

Don't set `MIN_CAMPS=0` in the GH Actions workflow secrets — that
defeats the safeguard in the one place it matters.

## 4. Archiving a known-good deploy (optional)

If you want a hard backup of the current live deploy — e.g., for
offline showcase, or before a high-risk refactor — download the
currently-deployed Pages artifact before running a new build:

```bash
# From a machine with gh CLI auth:
gh api /repos/<owner>/<repo>/pages/deployments \
    --jq '.[0].artifact_url' > artifact-url.txt
# Or use the Actions UI: latest successful "build" job → Artifacts →
# github-pages → Download
```

Archive the tarball somewhere durable (personal cloud storage, iCloud
Drive, etc). This is a belt-and-suspenders step. The live Pages deploy
is already the "last good" copy as long as step 3 is in effect.

## 5. If the ToS/API terms specifically require deletion

The Innovate API ToS (Section 9) says: "upon termination … you shall
immediately stop using the Event Data and any other information … and
promptly destroy all information and copies."

If that applies (we're using their API and they've revoked our key),
then password-rotate isn't enough — they want it *gone*. In that case:

1. Trigger a workflow run with `SITE_PASSWORD` set to a random string
   **and** with the deployed `site/index.html` replaced by a static
   takedown notice (hand-authored, committed to `site/` with a
   one-off workflow). The sanity rail needs to be bypassed for this
   specific emergency rebuild — add a `FORCE_EMPTY=1` short-circuit
   at that point, or just commit a one-off deploy.
2. Delete `data/pages/` from any machine you've run the fetch on.
3. Keep the repo + code (code is our IP, not theirs). Just remove
   fetched content.

This path only applies if the takedown is specifically about
**data**. If it's a general "please don't do this at all," password
rotation + cron disable covers it (no new data is fetched, no old
data is reachable).

## Checklist (keep short, follow in order)

- [ ] Rotate `SITE_PASSWORD` in repo secrets.
- [ ] Run `Refresh camps directory` workflow once so the new password
      takes effect.
- [ ] Verify the live site rejects the old password and accepts the
      new one.
- [ ] Disable the scheduled workflow.
- [ ] Note the date + trigger in this file's "History" section below.
- [ ] If required by a specific data-deletion request: run the
      static-notice deploy from §5 and wipe local fetch caches.

## History

*(Append an entry here each time this runbook runs.)*
