// Root: holds all cross-component state (query, active tags, favorites,
// fav-only filter, theme, info modal visibility) and wires it up.
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { Camp } from '../types';
import { LS } from '../types';
import { readEmbeddedPayload, indexHaystacks, haystackOf } from '../data';
import type { Payload } from '../data';
import { readString, writeString } from '../utils/storage';
import { useFavorites } from '../hooks/useFavorites';
import { useTheme } from '../hooks/useTheme';
import { CampsView } from './CampsView';
import { Footer } from './Footer';
import { Gate } from './Gate';
import { Header } from './Header';
import { InfoModal } from './InfoModal';
import { Toolbar } from './Toolbar';

interface Meta {
  scrapedDate: string;
  scrapedAt: string;
  version: string;
  contactEmail: string;
}

function readMeta(): Meta {
  const get = (n: string) =>
    (document.querySelector(`meta[name="${n}"]`) as HTMLMetaElement | null)
      ?.content ?? '';
  return {
    scrapedDate:  get('bm-scraped-date') || 'unknown',
    scrapedAt:    get('bm-scraped-at')   || 'unknown',
    version:      get('bm-version')      || 'v0.0.0',
    contactEmail: get('bm-contact-email') || 'bm-camps@example.com',
  };
}

export function App() {
  const meta = useMemo(readMeta, []);
  const { theme, setTheme } = useTheme();

  // Data load: may show the gate first if encrypted.
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

  // Top-level filter/search state.
  const [query, setQuery] = useState('');
  const queryLower = query.toLowerCase().trim();
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [showAllTags, setShowAllTags] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const [focusKey, setFocusKey] = useState(0);

  const campFavs = useFavorites(LS.favs);
  const eventFavs = useFavorites(LS.favEvents);

  // Info modal.
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
    // Clear pulse after ~4.2s (matches the 3-iteration 1.4s animation).
    if (!infoPulse) return;
    const t = window.setTimeout(() => setInfoPulse(false), 4200);
    return () => window.clearTimeout(t);
  }, [infoPulse]);

  // Keyboard shortcuts: "/" focuses search (if not typing), "Escape"
  // closes the modal or clears search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && infoOpen) {
        setInfoOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        setFocusKey((k) => k + 1);
      }
      if (e.key === 'Escape' && isInput && target?.getAttribute('type') === 'search') {
        setQuery('');
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // Derive sorted tag frequencies once per data load.
  const sortedTags = useMemo<ReadonlyArray<readonly [string, number]>>(() => {
    if (!camps) return [];
    const freq = new Map<string, number>();
    for (const c of camps) {
      for (const t of c.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    return [...freq.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [camps]);

  // Filter matcher.
  const campHasFavEvent = useCallback(
    (c: Camp) => {
      if (!eventFavs.size) return false;
      return (c.events || []).some((e) => eventFavs.has(e.id));
    },
    [eventFavs],
  );
  const matches = useCallback(
    (c: Camp) => {
      if (favOnly && !campFavs.has(c.id) && !campHasFavEvent(c)) return false;
      for (const t of activeTags) if (!c.tags.includes(t)) return false;
      if (queryLower && haystackOf(c).indexOf(queryLower) === -1) return false;
      return true;
    },
    [favOnly, campFavs, campHasFavEvent, activeTags, queryLower],
  );

  const filtered = useMemo(
    () => (camps ? camps.filter(matches) : []),
    [camps, matches],
  );

  const favMatchCount = useMemo(() => {
    if (!camps) return 0;
    let n = 0;
    for (const c of camps) {
      if (campFavs.has(c.id) || campHasFavEvent(c)) n++;
    }
    return n;
  }, [camps, campFavs, campHasFavEvent]);

  // Handlers
  const onToggleTag = useCallback((tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const onClear = useCallback(() => {
    setQuery('');
    setActiveTags(new Set());
    setFavOnly(false);
    setFocusKey((k) => k + 1);
  }, []);

  const onToggleFavFilter = useCallback(() => {
    setFavOnly((v) => !v);
  }, []);

  const onUnfavoriteAll = useCallback(() => {
    const total = campFavs.size + eventFavs.size;
    if (total === 0) return;
    const parts: string[] = [];
    if (campFavs.size) parts.push(`${campFavs.size} camp${campFavs.size === 1 ? '' : 's'}`);
    if (eventFavs.size) parts.push(`${eventFavs.size} event${eventFavs.size === 1 ? '' : 's'}`);
    const msg =
      `Remove all ${total} starred item${total === 1 ? '' : 's'} (${parts.join(', ')})?` +
      "\n\nThis can't be undone.";
    if (!confirm(msg)) return;
    campFavs.clear();
    eventFavs.clear();
    setFavOnly(false);
  }, [campFavs, eventFavs]);

  // Filter note shown in the header stats line.
  const filterNote = activeTags.size
    ? '· filters: ' + [...activeTags].join(' + ')
    : '';

  // Render: gate if encrypted and still locked; otherwise the main app.
  if (encEnvelope && encEnvelope.kind === 'encrypted') {
    return <Gate enc={encEnvelope.enc} onUnlock={onUnlock} />;
  }

  // site-chrome wraps header + toolbar so they stick together as one
  // fixed region when scrolling. (Pre-migration, <header> contained the
  // search + toolbar and was itself sticky.)
  return (
    <>
      <div class="site-chrome">
        <Header
          total={camps?.length ?? 0}
          matching={filtered.length}
          filterNote={filterNote}
          scrapedDate={meta.scrapedDate}
          scrapedAt={meta.scrapedAt}
          version={meta.version}
          currentTheme={theme}
          onThemeChange={setTheme}
          onInfoClick={() => { setInfoPulse(false); setInfoOpen(true); }}
          infoPulse={infoPulse}
        />
        <Toolbar
          query={query}
          onQueryChange={setQuery}
          onClear={onClear}
          favOnly={favOnly}
          favCount={favMatchCount}
          favCampN={campFavs.size}
          favEventN={eventFavs.size}
          onToggleFavFilter={onToggleFavFilter}
          onUnfavoriteAll={onUnfavoriteAll}
          focusKey={focusKey}
        />
      </div>
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
        onToggleFav={campFavs.toggle}
        onToggleFavEvent={eventFavs.toggle}
      />
      <Footer scrapedDate={meta.scrapedDate} contactEmail={meta.contactEmail} />
      <InfoModal
        open={infoOpen}
        scrapedDate={meta.scrapedDate}
        contactEmail={meta.contactEmail}
        onClose={() => setInfoOpen(false)}
      />
    </>
  );
}
