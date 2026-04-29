// About & disclaimer modal + a "How to use" quick-reference tab.
// About is the default tab because the disclaimer ("unofficial, always
// verify against directory.burningman.org, takedown path") matters
// more to a first-timer than the feature walkthrough. The guide is
// one click away.
import { useEffect, useRef, useState } from 'preact/hooks';
import { LS, SS } from '../types';
import { removeKey } from '../utils/storage';
import { clearCachedPassword } from '../utils/secureStore';
import { forceRefresh } from '../utils/refresh';
import { buildSnapshot, downloadSnapshot } from '../utils/exportImport';

interface Props {
  open: boolean;
  fetchedDate: string;
  contactEmail: string;
  /** File-import handler. Lives in App.tsx because picking, parsing,
   *  and dispatching needs access to the friends API + own nickname.
   *  This component just renders the button and calls the prop. */
  onImport: () => void;
  onClose: () => void;
}

type Tab = 'guide' | 'about';

export function InfoModal({ open, fetchedDate, contactEmail, onImport, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [tab, setTab] = useState<Tab>('about');
  const [refreshState, setRefreshState] = useState<'idle' | 'checking' | 'offline'>('idle');

  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    setRefreshState('idle');
    // Every open resets to About — the disclaimer + takedown path
    // is the thing we want a first-time viewer to actually see.
    setTab('about');
  }, [open]);

  async function handleForceRefresh() {
    setRefreshState('checking');
    const outcome = await forceRefresh();
    if (outcome === 'offline') setRefreshState('offline');
  }

  function handleExport() {
    downloadSnapshot(buildSnapshot());
  }

  const refreshLabel =
    refreshState === 'checking' ? 'Checking…'
    : refreshState === 'offline' ? 'Offline — kept cache'
    : 'Force refresh';

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleClearAll() {
    const msg = [
      'Clear all local data?',
      '',
      'This removes:',
      "  • your favorited camps and events (across all data sources)",
      "  • your theme preference",
      "  • the password cached for this tab",
      '',
      "You'll need to re-enter the password.",
    ].join('\n');
    if (!confirm(msg)) return;
    // Per-source LS keys live under `<base>/<source>`. Iterate all
    // localStorage keys and remove anything whose prefix matches one
    // of our scoped bases — covers `directory`, `api-2024`, etc.
    // without having to know the active source set.
    const scopedBases = [
      LS.favs, LS.favEvents, LS.hiddenDays, LS.myCampId,
      LS.meetSpots, LS.sharedFavs,
    ];
    try {
      const toDrop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (scopedBases.some((b) => k === b || k.startsWith(b + '/'))) {
          toDrop.push(k);
        }
      }
      toDrop.forEach((k) => removeKey(k));
    } catch { /* private mode etc. — fall through to bare key removals */ }
    // Bare-key fallback (covers the keys above on browsers where the
    // iteration path failed) plus the genuinely-global slots.
    removeKey(LS.favs);
    removeKey(LS.favEvents);
    removeKey(LS.hiddenDays);
    removeKey(LS.myCampId);
    removeKey(LS.meetSpots);
    removeKey(LS.nickname);
    removeKey(LS.sharedFavs);
    removeKey(LS.theme);
    removeKey(LS.infoSeen);
    removeKey(LS.source);
    removeKey(LS.legacyKeysMigrated);
    // Wipes both the encrypted-blob in LS and the AES wrapping key
    // in IndexedDB so nothing identifying the unlock state survives.
    clearCachedPassword();
    // Legacy session-cached password slot (pre-LS migration) — drop it
    // too in case the user clicked Clear before ever loading the new
    // build that would have migrated it.
    try { sessionStorage.removeItem(SS.password); } catch {}
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
            <GuideTab />
          ) : (
            <AboutTab
              fetchedDate={fetchedDate}
              takedownHref={takedownHref}
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

function GuideTab() {
  return (
    <>
      <p class="guide-intro">
        The tour. Everything here works offline once the page has
        loaded once with signal.
      </p>

      <section class="guide-section">
        <h3>1. Find camps</h3>
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
      </section>

      <section class="guide-section">
        <h3>2. Build your schedule</h3>
        <p>
          The <strong>📅 Schedule</strong> tab lays every starred event
          out on a day-by-day calendar. Two filter buttons at the top:
        </p>
        <ul class="guide-list">
          <li>
            <strong>⚡ Now</strong> &mdash; only events in the next 2h
            today.
          </li>
          <li>
            <strong>📍 Near me</strong> &mdash; only events at camps
            within ~1&thinsp;km of your GPS fix (~15&thinsp;min walk).
          </li>
        </ul>
        <p>
          Tap the 👁 on any day column to <strong>hide</strong> a
          recurring event from just that day (un-hide later from the
          same spot).
        </p>
      </section>

      <section class="guide-section">
        <h3>3. The map + GPS</h3>
        <p>
          The grid is clock-hours (2:00&ndash;10:00) &times; letter
          streets (Esplanade &rarr; K). Starred camps drop as pins;
          <strong> Center Camp</strong> and <strong>Playa Info</strong>{' '}
          are pre-placed as landmarks. Tap any pin to draw its
          intersection near the Man.
        </p>
        <p>
          Tap <strong>Use my GPS</strong> (top of the Map tab) to
          opt in. You'll see:
        </p>
        <ul class="guide-list">
          <li>a <strong>dot</strong> for where you are,</li>
          <li>your current <strong>clock &amp; street address</strong> (e.g., <em>7:45 &amp; D</em>),</li>
          <li>a <strong>line</strong> from you to any selected pin with distance, compass bearing, and <strong>walk / bike ETA</strong>.</li>
        </ul>
        <p class="guide-subtle">
          GPS is read in-page and never leaves your device. Tap{' '}
          <strong>? Legend</strong> for a deeper read of the grid.
        </p>
      </section>

      <section class="guide-section">
        <h3>4. Plan rendezvous with friends</h3>
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
        <h3>5. Share &amp; sync across devices</h3>
        <p>
          Three ways to move your plans around &mdash; pick the one
          that fits the situation. All three round-trip the same
          payload: starred camps, starred events, your home camp,
          your meet spots.
        </p>
        <ul class="guide-list">
          <li>
            <strong>Share</strong> &mdash; copies a URL with your plans
            in the fragment (<code>#share=&hellip;</code>). Send via
            iMessage / Signal / email. Whoever opens it gets a banner
            offering to import your plans as the friend named after
            your nickname. Nothing leaves your browser; the URL
            <em> is</em> the data.
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
            stale lists never linger.
          </li>
        </ul>
        <p class="guide-subtle">
          Friends' pins, camps, and meet spots are tagged with their
          nickname in lists + on the map sidebar so you can see
          whose plans intersect yours at a glance.
        </p>
      </section>

      <section class="guide-section">
        <h3>6. Install &amp; offline</h3>
        <p>
          Tap <strong>Install app</strong> in the header (Chrome /
          Android / Edge), or on iPhone open this page in Safari &rarr;{' '}
          <strong>Share &rarr; Add to Home Screen</strong>. After one
          full load with signal, the site works from your home screen
          with airplane mode on &mdash; including the map, schedule,
          GPS, and your starred list.
        </p>
        <p class="guide-subtle">
          Theme switcher (emoji pill in the header) picks from 5
          palettes. Stuck on an old build? See{' '}
          <strong>Force refresh</strong> on the About tab.
        </p>
      </section>
    </>
  );
}

// === About tab =====================================================

function AboutTab({
  fetchedDate, takedownHref,
  onForceRefresh, onExport, onImport, onClearAll,
  refreshState, refreshLabel,
}: {
  fetchedDate: string;
  takedownHref: string;
  onForceRefresh: () => void;
  onExport: () => void;
  onImport: () => void;
  onClearAll: () => void;
  refreshState: 'idle' | 'checking' | 'offline';
  refreshLabel: string;
}) {
  return (
    <>
      <p>
        <span class="warn">⚠ Unofficial &amp; best-effort</span>
        <span class="badge">Built for Burners, not commercial</span>
      </p>
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
        source of truth.
      </p>
      <p>
        <strong>What this app adds on top of the directory:</strong>{' '}
        tags are keyword-matched by this app — <em>not</em> from
        Burning Man Project. Calendar dates come from a
        <em> configured burn-week window</em> so events line up on
        the real dates for volunteers + early arrivals; the directory's
        per-event date tuples can be stale.
      </p>
      <p>
        <strong>What you can trust less:</strong> those auto-generated
        tags, event times, and anything that changed on the directory
        after the last nightly refresh.
      </p>
      <p>
        Data is fetched nightly from the public directory and shown here
        for personal browsing only. For the canonical, up-to-date
        listing, please use{' '}
        <a href="https://directory.burningman.org/camps/" target="_blank" rel="noopener">
          directory.burningman.org
        </a>. This site has{' '}
        <strong>
          no ads, no analytics, no tracking, no accounts, and no commercial
          purpose
        </strong>.
      </p>
      <p>
        <strong>Camp owner? Want your camp removed?</strong>{' '}
        <a href={takedownHref}>Email a takedown request</a> — please
        include the camp name and directory URL, and the entry will be
        removed on the next build.
      </p>
      <p>
        <strong>Found a bug or a mis-parse?</strong>{' '}
        <a href="https://github.com/shreyaspurohit/playa/issues" target="_blank" rel="noopener">
          Open an issue on GitHub
        </a>{' '}— include the camp name and what looks wrong.
      </p>
      <p>
        <strong>Stored on this device:</strong> theme, password (per
        tab), the camps and events you've starred, any days you've
        hidden on the schedule, your nickname + home camp + meet spots,
        and any friends' favorites you've imported via share link.
        Nothing leaves your browser. See <strong>Actions</strong> below
        to wipe it all.
      </p>
      <p>
        <strong>GPS / location:</strong> when you tap{' '}
        <em>Navigate</em> on a camp, your browser will prompt you for
        location permission. If granted, your GPS fix is read entirely
        in-page to compute distance + bearing to the camp — nothing is
        sent anywhere. Decline and the map still works without the
        "you are here" dot.
      </p>
      <p>
        <strong>Sharing favorites:</strong> the share URL carries your
        starred camps + events + nickname + home camp + meet spots in
        its fragment (<code>#share=…</code>). Fragments never hit
        servers — the data rides the URL itself.
      </p>
      <p>
        <strong>Stuck on an old version?</strong> The site is cached
        aggressively so it works offline on playa. If a rebuild hasn't
        reached you, use <strong>Force refresh</strong> in Actions
        below. It asks the server for fresh bytes and then reloads;
        if anything fails along the way, the cached copy stays put
        and the site keeps working.
      </p>

      <h3 class="modal-section">Actions</h3>
      <div class="modal-actions">
        <button
          class="action-btn"
          type="button"
          onClick={onForceRefresh}
          disabled={refreshState === 'checking'}
          title="Re-fetches the shell from the server into the existing cache, then reloads. Non-destructive: any fetch that fails leaves the old cache entry in place, so you never end up on a broken page."
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
            Save your nickname, camps, events, meet spots, hidden
            days, and imported friends to a JSON file.
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
            Restore a snapshot. Use this to move state between
            devices — your phone, laptop, etc.
          </span>
        </button>
        <button
          class="action-btn danger"
          type="button"
          onClick={onClearAll}
          title="Deletes starred camps + events, hidden days, imported friends, theme preference, and cached password. Doesn't log you out of anything — this site has no account."
        >
          <span class="action-label">Clear all local data</span>
          <span class="action-desc">
            Remove favorites, hidden days, friends, theme, password.
            Can't be undone.
          </span>
        </button>
      </div>

      <p class="footnote">
        This app is not affiliated, endorsed, or verified by Burning
        Man Project. Updated {fetchedDate}.
      </p>
    </>
  );
}
