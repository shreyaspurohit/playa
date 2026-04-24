// Root: holds all cross-component state (query, active tags, favorites,
// fav-only filter, theme, info modal, current tab, map target, etc.)
// and wires it up.
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Camp } from '../types';
import { LS } from '../types';
import { readEmbeddedPayload, indexHaystacks, haystackOf } from '../data';
import type { Payload } from '../data';
import { readString, writeString } from '../utils/storage';
import { readShareFromUrl, clearShareFromUrl } from '../utils/share';
import type { SharePayload } from '../utils/share';
import { useFavorites } from '../hooks/useFavorites';
import { useFriends } from '../hooks/useFriends';
import { useMeetSpots } from '../hooks/useMeetSpots';
import { useTheme } from '../hooks/useTheme';
import { useHashRoute } from '../hooks/useHashRoute';
import { CampsView } from './CampsView';
import { Footer } from './Footer';
import { Gate } from './Gate';
import { Header } from './Header';
import { ImportBanner } from './ImportBanner';
import { UpdateBanner } from './UpdateBanner';
import { useVersionCheck } from '../hooks/useVersionCheck';
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

  const [camps, setCamps] = useState<Camp[] | null>(null);
  const [encEnvelope, setEncEnvelope] = useState<Payload | null>(null);

  useEffect(() => {
    const p = readEmbeddedPayload();
    if (p.kind === 'plain') {
      indexHaystacks(p.camps);
      setCamps(p.camps);
    } else {
      setEncEnvelope(p);
    }
  }, []);

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

  const campFavs = useFavorites(LS.favs);
  const eventFavs = useFavorites(LS.favEvents);
  const friends = useFriends();
  const meetSpots = useMeetSpots();

  // The user's own home camp — single id, or '' when unset. Separate
  // from campFavs so setting it doesn't pollute the star list, and so
  // friends can see "Alice's camp is here" as a distinct marker on
  // the map after importing her share link.
  const [myCampId, setMyCampId] = useState<string>(
    () => readString(LS.myCampId, ''),
  );
  const onSetMyCamp = useCallback((id: string) => {
    const next = id === myCampId ? '' : id;   // click again to unset
    writeString(LS.myCampId, next);
    setMyCampId(next);
  }, [myCampId]);

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
  const hiddenDays = useFavorites(LS.hiddenDays);
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
        />
        <TabBar view={view} onGoto={goto} scheduleBadge={scheduleBadge} />
        {updateAvailable && <UpdateBanner latest={latestVersion} />}
        {incomingShare && (
          <ImportBanner
            payload={incomingShare}
            existing={friends.friends[incomingShare.name]}
            onImport={onImportFriend}
            onDismiss={onDismissImport}
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
            focusKey={focusKey}
          />
        )}
      </div>

      {view === 'camps' && (
        <CampsView
          camps={filtered}
          total={camps?.length ?? 0}
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
      )}
      {view === 'schedule' && camps && (
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
        />
      )}
      {view === 'map' && camps && (
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
        />
      )}

      <Footer fetchedDate={meta.fetchedDate} contactEmail={meta.contactEmail} />
      <InfoModal
        open={infoOpen}
        fetchedDate={meta.fetchedDate}
        contactEmail={meta.contactEmail}
        onClose={() => setInfoOpen(false)}
      />
      <ShareModal
        open={shareOpen}
        campIds={[...campFavs.favs]}
        eventIds={[...eventFavs.favs]}
        myCampId={myCampId}
        meetSpots={meetSpots.spots}
        onClose={() => setShareOpen(false)}
      />
    </>
  );
}
