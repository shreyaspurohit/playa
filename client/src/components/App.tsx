// Root: holds all cross-component state (query, active tags, favorites,
// fav-only filter, theme, info modal, current tab, map target, etc.)
// and wires it up.
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Camp } from '../types';
import { LS, scopedKey } from '../types';
import { readEmbeddedPayload, indexHaystacks, haystackOf } from '../data';
import type { Payload } from '../data';
import { readString, writeString } from '../utils/storage';
import { loadCachedPassword } from '../utils/secureStore';
import { readShareFromUrl, clearShareFromUrl } from '../utils/share';
import type { SharePayload } from '../utils/share';
import {
  applySnapshot, buildSnapshot, downloadSnapshot, pickSnapshotFile,
} from '../utils/exportImport';
import { useFavorites } from '../hooks/useFavorites';
import { useFriends } from '../hooks/useFriends';
import { useMeetSpots } from '../hooks/useMeetSpots';
import { useSource, migrateLegacyKeysOnce } from '../hooks/useSource';
import { useTheme } from '../hooks/useTheme';
import { useHashRoute } from '../hooks/useHashRoute';
import { CampsView } from './CampsView';
import { Footer } from './Footer';
import { Gate } from './Gate';
import { Header } from './Header';
import { ImportBanner } from './ImportBanner';
import { SnapshotImportBanner } from './SnapshotImportBanner';
import { UpdateBanner } from './UpdateBanner';
import { ReleaseNotesBanner } from './ReleaseNotesBanner';
import { useVersionCheck } from '../hooks/useVersionCheck';
import { useReleaseNotes } from '../hooks/useReleaseNotes';
import type { Snapshot } from '../utils/exportImport';
import { InfoModal } from './InfoModal';
import { MapView } from './MapView';
import { ScheduleView } from './ScheduleView';
import { ShareModal } from './ShareModal';
import { TabBar } from './TabBar';
import { Toolbar } from './Toolbar';

interface Meta {
  fetchedDate: string;
  fetchedAt: string;
  version: string;
  contactEmail: string;
  /** Effective calendar window (ISO YYYY-MM-DD). `burnStart` is the
   *  earliest fetched event date; `burnEnd` is Config.burn_end.
   *  ScheduleView walks this window to build one column per day. */
  burnStart: string;
  burnEnd: string;
}

function readMeta(): Meta {
  const get = (n: string) =>
    (document.querySelector(`meta[name="${n}"]`) as HTMLMetaElement | null)
      ?.content ?? '';
  return {
    fetchedDate:  get('bm-fetched-date') || 'unknown',
    fetchedAt:    get('bm-fetched-at')   || 'unknown',
    version:      get('bm-version')      || 'v0.0.0',
    contactEmail: get('bm-contact-email') || 'bm-camps@example.com',
    burnStart:    get('bm-burn-start') || '',
    burnEnd:      get('bm-burn-end')   || '',
  };
}

