// Food tab (ADR docs/17). Surfaces camps' food offerings grouped by
// availability — Serving now / Starting soon / Upcoming / Hours not listed —
// and filterable by food type. Availability is computed client-side from each
// event's parsed_time vs. the device clock (see utils/foodAvailability).
//
// Read-only re: camps/events data; it toggles the user's own event stars via
// the same eventFavs hook the rest of the app uses. Location is whatever the
// (already embargo-masked) camp carries — an empty location just renders
// nothing, so pre-release builds hide the "where" while still showing the
// food + time.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Camp, Event, Source } from '../types';
import {
  eventAvailability, isFoodEvent, isUpcomingFood, type Availability,
} from '../utils/foodAvailability';
import { useGeolocation } from '../hooks/useGeolocation';
import { addressToLatLng, haversineMeters } from '../map/address';
import { brcForSource } from '../hooks/useSource';
import { now } from '../utils/clock';

/** ~1 km ≈ 15-min walk — same cutoff ScheduleView's "Near me" uses. */
const NEAR_ME_METERS = 1000;

interface Props {
  camps: Camp[];
  isEventFav: (id: string) => boolean;
  onToggleEventFav: (id: string) => void;
  friendFavEventIds: (id: string) => string[];
  onGotoCamp: (campId: string) => void;
  /** Active data source — drives the per-year BRC geometry for "near me". */
  source: Source;
  /** Burn window edges ('YYYY-MM-DD') so availability is date-gated. */
  burnStart?: string;
  burnEnd?: string;
  youLabel?: string;
  /** Optional app-controlled clock shared with the app's availability timer. */
  nowSnapshot?: Date;
  onRefreshNow?: () => void;
}

interface FoodEntry {
  camp: Camp;
  event: Event | null;   // null = camp serves food but lists no timed event
  tags: string[];
  avail: Availability;
  startMin: number;      // for sorting; +Infinity when no time
  dateNum: number;       // start date as M*100+D (8/31→831); +Infinity if none
}

const SECTIONS: Array<{ key: Availability; icon: string; title: string }> = [
  { key: 'now', icon: '🔥', title: 'Serving now' },
  { key: 'soon', icon: '⏳', title: 'Starting soon' },
  { key: 'later', icon: '📅', title: 'Upcoming' },
  { key: 'anytime', icon: '🍽', title: 'Hours not listed' },
];

function startMinutes(ev: Event | null): number {
  const m = ev?.parsed_time?.start_time
    ? /^(\d{1,2}):(\d{2})$/.exec(ev.parsed_time.start_time)
    : null;
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : Number.POSITIVE_INFINITY;
}

/** Start date ('M/D') → M*100+D for date ordering; +Infinity when absent.
 *  Recurring events carry the earliest occurrence date (stamped server-side),
 *  which is exactly the "(starts M/D)" shown in the row — so ordering by this
 *  matches what the user sees. */
function startDateNum(ev: Event | null): number {
  const sd = ev?.parsed_time?.start_date;
  const m = sd ? /^(\d{1,2})\/(\d{1,2})$/.exec(sd) : null;
  return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : Number.POSITIVE_INFINITY;
}

/** Lowercased text a search query matches against. */
function entryHaystack(e: FoodEntry): string {
  return [
    e.camp.name, e.event?.name, e.event?.description,
    e.camp.description, e.camp.location, e.tags.join(' '),
  ].filter(Boolean).join(' ').toLowerCase();
}

/** Sort order for the "Your picks" summary — soonest first. */
const AVAIL_ORDER: Record<Availability, number> = { now: 0, soon: 1, later: 2, anytime: 3 };

