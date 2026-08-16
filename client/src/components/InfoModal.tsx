// About & disclaimer modal + a "How to use" quick-reference tab.
// Directory-specific attribution, verification, and takedown guidance
// is shown only while the directory source is active. The required
// no-affiliation notice and general app information remain visible for
// every source.
import { useEffect, useRef, useState } from 'preact/hooks';
import { LS, SS, type Source } from '../types';
import { removeKey } from '../utils/storage';
import { clearCachedPassword } from '../utils/secureStore';
import { clearJournal } from '../hooks/useJournal';
import { forceRefresh } from '../utils/refresh';
import type { LocationReleasePolicy } from '../utils/embargo';
import type { SyncController } from '../hooks/useSync';
import { SyncSettings } from './SyncSettings';

interface Props {
  open: boolean;
  fetchedDate: string;
  contactEmail: string;
  source: Source;
  locationPolicy: LocationReleasePolicy;
  sync?: SyncController;
  /** File-import handler. Lives in App.tsx because picking, parsing,
   *  and dispatching needs access to the friends API + own nickname.
   *  This component just renders the button and calls the prop. */
  onImport: () => void;
  /** Opens the parent's ExportModal — picker UI for granular export.
   *  InfoModal closes itself first so the export modal isn't stacked
   *  underneath. */
  onExport: () => void;
  onClose: () => void;
}

type Tab = 'guide' | 'about';

const UNAVAILABLE_SYNC: SyncController = {
  available: false,
  connected: false,
  status: 'unavailable',
  message: '',
  lastSyncedAt: null,
  connect: async () => {},
  cancelConnect: () => {},
  syncNow: async () => {},
  disconnect: async () => {},
};

