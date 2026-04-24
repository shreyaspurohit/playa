// Chronological calendar of favorited events. One column per date in
// the effective burn window (earliest fetched event → configured burn
// end) — typically 14-15 days, so the 7-col CSS grid wraps into two
// rows of 7. Recurring events appear in every matching-weekday cell;
// single-occurrence events land in the cell whose date matches their
// canonical start_date. Events with no parse time drop to the bottom
// "Unscheduled" section.
//
// "Favorited" = either you or any imported friend has starred the
// event. Starring a whole camp does NOT auto-add its events here.
import { useMemo, useState } from 'preact/hooks';
import type { Camp, Event } from '../types';
import { friendChipStyle } from '../utils/friendColor';
import { EyeIcon } from './EyeIcon';
import { useGeolocation } from '../hooks/useGeolocation';
import { addressToLatLng, haversineMeters } from '../map/address';

/** "Near me" proximity cutoff: ~1 km ≈ 15 min walk at 4 km/h. Events
 *  farther than this from the user's GPS fix get dropped when the
 *  filter is on. */
const NEAR_ME_METERS = 1000;
/** "Now" window: events starting within the next 2 hours on today's
 *  cell stay; everything else drops. Matches "what should I do right
 *  now vs go back to camp?" mental model. */
const NOW_WINDOW_HOURS = 2;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
type DayKey = typeof WEEKDAYS[number];

/** Zero-pad an integer to 2 digits — small enough to inline. */
function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

/** One column in the grid. `iso` (YYYY-MM-DD) is a stable React key;
 *  `weekday` lets recurring events fan across every matching cell;
 *  `dateLabel` (M/D) shows up in the header + matches canonicalized
 *  `parsed_time.start_date` for single-occurrence events. */
interface DayCell {
  iso: string;
  weekday: DayKey;
  dateLabel: string;
}

/** Walk from `startISO` to `endISO` (inclusive), emitting one cell per
 *  day. Returns [] on unparseable or inverted inputs so the view drops
 *  to its empty state rather than crashing. UTC internally to dodge
 *  DST transitions that might double-count or skip a day. */