export function FoodView({
  camps, isEventFav, onToggleEventFav, friendFavEventIds,
  onGotoCamp, source, burnStart, burnEnd, youLabel = 'you',
  nowSnapshot: controlledNowSnapshot, onRefreshNow,
}: Props) {
  // Snapshot of "now" used for availability. The Refresh button re-snapshots
  // so the user can update now/soon/upcoming as time passes without reloading.
  const [localNowSnapshot, setLocalNowSnapshot] = useState(() => now());
  const nowSnapshot = controlledNowSnapshot ?? localNowSnapshot;
  const refreshNow = () => {
    if (onRefreshNow) onRefreshNow();
    else setLocalNowSnapshot(now());
  };
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  // Free-text search so you can hunt future food to plan/star ("ramen",
  // a camp name, a dietary word). AND-combined with the type/near-me filters.
  const [query, setQuery] = useState('');

  // Inline accordion: clicking a row expands it in place (one open at a time —
  // opening another collapses the previous). Clicking anywhere outside a row
  // collapses it. This replaces the old "jump to the Camps tab" behavior.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || !el.closest('.food-row')) setExpandedKey(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // Collapsible availability sections. The browse-heavy ones (Upcoming, Hours
  // not listed) start collapsed so the page isn't a long scroll; the
  // time-relevant Serving now / Starting soon stay open. Header toggles.
  const [collapsedSections, setCollapsedSections] = useState<Set<Availability>>(
    () => new Set<Availability>(['later', 'anytime']),
  );
  const toggleSection = (k: Availability) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  // "Near me" proximity filter — mirrors ScheduleView. Geometry can be absent
  // for a staged year; when so the toggle is disabled and any stored on-state
  // is cleared so switching sources can't silently reactivate it.
  const brc = useMemo(() => brcForSource(source), [source]);
  const [nearMeOnly, setNearMeOnly] = useState(false);
  const nearMeActive = nearMeOnly && brc !== null;
  const { state: geo, request: requestGps, stop: stopGps } = useGeolocation();
  useEffect(() => {
    if (!brc && nearMeOnly) {
      setNearMeOnly(false);
      stopGps();
    }
  }, [brc, nearMeOnly, stopGps]);

  function toggleNearMe() {
    if (nearMeOnly) {
      setNearMeOnly(false);
      stopGps();
      return;
    }
    if (!brc) return;
    setNearMeOnly(true);
    if (geo.status === 'idle' || geo.status === 'denied') requestGps();
  }

  // camp id → within cutoff. Null while off / no fix yet. Camps whose location
  // is empty (e.g. embargo-masked) or unparseable are treated as "too far".
  const nearMeFit = useMemo(() => {
    if (!brc || !nearMeActive || geo.status !== 'ready') return null;
    const user = { lat: geo.lat, lng: geo.lng };
    const byCamp = new Map<string, boolean>();
    for (const c of camps) {
      if (byCamp.has(c.id)) continue;
      const ll = c.location ? addressToLatLng(c.location, brc) : null;
      byCamp.set(c.id, ll ? haversineMeters(user, ll) <= NEAR_ME_METERS : false);
    }
    return byCamp;
  }, [nearMeActive, geo, camps, brc]);

  // Build every food offering: one entry per food-classified event, plus a
  // camp-level "anytime" entry for camps whose own prose has precise food
  // types and that list no food-classified event.
  const allEntries = useMemo<FoodEntry[]>(() => {
    const out: FoodEntry[] = [];
    for (const camp of camps) {
      let hasFoodEvent = false;
      for (const event of camp.events ?? []) {
        if (!isFoodEvent(event)) continue;
        hasFoodEvent = true;
        if (!isUpcomingFood(event, nowSnapshot, { burnStart, burnEnd })) continue;
        out.push({
          camp,
          event,
          tags: event.food_tags ?? [],
          avail: eventAvailability(event, nowSnapshot, { burnStart, burnEnd }),
          startMin: startMinutes(event),
          dateNum: startDateNum(event),
        });
      }
      // Camp-level "anytime" row: only when the camp itself advertises a food
      // TYPE in its name/description (precise, server-classified) — NOT the
      // coarse `food` tag, which false-positives on camps whose events merely
      // mention "snacks" etc. Show those precise types as the row's chips.
      const campFood = camp.food_tags ?? [];
      if (!hasFoodEvent && campFood.length > 0) {
        out.push({
          camp, event: null, tags: campFood, avail: 'anytime',
          startMin: Number.POSITIVE_INFINITY, dateNum: Number.POSITIVE_INFINITY,
        });
      }
    }
    return out;
    // Availability is a snapshot at `nowSnapshot`; the Refresh button bumps it
    // to re-evaluate now/soon/upcoming. Matches ScheduleView's "Now" snapshot.
  }, [camps, burnStart, burnEnd, nowSnapshot]);

  // Distinct food types present, for the filter chips (sorted, stable).
  const allTypes = useMemo(() => {
    const s = new Set<string>();
    for (const e of allEntries) for (const t of e.tags) s.add(t);
    return [...s].sort();
  }, [allEntries]);

  // Never let a hidden type selection from another source trap the view in an
  // empty state. Also discard types removed by a same-source data refresh.
  useEffect(() => { setSelectedTypes(new Set()); }, [source]);
  useEffect(() => {
    const valid = new Set(allTypes);
    setSelectedTypes((prev) => {
      const next = new Set([...prev].filter((type) => valid.has(type)));
      return next.size === prev.size ? prev : next;
    });
  }, [allTypes]);

  // Type filter is OR (any selected type). Near-me, when active, keeps only
  // camps within the cutoff; while a fix is pending it hides everything and an
  // inline hint explains why — matching ScheduleView.
  const q = query.trim().toLowerCase();
  const entries = useMemo(() => {
    let list = allEntries;
    if (selectedTypes.size > 0) {
      list = list.filter((e) => e.tags.some((t) => selectedTypes.has(t)));
    }
    if (q) list = list.filter((e) => entryHaystack(e).includes(q));
    if (nearMeActive) {
      if (!nearMeFit) return [];
      list = list.filter((e) => nearMeFit.get(e.camp.id) === true);
    }
    return list;
  }, [allEntries, selectedTypes, q, nearMeActive, nearMeFit]);

  // "Your picks" = your starred food that's yet to happen (past single events
  // drop out). Computed each render so it reflects a star toggle immediately.
  const picks = allEntries
    .filter((e) => e.event && isEventFav(e.event.id))
    .sort((a, b) =>
      AVAIL_ORDER[a.avail] - AVAIL_ORDER[b.avail]
      || a.dateNum - b.dateNum
      || a.startMin - b.startMin);

  const bySection = useMemo(() => {
    const m: Record<Availability, FoodEntry[]> = { now: [], soon: [], later: [], anytime: [] };
    for (const e of entries) m[e.avail].push(e);
    const byName = (a: FoodEntry, b: FoodEntry) => a.camp.name.localeCompare(b.camp.name);
    // now/soon are all today → order by time. Upcoming spans future days →
    // order by DATE first (so "starts 8/31" precedes "starts 9/3"). Anytime
    // has no time → by name.
    m.now.sort((a, b) => a.startMin - b.startMin || byName(a, b));
    m.soon.sort((a, b) => a.startMin - b.startMin || byName(a, b));
    m.later.sort((a, b) => a.dateNum - b.dateNum || a.startMin - b.startMin || byName(a, b));
    m.anytime.sort(byName);
    return m;
  }, [entries]);

  function toggleType(t: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  const nothing = entries.length === 0;

  function renderEntry(e: FoodEntry) {
    const ev = e.event;
    const key2 = ev ? `ev-${ev.id}` : `camp-${e.camp.id}`;
    const fav = ev ? isEventFav(ev.id) : false;
    const friends = ev ? friendFavEventIds(ev.id) : [];
    const whenText = ev?.display_time || ev?.time || '';
    const expanded = expandedKey === key2;
    const campDesc = e.camp.description?.trim();
    return (
      <li
        class={'food-row clickable' + (expanded ? ' expanded' : '')}
        key={key2}
      >
        {ev && (
          <button
            type="button"
            class={'food-star' + (fav ? ' on' : '')}
            aria-pressed={fav ? 'true' : 'false'}
            aria-label={fav ? 'Unstar event' : 'Star event'}
            title={fav ? 'Unstar event' : 'Star event'}
            onClick={(se) => { se.stopPropagation(); onToggleEventFav(ev.id); }}
          >{fav ? '★' : '☆'}</button>
        )}
        <div class="food-row-body">
          <button
            type="button"
            class="food-row-toggle"
            aria-expanded={expanded ? 'true' : 'false'}
            aria-label={`${expanded ? 'Hide' : 'Show'} details for ${ev ? ev.name : e.camp.name}`}
            onClick={() => setExpandedKey(expanded ? null : key2)}
          >
            <span class="food-row-title">
              {ev ? ev.name : e.camp.name}
              {ev && whenText && <span class="food-when"> · {whenText}</span>}
              <span class="food-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            </span>
            <span class="food-row-meta">
              <span class="food-campname">{e.camp.name}</span>
              {e.camp.location && e.camp.location.trim() && e.camp.location.trim().toLowerCase() !== 'none listed' && (
                <span class="food-loc"> · 📍 {e.camp.location}</span>
              )}
            </span>
            {e.tags.length > 0 && (
              <span class="food-chips">
                {e.tags.map((t) => <span class="food-chip" key={t}>{t}</span>)}
              </span>
            )}
            {friends.length > 0 && (
              <span class="food-friends">
                Starred by {[...(fav ? [youLabel] : []), ...friends].join(', ')}
              </span>
            )}
          </button>
          {expanded && (
            <div class="food-detail">
              {ev?.description && <p class="food-detail-desc">{ev.description}</p>}
              {campDesc && campDesc !== '-' && (
                <p class="food-detail-camp">{campDesc}</p>
              )}
              <div class="food-detail-actions" onClick={(ae) => ae.stopPropagation()}>
                {e.camp.website && (
                  <a class="food-link" href={e.camp.website} target="_blank" rel="noopener">Website ↗</a>
                )}
                {e.camp.url && (
                  <a class="food-link" href={e.camp.url} target="_blank" rel="noopener">Official listing ↗</a>
                )}
                <button
                  type="button"
                  class="food-link food-open-camp"
                  onClick={(be) => { be.stopPropagation(); onGotoCamp(e.camp.id); }}
                >View camp details →</button>
              </div>
            </div>
          )}
        </div>
      </li>
    );
  }

  return (
    <div class="food-wrap">
      <p class="food-intro">
        Find meals and snacks being served now or coming up. Search by dish,
        camp, or dietary option to plan your next stop.
      </p>

      <div class="food-search-sticky">
        <input
          class="food-search"
          type="search"
          value={query}
          placeholder="Search by dish, camp, or dietary option…"
          aria-label="Search food"
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>

      {picks.length > 0 && (
        <section class="food-section food-picks">
          <h3 class="food-section-head">
            <span aria-hidden="true">★</span> Your upcoming picks{' '}
            <span class="food-section-count">({picks.length})</span>
          </h3>
          <ul class="food-list">
            {picks.map(renderEntry)}
          </ul>
        </section>
      )}

      <div class="food-controls">
        <button
          type="button"
          class={'sched-filter-btn near' + (nearMeActive ? ' active' : '')}
          aria-pressed={nearMeActive ? 'true' : 'false'}
          title={brc
            ? 'Show only food at camps within ~15 min walk'
            : 'Near-me needs this year’s map geometry'}
          onClick={toggleNearMe}
          disabled={!brc}
        >📍 Near me</button>
        {nearMeActive && (geo.status === 'idle' || geo.status === 'requesting') && (
          <span class="sched-filter-hint">Waiting for GPS…</span>
        )}
        {nearMeActive && geo.status === 'denied' && (
          <span class="sched-filter-hint err">
            Location denied — enable it in browser settings to use Near me.
          </span>
        )}
        {nearMeActive && geo.status === 'error' && (
          <span class="sched-filter-hint err">Location error: {geo.message}</span>
        )}
        <button
          type="button"
          class="food-refresh"
          title="Update food availability for the current time"
          onClick={refreshNow}
        >🔄 Refresh availability</button>
        <span class="food-asof">
          Updated at {nowSnapshot.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>

      {allTypes.length > 0 && (
        <div class="food-filterbar" role="group" aria-label="Filter by food type">
          {allTypes.map((t) => {
            const on = selectedTypes.has(t);
            return (
              <button
                key={t}
                type="button"
                class={'food-typechip' + (on ? ' active' : '')}
                aria-pressed={on ? 'true' : 'false'}
                onClick={() => toggleType(t)}
              >{t}</button>
            );
          })}
          {selectedTypes.size > 0 && (
            <button type="button" class="food-filter-clear" onClick={() => setSelectedTypes(new Set())}>
              clear
            </button>
          )}
        </div>
      )}

      {nothing && (
        <div class="food-empty">
          {q || selectedTypes.size > 0 || nearMeActive
            ? 'No food matches your search or filters.'
            : 'No food listings are available.'}
        </div>
      )}

      {SECTIONS.map(({ key, icon, title }) => {
        const list = bySection[key];
        if (list.length === 0) return null;
        const isCollapsed = collapsedSections.has(key);
        return (
          <section class="food-section" key={key}>
            <h3 class="food-section-head">
              <button
                type="button"
                class="food-section-toggle"
                aria-expanded={isCollapsed ? 'false' : 'true'}
                onClick={() => toggleSection(key)}
              >
                <span class="food-section-indicator" aria-hidden="true">
                  {isCollapsed ? '+' : '−'}
                </span>
                <span aria-hidden="true">{icon}</span> {title}{' '}
                <span class="food-section-count">({list.length})</span>
              </button>
            </h3>
            <ul class={'food-list' + (isCollapsed ? ' collapsed' : '')}>
              {list.map(renderEntry)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