export function App() {
  const meta = useMemo(readMeta, []);
  const { theme, setTheme } = useTheme();
  const { view, goto } = useHashRoute();
  const { updateAvailable, latest: latestVersion } = useVersionCheck();
  const { pending: pendingReleaseNotes, dismiss: dismissReleaseNotes } = useReleaseNotes();

  // One-shot LS migration: pre-multi-source builds wrote bare keys
  // (bm-favs, bm-fav-events, …); copy each into its `/directory` slot
  // so existing users see their data under the default source.
  useMemo(() => migrateLegacyKeysOnce(), []);

  const { source, setSource, available: availableSources } = useSource();

  const [camps, setCamps] = useState<Camp[] | null>(null);
  const [encEnvelope, setEncEnvelope] = useState<Payload | null>(null);

  // Re-read the per-source data script whenever the source changes.
  // Each script is already in the page (multi-source build embeds
  // them all up front). Async because plaintext now goes through
  // DecompressionStream (gzip+base64 inline, ADR D12).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await readEmbeddedPayload(source);
        if (cancelled) return;
        if (p.kind === 'plain') {
          indexHaystacks(p.camps);
          setCamps(p.camps);
          setEncEnvelope(null);
        } else {
          setCamps(null);
          setEncEnvelope(p);
        }
      } catch (err) {
        if (cancelled) return;
        // Switching to a source that wasn't embedded — degrade gracefully.
        console.warn('readEmbeddedPayload failed:', err);
        setCamps([]);
        setEncEnvelope(null);
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  const onUnlock = useCallback((jsonText: string) => {
    const unlocked = JSON.parse(jsonText) as Camp[];
    indexHaystacks(unlocked);
    setCamps(unlocked);
    setEncEnvelope(null);
  }, []);

  const [query, setQuery] = useState('');
  const queryLower = query.toLowerCase().trim();
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [showAllTags, setShowAllTags] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  // "Has a website" filter — narrows to ~40% of camps that posted a
  // URL on the directory. Useful for picking camps in advance: web
  // pages tend to mean a camp organized enough to publish hours,
  // ticketing, or contact info.
  const [webOnly, setWebOnly] = useState(false);
  const [focusKey, setFocusKey] = useState(0);

  // Per-source scoped LS keys — recomputed whenever `source` changes
  // so the hooks below pick up the new slot and re-read.
  const favsKey      = scopedKey(LS.favs, source);
  const eventFavsKey = scopedKey(LS.favEvents, source);
  const sharedKey    = scopedKey(LS.sharedFavs, source);
  const meetSpotsKey = scopedKey(LS.meetSpots, source);
  const myCampKey    = scopedKey(LS.myCampId, source);
  const hiddenKey_   = scopedKey(LS.hiddenDays, source);

  const campFavs = useFavorites(favsKey);
  const eventFavs = useFavorites(eventFavsKey);
  const friends = useFriends(sharedKey);
  const meetSpots = useMeetSpots(meetSpotsKey);

  // The user's own home camp — single id, or '' when unset. Separate
  // from campFavs so setting it doesn't pollute the star list, and so
  // friends can see "Alice's camp is here" as a distinct marker on
  // the map after importing her share link.
  const [myCampId, setMyCampId] = useState<string>(
    () => readString(myCampKey, ''),
  );
  const onSetMyCamp = useCallback((id: string) => {
    const next = id === myCampId ? '' : id;   // click again to unset
    writeString(myCampKey, next);
    setMyCampId(next);
  }, [myCampId, myCampKey]);
  // Re-read myCampId when source changes (and on storage events from
  // other tabs writing the same scoped key).
  useEffect(() => {
    setMyCampId(readString(myCampKey, ''));
  }, [myCampKey]);
  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== myCampKey) return;
      setMyCampId(readString(myCampKey, ''));
    }
    win.addEventListener('storage', onStorage);
    return () => win.removeEventListener('storage', onStorage);
  }, [myCampKey]);

  // Long-lived password-share responder. After the gate unlocks, App
  // is the component that lives for the rest of the session — Gate is
  // gone, so its BroadcastChannel listener is gone too. Without a
  // listener on this side, a freshly-opened second tab broadcasts
  // {type:'request'} and gets no response, so it falls through to
  // the password prompt. Keeping the channel open here for the
  // whole session lets sibling tabs decrypt silently.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('playa-camps-pw');
    channel.onmessage = async (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object' || msg.type !== 'request') return;
      const pw = await loadCachedPassword();
      if (pw) channel.postMessage({ type: 'share', pw });
    };
    return () => { try { channel.close(); } catch { /* ignore */ } };
  }, []);

  // Flatten the friend store into the shape MapView wants: one entry
  // per friend with a camp or spots, nothing for the rest.
  const friendsRendezvous = useMemo(() => {
    return friends.names
      .map((n) => {
        const f = friends.friends[n];
        if (!f) return null;
        if (!f.myCampId && (!f.meetSpots || f.meetSpots.length === 0)) return null;
        return {
          name: f.name,
          myCampId: f.myCampId,
          meetSpots: f.meetSpots,
        };
      })
      .filter(Boolean) as Array<{ name: string; myCampId?: string; meetSpots?: typeof meetSpots.spots }>;
  }, [friends]);

  // Per-day hides for recurring events on the Schedule view. Keys are
  // `${eventId}|${iso}` so one localStorage key stores all (event, day)
  // pairs a user has opted out of.
  const hiddenDays = useFavorites(hiddenKey_);
  const hiddenKey = useCallback((id: string, iso: string) => `${id}|${iso}`, []);
  const isDayHidden = useCallback(
    (eventId: string, iso: string) => hiddenDays.has(hiddenKey(eventId, iso)),
    [hiddenDays, hiddenKey],
  );
  const toggleDayHidden = useCallback(
    (eventId: string, iso: string) => hiddenDays.toggle(hiddenKey(eventId, iso)),
    [hiddenDays, hiddenKey],
  );

  // Starring an event auto-stars its camp (one-way). Makes the map's
  // camp-keyed pin set include every camp the user has an event-interest
  // in, without forcing a second click.
  const eventToCamp = useMemo(() => {
    const m = new Map<string, string>();
    if (!camps) return m;
    for (const c of camps) for (const e of c.events ?? []) m.set(e.id, c.id);
    return m;
  }, [camps]);

  const onToggleFavEvent = useCallback((eventId: string) => {
    const wasStarred = eventFavs.has(eventId);
    eventFavs.toggle(eventId);
    if (wasStarred) return;
    const campId = eventToCamp.get(eventId);
    if (campId && !campFavs.has(campId)) campFavs.toggle(campId);
  }, [eventFavs, campFavs, eventToCamp]);

  // One-time reconcile for pre-existing starred events (before the rule
  // existed). Ref-guarded + LS-flagged so an intentional camp un-star
  // stays stuck across reloads.
  const reconciledRef = useRef<boolean>(readString(LS.eventCampReconciled, '') === '1');
  useEffect(() => {
    if (!camps || reconciledRef.current) return;
    reconciledRef.current = true;
    for (const eventId of eventFavs.favs) {
      const campId = eventToCamp.get(eventId);
      if (campId && !campFavs.has(campId)) campFavs.toggle(campId);
    }
    writeString(LS.eventCampReconciled, '1');
  }, [camps, eventFavs, campFavs, eventToCamp]);

  const [mapTargetId, setMapTargetId] = useState<string | null>(null);

  // Cross-view nav: when something calls onGotoCamp(id), we flip to the
  // Camps view, clear filters that could hide it, and bump a tick so
  // CampsView re-runs its scroll effect even when id is unchanged.
  const [scrollToCampId, setScrollToCampId] = useState<string | null>(null);
  const [scrollTick, setScrollTick] = useState(0);

  const [shareOpen, setShareOpen] = useState(false);
  const [incomingShare, setIncomingShare] = useState<SharePayload | null>(null);
  useEffect(() => {
    const s = readShareFromUrl();
    if (s) setIncomingShare(s);
  }, []);
  const onImportFriend = useCallback(
    (opts: { targetName: string; mode: 'merge' | 'overwrite' }) => {
      if (!incomingShare) return;
      friends.importFriend(
        opts.targetName,
        {
          campIds: incomingShare.campIds,
          eventIds: incomingShare.eventIds,
          myCampId: incomingShare.myCampId,
          meetSpots: incomingShare.meetSpots,
        },
        opts.mode,
      );
      setIncomingShare(null);
      clearShareFromUrl();
    },
    [incomingShare, friends],
  );
  const onDismissImport = useCallback(() => {
    setIncomingShare(null);
    clearShareFromUrl();
  }, []);

  /**
   * "This share is from me, on another device" path. Writes the
   * share's payload into the user's OWN LS keys (favs / fav-events /
   * my-camp / meet-spots) and reloads — picks up where the other
   * device left off. Doesn't touch nickname (already matches) or
   * keys that share links don't carry (hiddenDays, friends).
   * For full state transfer including those, use the JSON Export.
   */
  const onImportAsSelf = useCallback(() => {
    if (!incomingShare) return;
    // Self-import targets the CURRENTLY-ACTIVE source. A share carrying
    // its own `source` field (post-multi-source clients) lands in that
    // source's bucket regardless of the importer's current view; the
    // banner has already nudged the importer to switch first if the
    // sources mismatch, so by here `source` is the right slot.
    writeString(scopedKey(LS.favs, source), JSON.stringify(incomingShare.campIds));
    writeString(scopedKey(LS.favEvents, source), JSON.stringify(incomingShare.eventIds));
    writeString(scopedKey(LS.myCampId, source), incomingShare.myCampId ?? '');
    writeString(
      scopedKey(LS.meetSpots, source),
      JSON.stringify(incomingShare.meetSpots ?? []),
    );
    clearShareFromUrl();
    location.reload();
  }, [incomingShare, source]);

  /**
   * Snapshot import flow. Picking the file is browser-native, but
   * the decision (self-restore vs friend-import vs cancel) goes to
   * a banner so the UX matches share-link imports — the user used
   * to see a `confirm()` here which felt out of place.
   *
   * `incomingSnapshot` is the pending pick; the banner stays mounted
   * until the user picks an action OR dismisses, mirroring how
   * `incomingShare` drives ImportBanner.
   */
  const onExportSnapshot = useCallback(() => {
    downloadSnapshot(buildSnapshot(source));
  }, [source]);

  const [incomingSnapshot, setIncomingSnapshot] = useState<Snapshot | null>(null);

  const onImportSnapshot = useCallback(async () => {
    const snap = await pickSnapshotFile();
    if (!snap) {
      alert("Couldn't read that file. Make sure it's a Playa Camps export.");
      return;
    }
    setIncomingSnapshot(snap);
  }, []);

  const onApplySnapshotSelf = useCallback(() => {
    if (!incomingSnapshot) return;
    applySnapshot(incomingSnapshot, source);
    setIncomingSnapshot(null);
    location.reload();
  }, [incomingSnapshot, source]);

  const onImportSnapshotAsFriend = useCallback(() => {
    if (!incomingSnapshot) return;
    if (!incomingSnapshot.nickname) {
      alert("This snapshot has no nickname — can't import as a friend.");
      return;
    }
    friends.importFriend(
      incomingSnapshot.nickname,
      {
        campIds: incomingSnapshot.campFavs,
        eventIds: incomingSnapshot.eventFavs,
        myCampId: incomingSnapshot.myCampId || undefined,
        meetSpots:
          incomingSnapshot.meetSpots.length > 0
            ? incomingSnapshot.meetSpots
            : undefined,
      },
      'overwrite',
    );
    setIncomingSnapshot(null);
  }, [incomingSnapshot, friends]);

  const onDismissSnapshot = useCallback(() => setIncomingSnapshot(null), []);

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoPulse, setInfoPulse] = useState(() => {
    const n = parseInt(readString(LS.infoSeen, '0'), 10) || 0;
    if (n < 2) {
      writeString(LS.infoSeen, String(n + 1));
      return true;
    }
    return false;
  });
  useEffect(() => {
    if (!infoPulse) return;
    const t = window.setTimeout(() => setInfoPulse(false), 4200);
    return () => window.clearTimeout(t);
  }, [infoPulse]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && infoOpen)  { setInfoOpen(false);  return; }
      if (e.key === 'Escape' && shareOpen) { setShareOpen(false); return; }
      const t = e.target as HTMLElement | null;
      const isInput = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA';
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        goto('camps');
        setFocusKey((k) => k + 1);
      }
      if (e.key === 'Escape' && isInput && t?.getAttribute('type') === 'search') {
        setQuery('');
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [infoOpen, shareOpen, goto]);

  const sortedTags = useMemo<ReadonlyArray<readonly [string, number]>>(() => {
    if (!camps) return [];
    const freq = new Map<string, number>();
    for (const c of camps) {
      for (const t of c.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [camps]);

  const campHasFavEvent = useCallback(
    (c: Camp) => {
      if (!eventFavs.size) return false;
      return (c.events || []).some((e) => eventFavs.has(e.id));
    },
    [eventFavs],
  );
  const campHasFriendFavEvent = useCallback(
    (c: Camp) => (c.events || []).some((e) => friends.anyFriendFavEvent(e.id)),
    [friends],
  );
  const matches = useCallback(
    (c: Camp) => {
      if (favOnly) {
        const mine = campFavs.has(c.id) || campHasFavEvent(c);
        const friend = friends.anyFriendFavCamp(c.id) || campHasFriendFavEvent(c);
        if (!mine && !friend) return false;
      }
      if (webOnly && !(c.website && c.website.trim())) return false;
      for (const t of activeTags) if (!c.tags.includes(t)) return false;
      if (queryLower && haystackOf(c).indexOf(queryLower) === -1) return false;
      return true;
    },
    [favOnly, webOnly, campFavs, campHasFavEvent, friends, campHasFriendFavEvent,
     activeTags, queryLower],
  );

  const filtered = useMemo(
    () => (camps ? camps.filter(matches) : []),
    [camps, matches],
  );

  const favMatchCount = useMemo(() => {
    if (!camps) return 0;
    let n = 0;
    for (const c of camps) {
      if (campFavs.has(c.id) || campHasFavEvent(c) ||
          friends.anyFriendFavCamp(c.id) || campHasFriendFavEvent(c)) n++;
    }
    return n;
  }, [camps, campFavs, campHasFavEvent, friends, campHasFriendFavEvent]);

  const webMatchCount = useMemo(() => {
    if (!camps) return 0;
    let n = 0;
    for (const c of camps) if (c.website && c.website.trim()) n++;
    return n;
  }, [camps]);

  // Only your own starred events. Friends' events still show on the
  // calendar, but a "48 things on your calendar (of which 30 are yours)"
  // tab badge is just noise — the user wants a count of their own plans.
  const scheduleBadge = eventFavs.size;

  const onToggleTag = useCallback((tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const onClear = useCallback(() => {
    setQuery(''); setActiveTags(new Set()); setFavOnly(false); setWebOnly(false);
    setFocusKey((k) => k + 1);
  }, []);

  const onUnfavoriteAll = useCallback(() => {
    const total = campFavs.size + eventFavs.size;
    if (total === 0) return;
    const parts: string[] = [];
    if (campFavs.size) parts.push(`${campFavs.size} camp${campFavs.size === 1 ? '' : 's'}`);
    if (eventFavs.size) parts.push(`${eventFavs.size} event${eventFavs.size === 1 ? '' : 's'}`);
    const msg =
      `Remove all ${total} starred item${total === 1 ? '' : 's'} (${parts.join(', ')})?` +
      "\n\nThis can't be undone. (Friends' imported favorites are untouched.)";
    if (!confirm(msg)) return;
    campFavs.clear(); eventFavs.clear(); setFavOnly(false);
  }, [campFavs, eventFavs]);

  const onNavigate = useCallback((campId: string) => {
    setMapTargetId(campId);
    goto('map');
  }, [goto]);

  const onGotoCamp = useCallback((campId: string) => {
    // Clear anything that could filter the target out of view, so the
    // scroll-to actually lands on a rendered card.
    setQuery('');
    setActiveTags(new Set());
    setFavOnly(false);
    setScrollToCampId(campId);
    setScrollTick((t) => t + 1);
    goto('camps');
  }, [goto]);

  const filterNote = activeTags.size
    ? '· filters: ' + [...activeTags].join(' + ')
    : '';

  if (encEnvelope && encEnvelope.kind === 'encrypted') {
    return <Gate enc={encEnvelope.enc} onUnlock={onUnlock} />;
  }

  return (
    <>
      <div class="site-chrome">
        <Header
          total={camps?.length ?? 0}
          matching={filtered.length}
          filterNote={filterNote}
          fetchedDate={meta.fetchedDate}
          fetchedAt={meta.fetchedAt}
          version={meta.version}
          currentTheme={theme}
          onThemeChange={setTheme}
          onInfoClick={() => { setInfoPulse(false); setInfoOpen(true); }}
          infoPulse={infoPulse}
          source={source}
          availableSources={availableSources}
          onSourceChange={setSource}
        />
        <TabBar view={view} onGoto={goto} scheduleBadge={scheduleBadge} />
        {updateAvailable && <UpdateBanner latest={latestVersion} />}
        {pendingReleaseNotes.length > 0 && (
          <ReleaseNotesBanner
            notes={pendingReleaseNotes}
            onDismiss={dismissReleaseNotes}
          />
        )}
        {incomingShare && (
          <ImportBanner
            payload={incomingShare}
            existing={friends.friends[incomingShare.name]}
            ownNickname={readString(LS.nickname, '').trim()}
            currentSource={source}
            availableSources={availableSources}
            onSwitchSource={setSource}
            onImport={onImportFriend}
            onImportAsSelf={onImportAsSelf}
            onDismiss={onDismissImport}
          />
        )}
        {incomingSnapshot && (
          <SnapshotImportBanner
            snapshot={incomingSnapshot}
            ownNickname={readString(LS.nickname, '').trim()}
            existing={
              incomingSnapshot.nickname
                ? friends.friends[incomingSnapshot.nickname]
                : undefined
            }
            onApplySelf={onApplySnapshotSelf}
            onImportAsFriend={onImportSnapshotAsFriend}
            onDismiss={onDismissSnapshot}
          />
        )}
        {view === 'camps' && (
          <Toolbar
            query={query}
            onQueryChange={setQuery}
            onClear={onClear}
            favOnly={favOnly}
            favCount={favMatchCount}
            favCampN={campFavs.size}
            favEventN={eventFavs.size}
            onToggleFavFilter={() => setFavOnly((v) => !v)}
            webOnly={webOnly}
            webCount={webMatchCount}
            onToggleWebFilter={() => setWebOnly((v) => !v)}
            onUnfavoriteAll={onUnfavoriteAll}
            onShare={() => setShareOpen(true)}
            onExport={onExportSnapshot}
            onImport={onImportSnapshot}
            focusKey={focusKey}
          />
        )}
      </div>

      {/* All three views stay mounted once `camps` is loaded so tab
          switches are an instant CSS toggle, not a remount of 600
          camp cards / a fresh SVG / a fresh calendar. The one-time
          mount hit happens at first paint; everything afterward is
          O(1). The `hidden` attribute is the modern equivalent of
          `display: none` plus an aria-hidden hint for assistive tech. */}
      {camps && (
        <>
          <div hidden={view !== 'camps'}>
            <CampsView
              camps={filtered}
              total={camps.length}
              query={query}
              queryLower={queryLower}
              sortedTags={sortedTags}
              activeTags={activeTags}
              showAllTags={showAllTags}
              onToggleTag={onToggleTag}
              onToggleShowAllTags={() => setShowAllTags((v) => !v)}
              isFav={campFavs.has}
              isFavEvent={eventFavs.has}
              friendsFavingCamp={friends.friendsFavingCamp}
              friendsFavingEvent={friends.friendsFavingEvent}
              onToggleFav={campFavs.toggle}
              onToggleFavEvent={onToggleFavEvent}
              onNavigate={onNavigate}
              myCampId={myCampId}
              onSetMyCamp={onSetMyCamp}
              scrollToCampId={scrollToCampId}
              scrollToCampTick={scrollTick}
            />
          </div>
          <div hidden={view !== 'schedule'}>
            <ScheduleView
              camps={camps}
              favEventIds={eventFavs.favs}
              friendFavEventIds={friends.friendsFavingEvent}
              burnStart={meta.burnStart}
              burnEnd={meta.burnEnd}
              isDayHidden={isDayHidden}
              onToggleDayHidden={toggleDayHidden}
              hiddenCount={hiddenDays.size}
              onClearHidden={hiddenDays.clear}
              onGotoCamp={onGotoCamp}
              source={source}
            />
          </div>
          <div hidden={view !== 'map'}>
            <MapView
              camps={camps}
              favCampIds={campFavs.favs}
              friendFavCampIds={friends.friendsFavingCamp}
              favEventIds={eventFavs.favs}
              friendFavEventIds={friends.friendsFavingEvent}
              myCampId={myCampId}
              meetSpots={meetSpots.spots}
              onAddMeetSpot={meetSpots.add}
              onRemoveMeetSpot={meetSpots.removeAt}
              friendsRendezvous={friendsRendezvous}
              initialTargetId={mapTargetId}
              onClearTarget={() => setMapTargetId(null)}
              onGotoCamp={onGotoCamp}
              source={source}
            />
          </div>
        </>
      )}

      <Footer fetchedDate={meta.fetchedDate} contactEmail={meta.contactEmail} />
      <InfoModal
        open={infoOpen}
        fetchedDate={meta.fetchedDate}
        contactEmail={meta.contactEmail}
        onImport={onImportSnapshot}
        onClose={() => setInfoOpen(false)}
      />
      <ShareModal
        open={shareOpen}
        campIds={[...campFavs.favs]}
        eventIds={[...eventFavs.favs]}
        myCampId={myCampId}
        meetSpots={meetSpots.spots}
        source={source}
        onClose={() => setShareOpen(false)}
      />
    </>
  );
}