export function InfoModal({
  open, fetchedDate, contactEmail, source, locationPolicy,
  sync = UNAVAILABLE_SYNC, onImport, onExport, onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [tab, setTab] = useState<Tab>('about');
  const [refreshState, setRefreshState] = useState<'idle' | 'checking' | 'offline' | 'stale'>('idle');

  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    setRefreshState('idle');
    // Every open resets to About so the source-appropriate notice and
    // general app information are the first things a viewer sees.
    setTab('about');
  }, [open]);

  async function handleForceRefresh() {
    setRefreshState('checking');
    const outcome = await forceRefresh();
    if (outcome === 'offline') setRefreshState('offline');
    else if (outcome === 'stale') setRefreshState('stale');
  }

  function handleExport() {
    onClose();
    onExport();
  }

  const refreshLabel =
    refreshState === 'checking' ? 'Checking…'
    : refreshState === 'offline' ? 'Offline — kept cache'
    : refreshState === 'stale' ? 'Server propagating — try again'
    : 'Force refresh';

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  async function handleClearAll() {
    const msg = [
      'Clear all local data?',
      '',
      'This removes:',
      "  • starred camps, events, and art (across all data sources)",
      "  • your home camp + meet spots + imported friends' lists",
      "  • theme, map-layer, distance-unit, and last-viewed-tab preferences",
      "  • your private journal on this device (any Dropbox journal backup is kept)",
      "  • the password cached for this device",
      "  • the downloaded Ask model and search cache",
      ...(sync.available ? ["  • this device's Dropbox connection (the Dropbox backup is kept)"] : []),
      '',
      "You'll need to re-enter the password.",
    ].join('\n');
    if (!confirm(msg)) return;
    if (sync.connected) await sync.disconnect();
    // Future-proof clear: drop every LS key with our `bm-` prefix.
    // This covers all the global slots in `LS` (theme, nickname,
    // source, etc.) and every per-source slot like
    // `bm-favs/<source>`, `bm-fav-art/<source>`, the year-scoped
    // `bm-embargo-lift-acked/<year>`, and any future key we add
    // — without having to keep parallel lists in sync.
    //
    // Risk surface: only our keys use the `bm-` prefix; collisions
    // with other apps on the same origin are not a real concern
    // (this is a static single-page deploy).
    try {
      const toDrop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('bm-')) toDrop.push(k);
      }
      toDrop.forEach((k) => removeKey(k));
    } catch { /* private mode etc. — fall through to explicit removals */ }
    // Explicit removals as a fallback for the iteration path. Covers
    // every key declared in `LS` so a private-mode browser that
    // refused the iteration above still gets every known slot wiped.
    // Per-source variants (e.g. `bm-favs/api-2026`) won't be hit by
    // these bare-key calls — but in practice the iteration above
    // works on every browser we support; the explicit list is
    // belt-and-suspenders.
    removeKey(LS.favs);
    removeKey(LS.favEvents);
    removeKey(LS.favArt);
    removeKey(LS.hiddenDays);
    removeKey(LS.myCampId);
    removeKey(LS.meetSpots);
    removeKey(LS.nickname);
    removeKey(LS.sharedFavs);
    removeKey(LS.theme);
    removeKey(LS.infoSeen);
    removeKey(LS.source);
    removeKey(LS.legacyKeysMigrated);
    removeKey(LS.viewMode);
    removeKey(LS.eventCampReconciled);
    removeKey(LS.releaseNotesSeen);
    removeKey(LS.distanceUnit);
    removeKey(LS.mapLayers);
    removeKey(LS.syncBase);
    removeKey(LS.syncToken);
    removeKey(LS.syncDevice);
    // Wipes both the encrypted-blob in LS and the AES wrapping key
    // in IndexedDB so nothing identifying the unlock state survives.
    clearCachedPassword();
    // Legacy session-cached password slot (pre-LS migration) — drop it
    // too in case the user clicked Clear before ever loading the new
    // build that would have migrated it.
    try { sessionStorage.removeItem(SS.password); } catch {}
    // Drop the SW-managed image + Ask caches too — otherwise "clear all"
    // leaves thumbnails, vectors, and downloaded model/runtime bytes behind.
    // The legacy message name is kept so an older controlling SW still clears
    // the image cache during an upgrade. Fire-and-forget; reload supersedes.
    try {
      navigator.serviceWorker?.controller?.postMessage('CLEAR_IMAGE_CACHE');
    } catch { /* no SW or messaging blocked */ }
    // Delete the private journal database too (ADR 20 D12). Best-effort; the
    // reload supersedes. The Dropbox journal copy is intentionally kept.
    try { await clearJournal(); } catch { /* ignore */ }
    location.reload();
  }

  const takedownHref =
    `mailto:${contactEmail}` +
    '?subject=%5BBM%20Camps%5D%20Takedown%20request' +
    '&body=Camp%20name%3A%20%0ACamp%20URL%20on%20directory.burningman.org%3A%20%0A%0A' +
    'Please%20remove%20my%20camp%20from%20this%20site.%20Thanks.';

  return (
    <div
      class={'modal' + (open ? '' : ' modal-hidden')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-title"
      onClick={handleBackdrop}
    >
      <div class="modal-card">
        <div class="modal-head">
          <h2 id="info-title">
            {tab === 'guide' ? 'How to use Playa Camps' : 'About this site'}
          </h2>
          <button
            ref={closeRef}
            class="modal-close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >✕</button>
        </div>
        <div class="info-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'about'}
            class={'info-tab' + (tab === 'about' ? ' active' : '')}
            onClick={() => setTab('about')}
          >About &amp; disclaimer</button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'guide'}
            class={'info-tab' + (tab === 'guide' ? ' active' : '')}
            onClick={() => setTab('guide')}
          >How to use</button>
        </div>
        <div class="modal-body">
          {tab === 'guide' ? (
            <>
              <GuideTab />
              {sync.available && (
                <section class="guide-section">
                  <h3>Dropbox backup &amp; restore</h3>
                  <p>
                    From the About tab, connect Dropbox to merge this device
                    with a private cloud copy of your plans. Changes sync while
                    Playa Camps is open. The device stays connected until you
                    disconnect it or revoke Playa Camps access in Dropbox.
                  </p>
                </section>
              )}
            </>
          ) : (
            <AboutTab
              fetchedDate={fetchedDate}
              takedownHref={takedownHref}
              showDirectoryDisclaimer={source === 'directory'}
              showCurrentApiSchedule={source === `api-${locationPolicy.year}`}
              locationPolicy={locationPolicy}
              sync={sync}
              onForceRefresh={handleForceRefresh}
              onExport={handleExport}
              onImport={onImport}
              onClearAll={handleClearAll}
              refreshState={refreshState}
              refreshLabel={refreshLabel}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// === Guide tab =====================================================

export function GuideTab() {
  return (
    <>
      <p class="guide-intro">
        A quick tour. Everything here works offline once the page has
        loaded successfully with signal.
      </p>

      <section class="guide-section">
        <h3>1. Find camps and art</h3>
        <p>
          Search scans names, descriptions, events, and tags. Tap tag
          chips to narrow by theme (e.g., <em>yoga</em>, <em>bar</em>)
          &mdash; chips AND together. Tap <strong>☆</strong> on a card
          to star a camp, or on any event inside it; starring an event
          auto-stars its camp so it pins on the map. The{' '}
          <strong>★ Favorites</strong> toggle in the toolbar filters
          down to just the ones you starred, and can wipe them all at
          once.
        </p>
        <p>
          The <strong>🎨 Art</strong> tab works similarly for installations.
          Star a piece to keep it in your list and place it on the Map.
        </p>
      </section>

      <section class="guide-section">
        <h3>2. Find food</h3>
        <p>
          The <strong>🍽 Food</strong> tab groups meals and snacks by
          <strong> Serving now</strong>, <strong>Starting soon</strong>,
          <strong> Upcoming</strong>, and <strong>Hours not listed</strong>.
          Search by dish, camp, or dietary option, or tap food chips to narrow
          the list. Tap a row for details and star an event to add it to your
          upcoming picks and Schedule.
        </p>
        <p>
          <strong>📍 Near me</strong> keeps food at camps within roughly
          1&thinsp;km (~15&thinsp;min walk), including entries whose hours are
          not listed. Tap the active button again to restore your previous
          search and food filters and stop the location watch.
        </p>
      </section>

      <section class="guide-section">
        <h3>3. Build your schedule</h3>
        <p>
          The <strong>📅 Schedule</strong> tab lays every starred event
          out on a day-by-day calendar. Filter buttons at the top:
        </p>
        <ul class="guide-list">
          <li>
            <strong>⚡ Now</strong> &mdash; only events in the next 2h
            today.
          </li>
          <li>
            <strong>🕘 Hide past</strong> &mdash; removes events whose
            scheduled end time has already passed. Events happening now and
            events without a parseable time remain available.
          </li>
          <li>
            <strong>📍 Near me</strong> &mdash; only events at camps
            within ~1&thinsp;km of your GPS fix (~15&thinsp;min walk). Tap
            it again, or use <strong>Clear filters</strong>, to return to the
            full schedule and stop the location watch.
          </li>
        </ul>
        <p>
          Tap the 👁 beside an event to <strong>hide that occurrence</strong>
          from one day without removing the event from the rest of your week.
          You can reveal it later from that day's hidden section.
        </p>
      </section>

      <section class="guide-section">
        <h3>4. The map + GPS</h3>
        <p>
          The grid is clock-hours (2:00&ndash;10:00) &times; letter
          streets (Esplanade &rarr; K). Starred camps drop as pins;
          starred art, your home camp, friends' plans, and meet spots use
          distinct markers. Official layers add landmarks, safety resources,
          services, transport, toilets, and the city boundary. Tap a marker or
          list row to see its details and location.
        </p>
        <p>
          Tap <strong>Use my GPS</strong> (top of the Map tab) to
          opt in. You'll see:
        </p>
        <ul class="guide-list">
          <li>a <strong>dot</strong> for where you are,</li>
          <li>your current <strong>clock &amp; street address</strong> (e.g., <em>7:45 &amp; D</em>),</li>
          <li>a dashed <strong>arrow</strong> from your GPS position to any selected marker, with distance, compass bearing, and <strong>walk / bike ETA</strong>.</li>
        </ul>
        <p class="guide-subtle">
          Location access is optional. GPS is read in-page and stays on
          your device. Tap{' '}
          <strong>? Legend</strong> for a deeper read of the grid.
        </p>
      </section>

      <section class="guide-section">
        <h3>5. Plan rendezvous with friends</h3>
        <p>
          Set a <strong>nickname</strong> in the header pill so friends
          see who's sharing. On a camp card tap <strong>set as my
          camp</strong> to mark your home (shows up as a big teal tent
          on the map). On the Map tab hit <strong>+ Add</strong> to
          drop a meet spot, e.g.,{' '}
          <em>"Coffee at 9:00 &amp; C, Tue morning"</em>.
        </p>
      </section>

      <section class="guide-section">
        <h3>6. Share &amp; sync across devices</h3>
        <p>
          Three ways to move your plans around &mdash; pick the one
          that fits the situation. Share links carry only the items you select;
          file export/import preserves the fuller device snapshot, including
          hidden schedule occurrences and imported friends.
        </p>
        <ul class="guide-list">
          <li>
            <strong>Share</strong> &mdash; copies a URL with your plans
            in the fragment (<code>#share=&hellip;</code>). Send via
            iMessage / Signal / email. Whoever opens it gets a banner
            offering to import your plans as the friend named after
            your nickname. The URL <em>is</em> the data.
          </li>
          <li>
            <strong>Export</strong> &mdash; downloads a full JSON
            snapshot (nickname, camps, events, my camp, meet spots,
            hidden days, all imported friends). Use this for moving
            from phone to laptop, or sending a friend the whole
            thing over WiFi / AirDrop / email.
          </li>
          <li>
            <strong>Import</strong> &mdash; opens a JSON file and
            either restores your own state (when the nickname matches
            yours) or imports the file as a friend (when it doesn't).
            Re-importing the same person always prompts: replace
            with the latest snapshot, or ignore. Latest wins, so
            your lists stay fresh.
          </li>
        </ul>
        <p class="guide-subtle">
          Friends' pins, camps, and meet spots are tagged with their
          nickname in lists + on the map sidebar so you can see
          whose plans intersect yours at a glance.
        </p>
      </section>

      <section class="guide-section">
        <h3>7. Journal</h3>
        <p>
          The <strong>Journal</strong> tab is a private, text-only place for
          memories &mdash; before, during, and after the burn. Entries are saved
          on this device first and work fully offline; add one from the Journal
          tab or from any camp, event, or Food item (it remembers the name).
          Editing overwrites an entry and deleting removes it &mdash; there is no
          version history. Your journal stays available even if the site password
          is rotated later.
        </p>
        <p class="guide-subtle">
          Durability on iPhone: browser storage is cleared after about a week of
          not opening the site, so <strong>Add to Home Screen</strong> and, if you
          want a backup, <strong>Connect Dropbox</strong> from the Journal tab.
          Only entries that have synced to Dropbox or been exported are
          guaranteed to survive. When Dropbox is connected, your journal text is
          stored as readable JSON in the app's private Dropbox folder.
        </p>
      </section>

      <section class="guide-section">
        <h3>8. Install, scroll &amp; use offline</h3>
        <p>
          Open the top-right menu and tap <strong>Install app</strong> (Chrome /
          Android / Edge), or on iPhone open this page in Safari &rarr;{' '}
          <strong>Share &rarr; Add to Home Screen</strong>. After one
          full load with signal, the site works from your home screen
          with airplane mode on &mdash; including the map, schedule,
          GPS, your starred list, and art images that finished caching.
          Art images cache as you scroll and, to build a complete offline
          set, the whole collection also downloads quietly in the background
          while the open app is idle. That uses data, so leave it open on
          Wi-Fi before heading out.
        </p>
        <p class="guide-subtle">
          On phones, scrolling down hides the global header while keeping the
          current tab's essential controls available. Start scrolling back up
          to reveal the header and tabs again.{' '}
          The same top-right menu offers 5 themes. Stuck on an old build? See{' '}
          <strong>Force refresh</strong> on the About tab.
        </p>
      </section>
    </>
  );
}

// === About tab =====================================================

function formatReleaseTime(value: string): string {
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return 'the configured release time';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short',
  }).format(stamp);
}

function AboutTab({
  fetchedDate, takedownHref, showDirectoryDisclaimer,
  showCurrentApiSchedule, locationPolicy,
  sync, onForceRefresh, onExport, onImport, onClearAll,
  refreshState, refreshLabel,
}: {
  fetchedDate: string;
  takedownHref: string;
  showDirectoryDisclaimer: boolean;
  showCurrentApiSchedule: boolean;
  locationPolicy: LocationReleasePolicy;
  sync: SyncController;
  onForceRefresh: () => void;
  onExport: () => void;
  onImport: () => void;
  onClearAll: () => void | Promise<void>;
  refreshState: 'idle' | 'checking' | 'offline' | 'stale';
  refreshLabel: string;
}) {
  return (
    <>
      <p>
        <span class="warn">⚠ Unofficial &amp; best-effort</span>
        <span class="badge">Built for Burners, not commercial</span>
      </p>
      {showDirectoryDisclaimer && (
        <>
          <p>
            This is an unofficial personal project to help friends browse and
            filter the{' '}
            <a href="https://directory.burningman.org/camps/" target="_blank" rel="noopener">
              official Burning Man Playa Info directory
            </a>. All camp names, descriptions, events, and locations are the
            property of their respective camps and the directory operators.
          </p>
          <p>
            <strong>Provided as is.</strong> Camp details here can be stale,
            incomplete, mis-parsed, or mis-tagged.{' '}
            <strong>
              Always verify on{' '}
              <a href="https://directory.burningman.org/camps/" target="_blank" rel="noopener">
                directory.burningman.org
              </a>
            </strong>{' '}
            before acting on anything you see here. Use this tool to{' '}
            <em>narrow down</em> a shortlist of possible camps — not as the
            source of truth. The optional <strong>Ask</strong> feature finds
            camps, events, and art from a plain-English question, entirely on
            your device; its picks come from this same data — verify them the
            same way. The 🍄 is a nod to mycelial networks: decentralized and
            all-connected, which is how Ask works — no cloud, one search across
            every camp, event, and art.
          </p>
          <p>
            Data is fetched nightly from the public directory and shown here
            for personal browsing only. For the canonical, up-to-date
            listing, please use{' '}
            <a href="https://directory.burningman.org/camps/" target="_blank" rel="noopener">
              directory.burningman.org
            </a>. This site has{' '}
            <strong>
              no ads, no accounts, and no commercial purpose, and sets no
              cookies or tracking scripts of its own
            </strong>. Cloudflare and GitHub Pages, which serve it, process
            ordinary request metadata such as IP addresses and expose aggregate
            traffic statistics.
          </p>
          <p>
            <strong>Camp owner? Want your camp removed?</strong>{' '}
            <a href={takedownHref}>Email a takedown request</a> — please
            include the camp name and directory URL, and the entry will be
            removed on the next build.
          </p>
        </>
      )}
      <p>
        <strong>Search, Food, and scheduling:</strong> The Food tab groups
        matching meals and snacks by current availability; Schedule organizes
        starred events by day. Tags are generated from listing text, and event
        times are formatted against the configured burn-week calendar.
      </p>
      {!showDirectoryDisclaimer && (
        <p>
          This is a personal, non-commercial tool with no ads, no accounts, and
          no commercial purpose, and it sets no cookies or tracking scripts of
          its own. Cloudflare and GitHub Pages, which serve it, process ordinary
          request metadata such as IP addresses and expose aggregate traffic
          statistics.
        </p>
      )}
      {showCurrentApiSchedule && (
        <p>
          <strong>{locationPolicy.year} API location timing:</strong>{' '}
          Camp location is shown on {formatReleaseTime(locationPolicy.campReleaseAt)},
          and art location is shown on {formatReleaseTime(locationPolicy.artReleaseAt)}.
          Names, descriptions, schedules, favorites, and public GIS map layers
          remain available. Events use their camp’s location.
          {' '}<a
            href="https://innovate.burningman.org/apis-page/"
            target="_blank"
            rel="noopener"
          >Official annual API schedule</a>.
        </p>
      )}
      <p>
        <strong>Found a bug or a mis-parse?</strong>{' '}
        <a href="https://github.com/shreyaspurohit/playa/issues" target="_blank" rel="noopener">
          Open an issue on GitHub
        </a>{' '}— include the camp name and what looks wrong.
      </p>
      <p>
        <strong>Stored on this device:</strong> theme, an encrypted password
        cache, the camps and events you've starred, any days you've
        hidden on the schedule, your nickname + home camp + meet spots,
        and any friends' favorites you've imported via share link.
        {sync.available
          ? ' Nothing leaves your browser unless you explicitly connect Dropbox backup.'
          : ' Nothing leaves your browser.'}{' '}
        See <strong>Actions</strong> below to wipe it all.
      </p>
      <p>
        <strong>Privacy:</strong>{' '}
        <a href="./privacy.html">Read the Playa Camps Privacy Policy</a>{' '}
        for details about local storage, optional Dropbox backup, information
        the app does not sync, and how to disconnect or remove a cloud backup.
      </p>
      <p>
        <strong>GPS / location:</strong> location access is optional and begins
        only when you choose <strong>Use my GPS</strong> on Map or
        <strong> Near me</strong> on Schedule or Food. If granted, your GPS fix
        is read entirely in-page to filter nearby results and compute distance,
        bearing, and travel estimates. Tap an active
        Near me button again (or Clear filters in Schedule) to restore the full
        list and stop that location watch. Decline and every tab remains usable
        without location-aware features.
      </p>
      <p>
        <strong>Sharing favorites:</strong> the share URL carries your
        starred camps + events + nickname + home camp + meet spots in
        its fragment (<code>#share=…</code>). The data rides the URL
        fragment itself.
      </p>
      <p>
        <strong>Stuck on an old version?</strong> The site is cached
        aggressively so it works offline on playa. If a rebuild hasn't
        reached you, use <strong>Force refresh</strong> in Actions
        below. It asks the server for fresh bytes and then reloads;
        if anything fails along the way, the cached copy stays put
        and the site keeps working.
      </p>

      <SyncSettings sync={sync} />

      <h3 class="modal-section">Actions</h3>
      <div class="modal-actions">
        <button
          class="action-btn"
          type="button"
          onClick={onForceRefresh}
          disabled={refreshState === 'checking'}
          title="Re-fetches the shell from the server into the existing cache, then reloads. Non-destructive: a failed fetch keeps the old cache entry, so your page stays working."
        >
          <span class="action-label">{refreshLabel}</span>
          <span class="action-desc">
            Pull the latest build from the server. Safe offline —
            your cached copy stays intact if anything fails.
          </span>
        </button>
        <button
          class="action-btn"
          type="button"
          onClick={onExport}
          title="Download every camp, event, meet spot, hidden day, friend import, and your nickname as one JSON file. Pair with Import on another device for full transfer."
        >
          <span class="action-label">Export to file</span>
          <span class="action-desc">
            Requires a nickname. Save it with your camps, events,
            meet spots, hidden days, and imported friends.
          </span>
        </button>
        <button
          class="action-btn"
          type="button"
          onClick={onImport}
          title="Read a Playa Camps export. If the nickname matches yours, restores the snapshot. If it's from someone else, asks before overwriting."
        >
          <span class="action-label">Import from file</span>
          <span class="action-desc">
            Requires your nickname. Restore a snapshot to move state
            between devices — your phone, laptop, etc.
          </span>
        </button>
        <button
          class="action-btn danger"
          type="button"
          onClick={onClearAll}
          title="Deletes this device's Playa Camps state and disconnects Dropbox if enabled. The Dropbox backup itself is kept."
        >
          <span class="action-label">Clear all local data</span>
          <span class="action-desc">
            Remove favorites, hidden days, friends, preferences, and password
            from this device. The Dropbox backup is kept.
          </span>
        </button>
      </div>

      <p class="footnote">
        This app is not affiliated, endorsed, or verified by Burning
        Man Project. Updated {fetchedDate}.
      </p>
      <p class="made-by">
        Made by{' '}
        <a
          href="https://shreyas.purohit.dev/link/bio/v1"
          target="_blank"
          rel="noopener noreferrer"
        >Shreyas Purohit ↗</a>
      </p>
    </>
  );
}