function buildCalendarCells(startISO: string, endISO: string): DayCell[] {
  if (!startISO || !endISO) return [];
  const start = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
  const cells: DayCell[] = [];
  const cur = new Date(start);
  // Cap defensively at 60 days: protects against a pathological meta
  // tag (burn_end years after burn_start) from producing a huge grid.
  for (let i = 0; i < 60 && cur <= end; i++) {
    cells.push({
      iso: cur.toISOString().slice(0, 10),
      weekday: WEEKDAYS[cur.getUTCDay()],
      dateLabel: `${cur.getUTCMonth() + 1}/${cur.getUTCDate()}`,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return cells;
}

export interface ScheduleEntry {
  event: Event;
  camp: Camp;
  /** For sorting; 24h "HH:MM" or "" when we couldn't parse a time. */
  startTime: string;
  /** Who starred this event — may include `youLabel`. */
  starredBy: string[];
}

interface Props {
  camps: Camp[];
  favEventIds: Set<string>;
  friendFavEventIds: (id: string) => string[];   // returns friend names
  /** Effective burn-week window from meta tags. The start is derived
   *  from the earliest fetched event (so volunteer-week shows up); the
   *  end is Config.burn_end. See backend/src/playa/timeparser.py. */
  burnStart?: string;                             // 'YYYY-MM-DD'
  burnEnd?: string;                               // 'YYYY-MM-DD'
  /** Per-day hide state for recurring events. `isDayHidden(id, iso)`
   *  tells us to stash this (event, day) pair in the column's hidden
   *  footer instead of the main list; `onToggleDayHidden(id, iso)`
   *  flips it. */
  isDayHidden: (eventId: string, iso: string) => boolean;
  onToggleDayHidden: (eventId: string, iso: string) => void;
  /** Total hidden (event, day) pairs across storage, for the
   *  "Clear hidden days" affordance. 0 → the control is hidden. */
  hiddenCount: number;
  onClearHidden: () => void;
  onGotoCamp: (campId: string) => void;
  youLabel?: string;
}

/** 12h pretty-print from "HH:MM" 24h. */
function to12h(hm24: string): string {
  if (!hm24) return '';
  const [hStr, mStr] = hm24.split(':');
  const h = parseInt(hStr, 10);
  if (h === 0)  return `12:${mStr} AM`;
  if (h < 12)   return `${h}:${mStr} AM`;
  if (h === 12) return `12:${mStr} PM`;
  return `${h - 12}:${mStr} PM`;
}

function byStart(a: ScheduleEntry, b: ScheduleEntry) {
  if (a.startTime && b.startTime && a.startTime !== b.startTime) {
    return a.startTime.localeCompare(b.startTime);
  }
  return a.event.name.localeCompare(b.event.name);
}

/** Bucket every starred event into one or more DayCells. Single-
 *  occurrence events land in the one cell whose dateLabel matches
 *  `parsed_time.start_date`; recurring events fan across every cell
 *  whose weekday is in `parsed_time.days`. Events with no parsed
 *  time drop to the Unscheduled bucket. Entries the user has hidden
 *  for a specific day are separated into `hiddenByCell` — still
 *  rendered per-column, but collapsed behind a "N hidden · show"
 *  disclosure. */
function collectSchedule(
  camps: Camp[],
  favEventIds: Set<string>,
  friendFavEventIds: (id: string) => string[],
  youLabel: string,
  cells: DayCell[],
  isDayHidden: (eventId: string, iso: string) => boolean,
): {
  byCell: Map<string, ScheduleEntry[]>;
  hiddenByCell: Map<string, ScheduleEntry[]>;
  unscheduled: ScheduleEntry[];
} {
  // Index for O(1) lookups.
  const cellByDate = new Map<string, DayCell>();
  const cellsByWeekday = new Map<DayKey, DayCell[]>();
  for (const c of cells) {
    // First-occurrence-wins for dateLabel: if the window ever repeated
    // a date (it can't across a single burn year, but be defensive),
    // the first cell keeps the bucket.
    if (!cellByDate.has(c.dateLabel)) cellByDate.set(c.dateLabel, c);
    const list = cellsByWeekday.get(c.weekday);
    if (list) list.push(c);
    else cellsByWeekday.set(c.weekday, [c]);
  }

  const byCell = new Map<string, ScheduleEntry[]>();
  const hiddenByCell = new Map<string, ScheduleEntry[]>();
  const unscheduled: ScheduleEntry[] = [];

  const push = (iso: string, eventId: string, entry: ScheduleEntry) => {
    const bucket = isDayHidden(eventId, iso) ? hiddenByCell : byCell;
    const list = bucket.get(iso);
    if (list) list.push(entry);
    else bucket.set(iso, [entry]);
  };

  for (const camp of camps) {
    for (const event of camp.events ?? []) {
      const mine = favEventIds.has(event.id);
      const friends = friendFavEventIds(event.id);
      if (!mine && friends.length === 0) continue;
      const starredBy: string[] = [];
      if (mine) starredBy.push(youLabel);
      starredBy.push(...friends);

      const p = event.parsed_time;
      if (!p) {
        unscheduled.push({ event, camp, starredBy, startTime: '' });
        continue;
      }
      const entry: ScheduleEntry = {
        event, camp, starredBy, startTime: p.start_time || '',
      };

      if (p.kind === 'single') {
        // Prefer exact date match; fall back to first occurrence of the
        // weekday in the window if the fetched date doesn't align with
        // our effective window.
        const cell = (p.start_date && cellByDate.get(p.start_date))
          || (p.start_day && cellsByWeekday.get(p.start_day as DayKey)?.[0])
          || null;
        if (cell) push(cell.iso, event.id, entry);
        else unscheduled.push(entry);
      } else {
        // Recurring: every matching-weekday cell in the window.
        let placed = false;
        for (const d of p.days) {
          const matches = cellsByWeekday.get(d as DayKey) ?? [];
          for (const cell of matches) {
            push(cell.iso, event.id, entry);
            placed = true;
          }
        }
        if (!placed) unscheduled.push(entry);
      }
    }
  }

  for (const list of byCell.values()) list.sort(byStart);
  for (const list of hiddenByCell.values()) list.sort(byStart);
  unscheduled.sort(byStart);
  return { byCell, hiddenByCell, unscheduled };
}

function EventRow({ e, onGotoCamp, youLabel, onToggleHide, hidden }: {
  e: ScheduleEntry;
  onGotoCamp: (id: string) => void;
  youLabel: string;
  /** Called with no args — the parent already knows the (eventId, iso)
   *  pair because it rendered this row in a specific cell. */
  onToggleHide?: () => void;
  /** When true, this row is shown inside the "hidden" disclosure and
   *  the button restores it; when false, the button hides it. */
  hidden?: boolean;
}) {
  const p = e.event.parsed_time;
  const st = p ? to12h(p.start_time) : '';
  const et = p ? to12h(p.end_time) : '';
  const span = p && p.end_day && p.end_day !== p.start_day ? ` → ${p.end_day}` : '';
  const evUrl = `https://directory.burningman.org/events/${encodeURIComponent(e.event.id)}/`;
  return (
    <li class={'sched-row' + (hidden ? ' hidden' : '')}>
      <div class="sched-time">
        {st && et ? <span>{st}<span class="sched-dash"> – </span>{et}{span}</span> : <em>no time</em>}
      </div>
      <div class="sched-main">
        <div class="sched-row-head">
          <a class="sched-evname" href={evUrl} target="_blank" rel="noopener">
            {e.event.name}
          </a>
          {onToggleHide && (
            <button
              class="sched-hide-btn"
              type="button"
              title={hidden ? 'Show on this day' : 'Hide from this day'}
              aria-label={hidden ? 'Show' : 'Hide'}
              onClick={onToggleHide}
            >
              <EyeIcon slashed={!hidden} />
            </button>
          )}
        </div>
        <div class="sched-meta">
          at{' '}
          <button class="sched-campname" type="button" onClick={() => onGotoCamp(e.camp.id)}>
            {e.camp.name}
          </button>
          {e.camp.location && <> · {e.camp.location}</>}
        </div>
        {e.event.description && <p class="sched-desc">{e.event.description}</p>}
        <div class="sched-chips">
          {e.starredBy.map((n) => {
            const mine = n === youLabel;
            return (
              <span
                key={n}
                class={'sched-chip' + (mine ? ' mine' : ' friend')}
                style={mine ? undefined : friendChipStyle(n)}
              >★ {n}</span>
            );
          })}
        </div>
      </div>
    </li>
  );
}

function DayColumn({
  cell, entries, hiddenEntries, onGotoCamp, youLabel, onToggleHide,
}: {
  cell: DayCell;
  entries: ScheduleEntry[];
  hiddenEntries: ScheduleEntry[];
  onGotoCamp: (id: string) => void;
  youLabel: string;
  onToggleHide: (eventId: string, iso: string) => void;
}) {
  return (
    <section class="sched-day">
      <h3 class="sched-day-head">
        {cell.weekday} {cell.dateLabel}
        <span class="sched-day-count">{entries.length}</span>
      </h3>
      {entries.length === 0 ? (
        <div class="sched-empty">nothing starred</div>
      ) : (
        <ul class="sched-list">
          {entries.map((e) =>
            <EventRow
              key={`${cell.iso}:${e.event.id}`} e={e}
              onGotoCamp={onGotoCamp} youLabel={youLabel}
              onToggleHide={() => onToggleHide(e.event.id, cell.iso)}
            />)}
        </ul>
      )}
      {hiddenEntries.length > 0 && (
        <details class="sched-hidden">
          <summary>
            {hiddenEntries.length} hidden · show
          </summary>
          <ul class="sched-list">
            {hiddenEntries.map((e) =>
              <EventRow
                key={`${cell.iso}:hidden:${e.event.id}`} e={e}
                onGotoCamp={onGotoCamp} youLabel={youLabel}
                onToggleHide={() => onToggleHide(e.event.id, cell.iso)}
                hidden
              />)}
          </ul>
        </details>
      )}
    </section>
  );
}

export function ScheduleView({
  camps, favEventIds, friendFavEventIds, burnStart, burnEnd,
  isDayHidden, onToggleDayHidden, hiddenCount, onClearHidden,
  onGotoCamp, youLabel = 'you',
}: Props) {
  const cells = useMemo(
    () => buildCalendarCells(burnStart ?? '', burnEnd ?? ''),
    [burnStart, burnEnd],
  );
  const [expanded, setExpanded] = useState<Set<string>>(
    // Start with every non-empty day open on mobile.
    () => new Set(cells.map((c) => c.iso)),
  );

  // "What should I do in the next 2 hours" + "near me" proximity
  // filters. Both default off so the full schedule shows on open.
  const [nowOnly, setNowOnly] = useState(false);
  const [nearMeOnly, setNearMeOnly] = useState(false);

  // Own geolocation watcher — the Map tab has its own; only one
  // view is mounted at a time so we don't fight over permissions
  // or run two watchers in parallel.
  const { state: geo, request: requestGps } = useGeolocation();

  function toggleNearMe() {
    if (nearMeOnly) {
      setNearMeOnly(false);
      return;
    }
    // Flip on first, then kick off the permission flow. If the user
    // denies we leave the toggle on and surface an inline hint so
    // they know why no results appeared.
    setNearMeOnly(true);
    if (geo.status === 'idle' || geo.status === 'denied') requestGps();
  }

  // Today's cell (iso match by M/D so local/UTC mismatches don't
  // swallow a burn-day). Null when today isn't in the burn window.
  const todayCell = useMemo(() => {
    const now = new Date();
    const md = `${now.getMonth() + 1}/${now.getDate()}`;
    return cells.find((c) => c.dateLabel === md) ?? null;
  }, [cells]);

  // Current HH:MM + 2-hour horizon, both as 24-h strings for direct
  // lexicographic comparison with ScheduleEntry.startTime.
  const nowBounds = useMemo(() => {
    const now = new Date();
    const cur = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    const endMin = now.getHours() * 60 + now.getMinutes() + NOW_WINDOW_HOURS * 60;
    const endH = Math.floor((endMin % (24 * 60)) / 60);
    const endM = endMin % 60;
    const end = pad2(endH) + ':' + pad2(endM);
    return { cur, end, wrapsMidnight: endMin >= 24 * 60 };
  }, [nowOnly]); // recomputed when toggle flips so filter feels fresh

  // Cache per-event camp distance (meters) when nearMeOnly is on.
  // Null = no fix / filter off. Events with an unparseable camp
  // address are treated as "too far" and drop.
  const nearMeFit = useMemo(() => {
    if (!nearMeOnly || geo.status !== 'ready') return null;
    const user = { lat: geo.lat, lng: geo.lng };
    const byEvent = new Map<string, boolean>();
    for (const camp of camps) {
      const ll = addressToLatLng(camp.location);
      const fits = ll ? haversineMeters(user, ll) <= NEAR_ME_METERS : false;
      for (const ev of camp.events ?? []) byEvent.set(ev.id, fits);
    }
    return byEvent;
  }, [nearMeOnly, geo, camps]);

  function passesFilters(entry: ScheduleEntry, cellIso: string): boolean {
    if (nowOnly) {
      if (!todayCell || cellIso !== todayCell.iso) return false;
      if (!entry.startTime) return false;
      // The next-2h window can wrap past midnight late at night; we
      // still only match events on today's cell here though, so a
      // wrap effectively means "everything left on the schedule today
      // counts." Keeps the rule simple.
      if (nowBounds.wrapsMidnight) {
        if (entry.startTime < nowBounds.cur) return false;
      } else if (entry.startTime < nowBounds.cur || entry.startTime > nowBounds.end) {
        return false;
      }
    }
    if (nearMeOnly) {
      if (!nearMeFit) return false;
      if (!nearMeFit.get(entry.event.id)) return false;
    }
    return true;
  }

  const { byCell: rawByCell, hiddenByCell, unscheduled } = useMemo(
    () => collectSchedule(
      camps, favEventIds, friendFavEventIds, youLabel, cells, isDayHidden,
    ),
    [camps, favEventIds, friendFavEventIds, youLabel, cells, isDayHidden],
  );

  // Apply Now + Near-me filters. We filter by-cell so the empty-
  // days render case (grid with empty columns) still works.
  const byCell = useMemo(() => {
    if (!nowOnly && !nearMeOnly) return rawByCell;
    const out = new Map<string, ScheduleEntry[]>();
    for (const [iso, entries] of rawByCell) {
      const kept = entries.filter((e) => passesFilters(e, iso));
      if (kept.length > 0) out.set(iso, kept);
    }
    return out;
    // passesFilters closes over nowOnly/nearMeOnly/todayCell/etc; we
    // depend on the raw map + all filter inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawByCell, nowOnly, nearMeOnly, todayCell, nowBounds, nearMeFit]);

  const totalScheduled = cells.reduce(
    (n, c) => n + (byCell.get(c.iso)?.length ?? 0), 0,
  );
  const totalHiddenInWindow = cells.reduce(
    (n, c) => n + (hiddenByCell.get(c.iso)?.length ?? 0), 0,
  );
  const nothing = totalScheduled === 0 && totalHiddenInWindow === 0 && unscheduled.length === 0;
  const filtersOn = nowOnly || nearMeOnly;

  return (
    <div class="schedule-wrap">
      <div class="schedule-filters">
        <button
          type="button"
          class={'sched-filter-btn' + (nowOnly ? ' active' : '')}
          aria-pressed={nowOnly ? 'true' : 'false'}
          title={
            todayCell
              ? `Show only events starting in the next ${NOW_WINDOW_HOURS} hours`
              : 'Only useful when today is in the burn window'
          }
          onClick={() => setNowOnly((v) => !v)}
        >
          ⚡ Now
        </button>
        <button
          type="button"
          class={'sched-filter-btn near' + (nearMeOnly ? ' active' : '')}
          aria-pressed={nearMeOnly ? 'true' : 'false'}
          title="Show only events at camps within ~15 min walk"
          onClick={toggleNearMe}
        >
          📍 Near me
        </button>
        {filtersOn && (
          <button
            type="button" class="subtle-btn sched-filter-clear"
            onClick={() => { setNowOnly(false); setNearMeOnly(false); }}
          >
            Clear filters
          </button>
        )}
        {nowOnly && !todayCell && (
          <span class="sched-filter-hint">
            Today isn't in the burn window yet — filter will match once
            it is.
          </span>
        )}
        {nearMeOnly && (geo.status === 'idle' || geo.status === 'requesting') && (
          <span class="sched-filter-hint">Waiting for GPS…</span>
        )}
        {nearMeOnly && geo.status === 'denied' && (
          <span class="sched-filter-hint err">
            Location denied — enable it in browser settings to use Near me.
          </span>
        )}
        {nearMeOnly && geo.status === 'error' && (
          <span class="sched-filter-hint err">
            Location error: {geo.message}
          </span>
        )}
      </div>
      <div class="schedule-notice">
        Tap <span class="schedule-notice-star">☆</span> next to any event
        to add it here &mdash; starring a camp doesn't add its events.
        Tap <span class="schedule-notice-icon"><EyeIcon slashed /></span>
        on a column to hide a recurring event from a single day.
      </div>

      {hiddenCount > 0 && (
        <div class="schedule-hidden-bar">
          <span>
            <strong>{hiddenCount}</strong> event-day
            {hiddenCount === 1 ? '' : 's'} hidden across the calendar.
          </span>
          <button type="button" class="subtle-btn" onClick={onClearHidden}>
            Clear hidden days
          </button>
        </div>
      )}

      {nothing ? (
        <div class="empty-state">
          No starred events yet. Head to Camps, find something interesting,
          expand its events list, and tap the ☆ next to an event you want to
          attend. It'll show up here grouped by day.
        </div>
      ) : (
        <>
          {/* Desktop: 7-col grid that wraps to row 2 for the second burn
              week. Mobile: accordion in chronological order. */}
          <div class="schedule-grid">
            {cells.map((c) => (
              <DayColumn
                key={c.iso} cell={c}
                entries={byCell.get(c.iso) ?? []}
                hiddenEntries={hiddenByCell.get(c.iso) ?? []}
                onGotoCamp={onGotoCamp} youLabel={youLabel}
                onToggleHide={onToggleDayHidden}
              />
            ))}
          </div>
          <div class="schedule-accordion">
            {cells.map((c) => {
              const entries = byCell.get(c.iso) ?? [];
              const hidden = hiddenByCell.get(c.iso) ?? [];
              if (entries.length === 0 && hidden.length === 0) return null;
              const open = expanded.has(c.iso);
              return (
                <details
                  key={c.iso}
                  open={open}
                  onToggle={(e) => {
                    const det = e.target as HTMLDetailsElement;
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (det.open) next.add(c.iso); else next.delete(c.iso);
                      return next;
                    });
                  }}
                >
                  <summary>
                    {c.weekday} {c.dateLabel}
                    <span class="sched-day-count">{entries.length}</span>
                  </summary>
                  <ul class="sched-list">
                    {entries.map((e) =>
                      <EventRow
                        key={`${c.iso}:${e.event.id}`} e={e}
                        onGotoCamp={onGotoCamp} youLabel={youLabel}
                        onToggleHide={() => onToggleDayHidden(e.event.id, c.iso)}
                      />)}
                  </ul>
                  {hidden.length > 0 && (
                    <details class="sched-hidden">
                      <summary>{hidden.length} hidden · show</summary>
                      <ul class="sched-list">
                        {hidden.map((e) =>
                          <EventRow
                            key={`${c.iso}:hidden:${e.event.id}`} e={e}
                            onGotoCamp={onGotoCamp} youLabel={youLabel}
                            onToggleHide={() => onToggleDayHidden(e.event.id, c.iso)}
                            hidden
                          />)}
                      </ul>
                    </details>
                  )}
                </details>
              );
            })}
          </div>

          {unscheduled.length > 0 && (
            <section class="sched-unscheduled">
              <h3 class="sched-day-head">
                Unscheduled
                <span class="sched-day-count">{unscheduled.length}</span>
              </h3>
              <p class="footnote">
                These events had times the parser didn't recognize — the raw
                text from directory.burningman.org is shown as the event
                description.
              </p>
              <ul class="sched-list">
                {unscheduled.map((e) =>
                  <EventRow
                    key={`uns:${e.event.id}`} e={e}
                    onGotoCamp={onGotoCamp} youLabel={youLabel}
                  />,
                )}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
