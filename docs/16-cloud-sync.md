---
title: Optional Dropbox sync of user state
date: 2026-08-08
updated: 2026-08-13
status: current
---

# Optional Dropbox sync of user state

## Overview

Playa Camps is an offline-first static PWA. User state normally remains in
`localStorage`; JSON export/import and share links remain the account-free,
fully offline transfer paths. An operator may additionally enable **opt-in
Dropbox backup and restore** so a user's plans converge across devices and
browsers.

Dropbox stores one readable `playa-sync.json` file inside the app's private App
folder. The document contains IDs, preferences, nickname, home/meet spots, and
imported-friend state—not camp source text, the site password, GPS, simulated
GPS/time, or any access-tier key. A last-write-wins element set plus tombstones
propagates removals instead of resurrecting every unstarred item.

The default build remains fully local. No sync UI or Dropbox configuration is
emitted unless both build variables in D1 are configured.

## Requirements

| Requirement | Decision |
|---|---|
| State | All seven per-source user keys plus four global preferences (D8) |
| Restore | First connection safely unions sets and fills/restores cloud values |
| Deletes | Newer tombstones propagate unstars/removals (D7) |
| Provider access | Dropbox **App folder**, never full Dropbox |
| Backup form | Readable JSON in the user's app-private folder |
| Offline behavior | Local app remains fully usable; foreground sync catches up later |
| Operator burden | No email allowlist; Dropbox Development status supports friends-scale use |

## Decisions

### D1 — Build-gated and absent by default

`SYNC_PROVIDER=dropbox` and the public OAuth App key in `SYNC_CLIENT_ID` flow
through `Config.from_env()` → `SiteBuilder` → opt-in `bm-sync-*` metadata.
`refresh.yml` reads both from repository **variables**, not secrets. The client
only constructs the Dropbox adapter and renders its controls when all metadata
is present.

When unset, `SiteBuilder._sync_meta()` returns an empty string and the
application makes no provider request. The locally bundled SDK necessarily
contains its endpoint strings even in an unconfigured single-IIFE build, but no
adapter is constructed and no sync UI or network behavior is enabled. This
preserves the original offline/local-only behavior for normal builds.

### D2 — Provider-independent merge engine

The Dropbox adapter only owns authorization and file transport:

```ts
interface SyncBackend {
  authorize(): Promise<void>;
  isConnected(): Promise<boolean>;
  readFile(): Promise<{ text: string | null; revision: string | null }>;
  writeFile(text: string, revision: string | null): Promise<string>;
  disconnect(): Promise<void>;
}
```

`syncDoc.ts` owns schema validation, local-to-operation translation, merge,
tombstone retention, baseline persistence, and application back to
`localStorage`. `syncEngine.ts` composes those pieces. A future provider adapter
can reuse both without changing conflict semantics.

### D3 — Dropbox implemented; other providers remain future fallbacks

Dropbox was chosen because App-folder access meets least privilege, friends can
consent without the operator maintaining an email allowlist, and its browser
PKCE flow can issue a durable refresh token. Google Drive `appDataFolder` is a
[non-sensitive scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
and does not by itself require OAuth verification—this corrects an earlier
draft—but Google's
[browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
is short-lived and requires a new user-driven token request after expiry. OneDrive `approot` and
other storage providers remain possible future adapters; none is implemented
today. Dropbox currently permits up to 500 linked users in Development, but
after the 50th link there is a two-week window to receive production approval
before additional linking is frozen (Dropbox's
[production-approval guide](https://www.dropbox.com/developers/reference/developer-guide#production-approval)).

### D4 — App-folder scope only

Create the Dropbox application with access type **App folder** and enable
`files.content.read` plus `files.content.write`. `/playa-sync.json` is relative
to that private app root. Playa Camps cannot enumerate or access the user's
other Dropbox files.

### D5 — Official SDK, PKCE, and a wrapped offline session

The client uses the official MIT-licensed
[Dropbox JavaScript SDK](https://github.com/dropbox/dropbox-sdk-js), pinned to
an exact reviewed version and bundled locally by esbuild. No runtime CDN script
is loaded. The SDK owns OAuth token exchange/refresh and generated file-route
calls; Playa Camps retains its provider-independent merge engine and
app-specific safety policy.

- A direct Connect gesture uses one of two authorization paths (see D13): a
  popup on desktop/tab browsers, or a same-tab full-page redirect when running
  as an installed/standalone PWA. Both navigate to Dropbox with an SDK-generated
  S256 verifier/challenge and an app-generated random `state`.
- Authorization requests `token_access_type=offline` and only
  `files.content.read files.content.write`.
- Dropbox redirects the popup to the same deployed path. A tiny pre-Preact
  callback in `site.html` relays `{code,state,error}` via both same-origin
  `postMessage` and a same-origin `BroadcastChannel`. The channel survives
  privacy-browser/COOP isolation that can sever `window.opener` during the
  cross-origin Dropbox visit.
- The original tab verifies message origin plus popup identity on the direct
  path, and exact unguessable state on both paths, before exchanging the code.
  It does not continuously poll `popup.closed`, because an isolated but
  still-open popup can appear closed through its severed `WindowProxy`. When
  the popup returns focus to the original tab, the client performs one delayed
  close check. That check includes a callback-delivery grace period because
  focus can return before `postMessage` or `BroadcastChannel` is delivered.
  As a durable fallback, the callback also writes `{code,state,error,at}` to a
  state-scoped `localStorage` key (`bm-sync-oauth-result/<state>`) just before
  the popup closes; if both messages race past the grace window, the close
  check recovers the code from there instead of misreporting a cancel. The key
  is scoped by the attempt's random `state` so two tabs authorizing at once
  never clobber each other, is cleared as soon as it is consumed (or when the
  wait settles), and stale records are swept once past the five-minute timeout.
  The `bm-` prefix means "Clear all local data" also removes any abandoned one.
  This is the only Dropbox value that touches plaintext `localStorage`: a
  single-use, PKCE-bound authorization code with a five-minute lifetime, not a
  token — it is useless without the SDK-held `code_verifier` and grants nothing
  on its own once exchanged.
  While authorization or the first sync is pending, the Dropbox row/settings
  action also provides explicit cancellation: it aborts the callback listener,
  closes the reachable popup, invalidates stale sync completion, and removes a
  just-saved wrapped session before best-effort revocation. This permits an
  immediate clean retry without waiting for the five-minute safety timeout.
- Callback mode never executes the application bundle. It closes after the
  handoff, or shows only a small completion message if the browser refuses to
  close it, so it cannot become a second password-gated Playa Camps session.
- The short-lived access token, expiry, and long-lived refresh token are
  AES-GCM wrapped using the same non-extractable IndexedDB device key as the
  cached site password. No Dropbox **access or refresh token** ever appears as
  plaintext in `localStorage`. (The only plaintext value is the transient,
  single-use authorization code in the state-scoped OAuth handoff described
  above, which is not a token and expires within five minutes.)
- Before file requests, the SDK refreshes an expired/nearly expired access token
  with the public App key and refresh token. A static browser client never
  receives or embeds the Dropbox App secret; PKCE replaces that secret for the
  authorization-code exchange.
- Disconnect clears the local wrapped session first, then best-effort revokes
  the Dropbox token. Revocation or an invalid refresh grant clears the session
  and asks for one reconnect; local plans remain untouched and usable.
- Access-only sessions created by the pre-SDK implementation remain readable
  until their short-lived token expires, then reconnect once to obtain the new
  offline session.

### D6 — Sync schema (`playa-sync.json`, `playa-sync-v1`)

```ts
interface SyncDoc {
  schema: 'playa-sync-v1';
  updatedAt: number;
  deviceId: string;
  sets: Record<string, Record<string, { t: number; del?: 1 }>>;
  registers: Record<string, { t: number; v?: unknown; del?: 1 }>;
}
```

- `sets`: `favs/<source>`, `favEvents/<source>`, `favArt/<source>`, and
  `hiddenDays/<source>`. Active entries omit `del`; removals are tombstones.
- `registers`: global `nickname`, `theme`, `distanceUnit`, `mapLayers`;
  per-source `myCampId/<source>`; one content-addressed register per personal
  rendezvous under `meetSpot/<source>/<id>`; and one encoded register per
  imported friend under `sharedFavs/<source>/<encoded-name>`.
  Removed friends use register tombstones.

The downloaded file is untrusted. `parseSyncDoc` enforces a 5 MB cap, exact
schema, finite timestamps, key/item caps, source/ID formats, prototype-sentinel
rejection, nickname control/bidi rejection, and exact nested shapes for
friends, meet spots, themes, distance units, and map layers. An invalid cloud
file aborts without changing or uploading local state.

### D7 — Baseline-derived soft deletes

The last successfully merged document is stored in `bm-sync-base/v1`. Local UI
hooks stay Set-based. Before sync, `localToSyncDoc` compares current state with
that baseline:

- present now, absent/deleted before → timestamped add;
- absent now, active before → timestamped tombstone;
- unchanged → retain the previous timestamp.

Merge picks the higher timestamp. Exact add/delete ties prefer active to avoid
data loss; two unequal active register values with the same timestamp use a
stable canonical-value ordering so merge remains commutative. Tombstones older
than 90 days are garbage-collected.

If the baseline is missing—a new browser or after Clear all local data—the
first sync infers **no deletions**. Local active set items and distinct personal
meet spots are unioned with remote items; identical normalized meet spots
deduplicate. Absent/default local registers do not overwrite remote ones. Once
a baseline exists, removing a meet spot creates a per-spot tombstone just like
unstarring an item. The original whole-array `meetSpots/<source>` representation
is migrated on read. This is the safe restore direction: a wiped device cannot
erase a good backup. A device offline longer than the 90-day tombstone window
may resurrect an old item; that bounded trade-off is accepted for v1.

The older pre-multi-source localStorage layout is upgraded before sync: bare
directory keys are copied, never moved, into their `/directory` slots. First
Dropbox connection reads those migrated slots and does not infer deletions.
Regression coverage exercises the complete old-layout refresh → first connect
→ clean-browser restore path for favorites, events, imported friends, home
camp, meet spots, hidden occurrences, and global preferences. Keys outside the
sync allowlist are not removed or rewritten by connecting Dropbox.

### D8 — Synced and device-local fields

Synced across every discovered/embedded source:

- `favs`, `favEvents`, `favArt`, `hiddenDays`;
- `sharedFavs`, `myCampId`, `meetSpots`;
- global `nickname`, `theme`, `distanceUnit`, `mapLayers`.

Never synced: cached site password, Dropbox token, active source/tab, one-shot
UI/release/embargo flags, service-worker caches, access-tier DEKs, live GPS,
mock GPS, and mock time.

### D9 — Revision-checked write before apply/reload

One sync cycle:

1. Download `/playa-sync.json` and its Dropbox `rev` (missing file = empty).
2. Read the baseline and translate local changes into timestamped operations.
3. Merge local and remote documents.
4. If the merged document differs, upload using Dropbox
   `WriteMode.update(rev)`, `autorename:false`, and `strict_conflict:true`
   (new file uses `add`). An unchanged foreground check performs no write.
5. On 409, re-download/re-merge/retry, up to three attempts.
6. Save the merged baseline.
7. Apply merged active values/tombstones to `localStorage`.
8. Reload only when local values actually changed.

Uploading and saving the baseline before reload avoids a half-recorded restore.

### D10 — Foreground/opportunistic sync

There is no backend and no authenticated service-worker background job. While a
valid Dropbox session exists, sync runs:

- immediately after Connect (backup or restore);
- on app open, focus, or return online;
- 1.5 seconds after a synced local key changes;
- when another tab changes a synced key (`storage` event);
- when the user taps **Sync now**.

`storage.ts` dispatches an additional same-tab custom event after safe writes,
because the platform `storage` event only fires in other tabs. Offline failures
surface as status only; they never block local writes.

When Dropbox sync is configured, the top-right menu includes a prominent
**Dropbox sync** row with the official blue Dropbox glyph and a concise
connection state. The glyph and Dropbox name identify only the Dropbox
integration, as required by Dropbox's developer branding guidance; they are
not used as the Playa Camps app identity or as an endorsement claim.

The row is state-aware: while the encrypted saved session is being restored it
is disabled and says **Checking saved connection…**; when connected it runs
**Sync now** in place and never invokes OAuth; when genuinely disconnected or
expired it opens a focused **Dropbox sync** modal—not the general About modal.
Authorization can begin only from the explicit **Connect Dropbox** or
**Reconnect Dropbox** button there. **About & disclaimer** retains the longer
**Dropbox backup & restore** explanation, including that the feature keeps
plans aligned across devices, browsers, and tabs. Unconfigured builds omit the
row and modal with the rest of the sync UI (D1).

### D11 — Plaintext content, wrapped credential

Per owner decision, `playa-sync.json` is readable JSON in the user's private
Dropbox app folder. Optional content encryption is future work: it adds a
separate passphrase/recovery problem for relatively low-sensitivity plan data.
The Dropbox access and refresh tokens are different—they grant access—so both
are always wrapped at rest (D5).

### D12 — Manual transfer remains supported

Cloud sync does not replace JSON export/import or fragment share links
([09-share-and-import.md](./09-share-and-import.md)). Those remain available
offline, require no Dropbox account, and are the recovery path if provider auth
is unavailable.

### D13 — Hybrid popup / redirect authorization

The popup relay in D5 works in ordinary browser tabs and in desktop/Android
installed PWAs, but **not** in an iOS "Add to Home Screen" standalone app. There,
`window.open` to Dropbox escapes the app's isolated web view into Safari — a
separate process and storage partition — so neither `window.opener.postMessage`
nor the same-origin `BroadcastChannel` can hand the code back, and the original
context times out. The app manifest declares `display: standalone` plus
`apple-mobile-web-app-capable`, so this is the common iPhone install.

Connect therefore chooses at click time:

- **Not standalone** → the D5 popup flow, unchanged. `state` is prefixed `pc_`.
- **Standalone display-mode** (`isStandaloneDisplay()`, shared with the install
  UI) → a **same-tab full-page redirect**. Cross-origin *top-level* navigation
  stays inside the standalone web view and returns to app scope, which popups do
  not. `state` is prefixed `pcr_`.
- **Popup blocked** (`window.open` returns null) on a non-standalone browser →
  fall back to the redirect flow rather than failing, so a blocked popup is never
  a dead end.

Redirect mechanics:

- Because the full navigation destroys the in-memory `DropboxAuth`, the PKCE
  `code_verifier`, `state`, and redirect URI are persisted to `localStorage`
  (`bm-sync-auth/v1`) **before** leaving, and restored on return via
  `setCodeVerifier`. The verifier is single-use, short-lived, and cleared
  immediately after the exchange (or on TTL expiry); it never leaves the device.
- Dropbox returns to the deployed path with `?code&state`. The `pcr_` prefix does
  **not** match the popup relay's `indexOf('pc_') === 0` guard, so the pre-Preact
  callback in `site.html` ignores it and the application bundle boots normally.
- On boot, `useSync` detects the pending redirect, verifies exact `state`, strips
  the query with `history.replaceState` before the exchange (so a refresh cannot
  replay it), swaps the code for the same wrapped offline session as D5, then runs
  a normal sync. Completing the exchange needs only the stored verifier, not the
  decrypted payload, so it works whether or not the password gate is showing.

Trade-off: the redirect path reloads the app (state is in `localStorage`, so
nothing is lost) instead of keeping the popup's in-place UX. It is chosen only
when the popup path cannot deliver the code.

## Failure modes and trade-offs

- **Token expiry:** refreshes automatically. Revocation or an invalid refresh
  token asks for reconnect; local data and cloud file remain safe.
- **Offline/Dropbox unavailable:** local use continues; next foreground trigger
  retries convergence.
- **Concurrent writers:** revision conflict re-downloads and merges; it never
  creates an auto-renamed conflicted copy.
- **Clock skew:** LWW uses `Date.now()`. A badly wrong device clock can resolve a
  conflict incorrectly. A hybrid logical clock is future hardening.
- **Tombstone retention:** more than 90 days offline can resurrect old state.
- **Dropbox user limit:** Development status is suitable for the friends-scale
  deployment. The operator must pursue production approval if it reaches the
  50-user review trigger; otherwise Dropbox freezes additional links after the
  two-week approval window (the Development ceiling is 500 linked users).
- **Clear all local data:** disconnects this device and removes local baseline,
  but deliberately keeps the Dropbox backup. Reconnect restores it safely.
- **Popup blockers/standalone PWA:** Connect must remain a direct user gesture.
  Standalone installs and blocked popups use the same-tab redirect flow (D13);
  the iOS home-screen app cannot complete the popup handoff at all.

## Deployment setup

1. Create a scoped Dropbox app with **App folder** access.
2. Enable `files.content.read` and `files.content.write`.
3. Set **Allow public clients (Implicit Grant & PKCE)** to **Allow**. Leave
   OpenID scopes unchecked; Playa Camps does not request identity information.
4. In Development status, click **Enable additional users** once. This opens
   OAuth consent to other Dropbox accounts; it is not a per-person allowlist
   and the operator does not add users individually.
5. Register exact redirect paths, normally `https://playa.purohit.dev/` and
   the chosen local preview URL (including its port/path).
6. Set repository variables `SYNC_PROVIDER=dropbox` and
   `SYNC_CLIENT_ID=<Dropbox App key>`.
7. Run/deploy a build, then complete the manual two-profile test below.

The build also emits a public, payload-free policy at
`https://playa.purohit.dev/privacy.html`. It is generated from
`backend/src/playa/templates/privacy.html` and contains no fetched camp data.
The policy reads the same local theme preference and uses the app's five theme
palettes. It is linked from both **About & disclaimer** and the main footer, and
is precached with the offline shell so the disclosure stays available after a
successful visit.

Recommended Dropbox Branding-tab metadata is intentionally explicit and
non-promotional:

| Field | Value / rule |
|---|---|
| App name | `Playa Camps Sync` (includes the product name; does not use Dropbox branding) |
| Publisher | The operator's truthful individual name or legal entity; do not invent an organization for review |
| Website | `https://playa.purohit.dev/` |
| Privacy policy | `https://playa.purohit.dev/privacy.html` |
| Icons | The same orange-tent Playa Camps artwork at 64 × 64 and 256 × 256; no Dropbox imagery |

Suggested description:

> Playa Camps is a private, non-commercial, offline-first planning app for
> Burning Man participants. Users may connect their own Dropbox account to
> back up and restore favorites, events, meeting plans, and preferences across
> devices. The app accesses only its dedicated App Folder and one JSON backup;
> it cannot access other Dropbox files, and no Playa Camps server receives the
> data. Users can disconnect or delete the backup at any time. Playa Camps is
> independent and is not affiliated with or endorsed by Dropbox or Burning Man
> Project.

The App key is a public OAuth client identifier. Never add an App secret; a
static browser client cannot protect one.

For local preview, repository variables are not available. Add the same public
configuration to the gitignored root `.env`:

```dotenv
SYNC_PROVIDER=dropbox
SYNC_CLIENT_ID=<Dropbox App key>
```

Register `http://localhost:8080/` as an exact Dropbox redirect URI, run
`make rebuild`, then `make preview`. Open the top-right information menu,
select **About & disclaimer**, and find **Dropbox backup & restore** immediately
above **Actions**. A browser refresh alone cannot enable a build that was
generated without the sync metadata.

## Verification

Automated coverage includes:

- CRDT commutativity/idempotence/tie behavior, tombstone propagation and GC;
- safe missing-baseline restore, full field application, and invalid-file
  rejection;
- optimistic Dropbox conflict retry;
- offline PKCE authorize parameters, least-privilege scopes, and build-config gating;
- SDK download/upload routing, revision extraction, and strict update mode;
- refresh-token exchange with the App key and no App secret;
- backend validation/meta emission; default builds emit no provider metadata;
- the 390 × 844 mobile menu + dedicated Dropbox-modal captures, branded
  Dropbox-row and horizontal-overflow assertions, explicit rejection of the
  About dialog, and 44 px minimum sync targets in the reusable visual-review
  helper.

Before enabling production variables, manually test with two browser profiles:

1. Profile A connects, stars items, sets preferences/home/meet spots, Sync now.
2. Profile B connects and confirms immediate restore.
3. A unstars/removes an item; B focuses or taps Sync and confirms deletion.
4. Make concurrent changes and confirm union/LWW behavior without a conflicted
   Dropbox copy.
5. Go offline, make changes, return online, confirm catch-up.
6. Revoke the app in Dropbox, confirm Reconnect while local use remains intact.
7. Confirm an unconfigured build shows no Dropbox controls or traffic.

## Code references

- `client/src/utils/syncDoc.ts` — schema, validation, baseline, merge, apply.
- `client/src/sync/SyncBackend.ts` — provider interface and typed errors.
- `client/src/sync/dropboxBackend.ts` — official SDK wrapper, PKCE, and secure session persistence.
- `client/src/sync/syncEngine.ts` — read/merge/write/retry/apply transaction.
- `client/src/hooks/useSync.ts` — foreground triggers and UI state.
- `client/src/components/SyncSettings.tsx`, `SyncModal.tsx`, and
  `InfoModal.tsx` — focused menu flow plus the longer About explanation.
- `client/src/utils/secureStore.ts` — generic AES-wrapped values.
- `client/src/utils/storage.ts` — same-tab change notification.
- `backend/src/playa/config.py`, `builder.py`, `templates/site.html`, and
  `.github/workflows/refresh.yml` — opt-in build plumbing and OAuth callback.
