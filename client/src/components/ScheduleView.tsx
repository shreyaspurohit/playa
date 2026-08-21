// Chronological calendar of favorited events. One column per date in
// the configured burn window — typically 9 days, so the 7-col CSS grid
// wraps into two
// rows of 7. Recurring events appear in every matching-weekday cell;
// single-occurrence events land in the cell whose date matches their
// canonical start_date. Events with no parse time drop to the bottom
// "Unscheduled" section.
//
// "Favorited" = either you or any imported friend has starred the
// event. Starring a whole camp does NOT auto-add its events here.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Camp, Event } from '../types';
import { friendChipStyle } from '../utils/friendColor';
import { AddJournalButton } from './AddJournalButton';
import { EyeIcon } from './EyeIcon';
import { useGeolocation } from '../hooks/useGeolocation';
import { addressToLatLng, haversineMeters } from '../map/address';
import { brcForSource } from '../hooks/useSource';
import { now, playaTimeParts } from '../utils/clock';
import type { Source } from '../types';

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

// Stable id for the desktop day agenda, so each day tab can point its
// aria-controls at the single tabpanel it drives.
const SCHED_TABPANEL_ID = 'sched-tabpanel';

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

function addIsoDays(iso: string, days: number): string {
  const value = new Date(iso + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
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
  /** Authoritative burn-week window from build metadata. */
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
  /** Active data source — drives the per-year BRC geometry used for
   *  "near me" distance calculations on event camps. */
  source: Source;
  /** Shared minute-level clock from App. Optional for isolated rendering. */
  nowSnapshot?: Date;
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

/** ISO-minute key for the end of this occurrence. The cell supplies the
 * occurrence date for recurring events; overnight spans advance from there. */
function occurrenceEndKey(entry: ScheduleEntry, cellIso: string): string | null {
  const p = entry.event.parsed_time;
  if (!p || !entry.startTime) return null;
  const endTime = p.end_time || entry.startTime;
  let dayOffset = 0;
  if (p.start_day && p.end_day && p.start_day !== p.end_day) {
    const startIndex = WEEKDAYS.indexOf(p.start_day as DayKey);
    const endIndex = WEEKDAYS.indexOf(p.end_day as DayKey);
    if (startIndex >= 0 && endIndex >= 0) {
      dayOffset = (endIndex - startIndex + WEEKDAYS.length) % WEEKDAYS.length;
    }
  } else if (endTime < entry.startTime) {
    dayOffset = 1;
  }
  return `${addIsoDays(cellIso, dayOffset)}T${endTime}`;
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
        // our configured window.
        const cell = (p.start_date && cellByDate.get(p.start_date))
          || (p.start_day && cellsByWeekday.get(p.start_day as DayKey)?.[0])
          || null;
        if (cell) push(cell.iso, event.id, entry);
        else unscheduled.push(entry);
      } else {
        // Recurring: every matching-weekday cell on or after the event's
        // canonical start date. Without this gate, a Tue/Wed/Fri event that
        // starts 9/1 also appears in matching columns from the prior week.
        const recurringStart = p.start_date
          ? cellByDate.get(p.start_date) ?? null
          : null;
        let placed = false;
        for (const d of p.days) {
          const matches = cellsByWeekday.get(d as DayKey) ?? [];
          for (const cell of matches) {
            if (recurringStart && cell.iso < recurringStart.iso) continue;
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

function StarChips({ e, youLabel }: { e: ScheduleEntry; youLabel: string }) {
  return (
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
  );
}

function HideButton({ onToggleHide, hidden }: { onToggleHide: () => void; hidden?: boolean }) {
  return (
    <button
      class="sched-hide-btn"
      type="button"
      title={hidden ? 'Show on this day' : 'Hide from this day'}
      aria-label={hidden ? 'Show' : 'Hide'}
      onClick={onToggleHide}
    >
      <EyeIcon slashed={!hidden} />
    </button>
  );
}

function EventRow({ e, onGotoCamp, youLabel, onToggleHide, hidden, dense }: {
  e: ScheduleEntry;
  onGotoCamp: (id: string) => void;
  youLabel: string;
  /** Called with no args — the parent already knows the (eventId, iso)
   *  pair because it rendered this row in a specific cell. */
  onToggleHide?: () => void;
  /** When true, this row is shown inside the "hidden" disclosure and
   *  the button restores it; when false, the button hides it. */
  hidden?: boolean;
  /** Compact layout for the desktop single-day agenda: time on the left,
   *  then name · camp with the description beneath, and stars/actions on the
   *  right. Mobile and Unscheduled keep the original stacked row. */
  dense?: boolean;
}) {
  const p = e.event.parsed_time;
  const st = p ? to12h(p.start_time) : '';
  const et = p ? to12h(p.end_time) : '';
  const span = p && p.end_day && p.end_day !== p.start_day ? ` → ${p.end_day}` : '';
  // Per-day hide only makes sense for a recurring event (drop it from one of
  // its days). Single-occurrence events don't offer it — but an already-hidden
  // row always keeps its restore button so nothing can get stranded.
  const showHide = onToggleHide && (hidden || p?.kind === 'recurring');
  const camp = (
    <span class="sched-meta">
      at{' '}
      <button class="sched-campname" type="button" onClick={() => onGotoCamp(e.camp.id)}>
        {e.camp.name}
      </button>
      {e.camp.location && <> · {e.camp.location}</>}
    </span>
  );

  if (dense) {
    return (
      <li class={'sched-row dense' + (hidden ? ' hidden' : '')}>
        <span class="sched-time">
          {st && et ? <span>{st}<span class="sched-dash"> – </span>{et}{span}</span> : <em>no time</em>}
        </span>
        <span class="sched-dtitle">
          <span class="sched-dtitle-head">
            <span class="sched-evname">{e.event.name}</span>
            {camp}
          </span>
          {e.event.description && <p class="sched-desc">{e.event.description}</p>}
        </span>
        <StarChips e={e} youLabel={youLabel} />
        <span class="sched-row-actions">
          <AddJournalButton compact context={{ kind: 'event', title: e.event.name, campName: e.camp.name }} />
          {showHide && <HideButton onToggleHide={onToggleHide!} hidden={hidden} />}
        </span>
      </li>
    );
  }

  return (
    <li class={'sched-row' + (hidden ? ' hidden' : '')}>
      <div class="sched-time">
        {st && et ? <span>{st}<span class="sched-dash"> – </span>{et}{span}</span> : <em>no time</em>}
      </div>
      <div class="sched-main">
        <div class="sched-row-head">
          <span class="sched-evname">{e.event.name}</span>
          <AddJournalButton compact context={{ kind: 'event', title: e.event.name, campName: e.camp.name }} />
          {showHide && <HideButton onToggleHide={onToggleHide!} hidden={hidden} />}
        </div>
        {camp}
        {e.event.description && <p class="sched-desc">{e.event.description}</p>}
        <StarChips e={e} youLabel={youLabel} />
      </div>
    </li>
  );
}

/** The desktop single-day agenda: the selected day's events as a dense,
 *  one-line-per-event list, with the per-day eye-hidden entries tucked
 *  behind a disclosure. No header/collapse — the day tab above owns that. */
function DayAgenda({
  cell, entries, hiddenEntries, onGotoCamp, youLabel, onToggleHide, panelId, labelId,
}: {
  cell: DayCell;
  entries: ScheduleEntry[];
  hiddenEntries: ScheduleEntry[];
  onGotoCamp: (id: string) => void;
  youLabel: string;
  onToggleHide: (eventId: string, iso: string) => void;
  panelId: string;
  labelId: string;
}) {
  return (
    <section class="schedule-agenda" id={panelId} role="tabpanel" aria-labelledby={labelId}>
      {entries.length === 0 ? (
        <div class="sched-empty">No starred events on {cell.weekday} {cell.dateLabel}.</div>
      ) : (
        <ul class="sched-list">
          {entries.map((e) =>
            <EventRow
              key={`${cell.iso}:${e.event.id}`} e={e} dense
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
                key={`${cell.iso}:hidden:${e.event.id}`} e={e} dense
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
  source, nowSnapshot,
}: Props) {
  const brc = useMemo(() => brcForSource(source), [source]);
  const cells = useMemo(
    () => buildCalendarCells(burnStart ?? '', burnEnd ?? ''),
    [burnStart, burnEnd],
  );
  // Desktop day-tab selection. Null until the user picks a tab; the resolved
  // selection (see selectedIso below) is *derived* each render so it follows
  // late-arriving burn metadata, BRC-midnight rollover, and active filters
  // instead of a value seeded once at mount.
  const [selectedIsoRaw, setSelectedIsoRaw] = useState<string | null>(null);
  // Mobile accordion per-day open overrides. Empty by default; the open state
  // is *derived* each render (see isDayOpen) for the same reasons. Only
  // genuine user deviations from the default are stored.
  const [dayOverride, setDayOverride] = useState<Map<string, boolean>>(
    () => new Map(),
  );

  // Schedule filters default off so the full schedule shows on open.
  const [nowOnly, setNowOnly] = useState(false);
  const [hidePast, setHidePast] = useState(false);
  const [nearMeOnly, setNearMeOnly] = useState(false);
  // Geometry can disappear while this component remains mounted when the
  // user switches sources. Disable the filter immediately for rendering, then
  // clear its stored state so switching back does not unexpectedly reactivate
  // it for a different year.
  const nearMeActive = nearMeOnly && brc !== null;
  const { state: geo, request: requestGps, stop: stopGps } = useGeolocation();
  const currentInstant = nowSnapshot ?? now();
  const currentPlayaTime = useMemo(
    () => playaTimeParts(currentInstant),
    [currentInstant],
  );
  useEffect(() => {
    if (!brc && nearMeOnly) {
      setNearMeOnly(false);
      stopGps();
    }
  }, [brc, nearMeOnly, stopGps]);

  // Own geolocation watcher — the Map tab has its own. Stop this watch when
  // Near me is turned off; all tab views remain mounted for fast switching.

  function toggleNearMe() {
    if (nearMeOnly) {
      setNearMeOnly(false);
      stopGps();
      return;
    }
    if (!brc) return;
    // Flip on first, then kick off the permission flow. If the user
    // denies we leave the toggle on and surface an inline hint so
    // they know why no results appeared.
    setNearMeOnly(true);
    if (geo.status === 'idle' || geo.status === 'denied') requestGps();
  }

  // Today's cell. Matched on the full YYYY-MM-DD, not just M/D: both sides
  // are already calendar dates in one frame (playaTimeParts normalizes
  // through Intl in the Playa zone; cell.iso is the literal window-config
  // string), so there's no local/UTC skew to dodge, and a same-M/D date in
  // a different year — a stale build viewed the next season, or a preview
  // ahead of the burn — must not read as "today". Null when today isn't in
  // the burn window.
  const todayCell = useMemo(() => {
    const iso = `${currentPlayaTime.year}-${pad2(currentPlayaTime.month)}-${pad2(currentPlayaTime.day)}`;
    return cells.find((c) => c.iso === iso) ?? null;
  }, [cells, currentPlayaTime]);

  // Current HH:MM + 2-hour horizon, both as 24-h strings for direct
  // lexicographic comparison with ScheduleEntry.startTime.
  const nowBounds = useMemo(() => {
    const cur = pad2(currentPlayaTime.hours) + ':' + pad2(currentPlayaTime.minutes);
    const endMin = currentPlayaTime.hours * 60 + currentPlayaTime.minutes + NOW_WINDOW_HOURS * 60;
    const endH = Math.floor((endMin % (24 * 60)) / 60);
    const endM = endMin % 60;
    const end = pad2(endH) + ':' + pad2(endM);
    return { cur, end, wrapsMidnight: endMin >= 24 * 60 };
  }, [currentPlayaTime]);

  // Hide-past compares each occurrence end with the Playa wall clock, rather
  // than the browser's timezone. App refreshes the shared instant each minute.
  const pastCutoff = useMemo(() => {
    return {
      date: `${currentPlayaTime.year}-${pad2(currentPlayaTime.month)}-${pad2(currentPlayaTime.day)}`,
      time: pad2(currentPlayaTime.hours) + ':' + pad2(currentPlayaTime.minutes),
    };
  }, [currentPlayaTime]);

  // Cache per-event camp distance (meters) when nearMeOnly is on.
  // Null = no fix / filter off. Events with an unparseable camp
  // address are treated as "too far" and drop.
  const nearMeFit = useMemo(() => {
    if (!brc || !nearMeActive || geo.status !== 'ready') return null;
    const user = { lat: geo.lat, lng: geo.lng };
    const byEvent = new Map<string, boolean>();
    for (const camp of camps) {
      const ll = addressToLatLng(camp.location, brc);
      const fits = ll ? haversineMeters(user, ll) <= NEAR_ME_METERS : false;
      for (const ev of camp.events ?? []) byEvent.set(ev.id, fits);
    }
    return byEvent;
  }, [nearMeActive, geo, camps, brc]);

  function passesFilters(entry: ScheduleEntry, cellIso: string): boolean {
    if (hidePast) {
      const endKey = occurrenceEndKey(entry, cellIso);
      if (endKey && endKey <= `${pastCutoff.date}T${pastCutoff.time}`) return false;
    }
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
    if (nearMeActive) {
      if (!nearMeFit) return false;
      if (!nearMeFit.get(entry.event.id)) return false;
    }
    return true;
  }

  const { byCell: rawByCell, hiddenByCell: rawHiddenByCell, unscheduled } = useMemo(
    () => collectSchedule(
      camps, favEventIds, friendFavEventIds, youLabel, cells, isDayHidden,
    ),
    [camps, favEventIds, friendFavEventIds, youLabel, cells, isDayHidden],
  );

  // Apply Hide-past + Now + Near-me filters. We filter by-cell so the empty-
  // days render case (grid with empty columns) still works. Eye-hidden
  // occurrences must obey the same filters — otherwise a past event hidden on a
  // day stays expandable/counted once Hide-past is on.
  const applyFilters = (src: Map<string, ScheduleEntry[]>): Map<string, ScheduleEntry[]> => {
    if (!hidePast && !nowOnly && !nearMeActive) return src;
    const out = new Map<string, ScheduleEntry[]>();
    for (const [iso, entries] of src) {
      const kept = entries.filter((e) => passesFilters(e, iso));
      if (kept.length > 0) out.set(iso, kept);
    }
    return out;
  };
  const byCell = useMemo(
    () => applyFilters(rawByCell),
    // passesFilters/applyFilters close over all filter inputs listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawByCell, hidePast, nowOnly, nearMeActive, todayCell, nowBounds, nearMeFit, pastCutoff],
  );
  const hiddenByCell = useMemo(
    () => applyFilters(rawHiddenByCell),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawHiddenByCell, hidePast, nowOnly, nearMeActive, todayCell, nowBounds, nearMeFit, pastCutoff],
  );

  const totalScheduled = cells.reduce(
    (n, c) => n + (byCell.get(c.iso)?.length ?? 0), 0,
  );
  const totalHiddenInWindow = cells.reduce(
    (n, c) => n + (hiddenByCell.get(c.iso)?.length ?? 0), 0,
  );
  const nothing = totalScheduled === 0 && totalHiddenInWindow === 0 && unscheduled.length === 0;
  const filtersOn = hidePast || nowOnly || nearMeActive;

  // Which day to surface by default when the user hasn't chosen one: today
  // when it falls in the burn window, otherwise the first day (a pre-burn
  // visit still shows something). Deriving this — rather than seeding it once —
  // keeps it correct as burnStart/burnEnd arrive and as the shared clock
  // crosses BRC midnight.
  const primaryDayIso = todayCell?.iso ?? cells[0]?.iso;
  // Under an active filter, prefer today only if it still has matches, else the
  // first day that does, so the default never lands on an empty day.
  const firstMatchIso = filtersOn
    ? cells.find((c) => (byCell.get(c.iso)?.length ?? 0) > 0)?.iso
    : undefined;
  const defaultDayIso = filtersOn
    ? (primaryDayIso && (byCell.get(primaryDayIso)?.length ?? 0) > 0
        ? primaryDayIso : (firstMatchIso ?? primaryDayIso))
    : primaryDayIso;

  // Desktop day-tab: honor an explicit pick that's still in the window,
  // otherwise fall back to the derived default.
  const selectedIso = (selectedIsoRaw && cells.some((c) => c.iso === selectedIsoRaw))
    ? selectedIsoRaw : defaultDayIso;
  const selectedCell = cells.find((c) => c.iso === selectedIso) ?? null;

  // APG tabs keyboard nav on the tablist (handler on the container so it
  // fires whichever tab holds focus). Arrow/Home/End move the selection,
  // and since we use activation-follows-focus the roving tabIndex=0 must
  // travel with it — so we also move DOM focus to the new tab, otherwise
  // the old tab keeps focus at tabIndex=-1 and the strip becomes a keyboard
  // trap. Wraps around at both ends.
  const onTabsKeyDown = (e: KeyboardEvent) => {
    const idx = cells.findIndex((c) => c.iso === selectedIso);
    if (idx < 0) return;
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % cells.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + cells.length) % cells.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = cells.length - 1;
    else return;
    e.preventDefault();
    const iso = cells[next].iso;
    setSelectedIsoRaw(iso);
    // The keyed button node survives the re-render, so focusing it now (it is
    // programmatically focusable even at tabIndex=-1) sticks.
    document.getElementById(`sched-tab-${iso}`)?.focus();
  };
  // Keep the selected tab visible in the horizontally-scrolling strip — for
  // keyboard nav and for derived-default shifts (a filter toggle or BRC
  // midnight can move the selection without a user click). block:'nearest'
  // avoids yanking the page vertically. Benign: no focus is stolen here.
  // Query through the container ref rather than the global document so a
  // deferred effect that runs after unmount short-circuits on a null ref.
  const tablistRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tablistRef.current?.querySelector('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedIso]);

  // Mobile accordion: with a filter active, open every day that still has
  // matches so nothing hides behind a collapsed header; otherwise open only
  // the primary day.
  const dayDefaultOpen = (iso: string): boolean =>
    filtersOn ? (byCell.get(iso)?.length ?? 0) > 0 : iso === primaryDayIso;
  const isDayOpen = (iso: string): boolean => dayOverride.get(iso) ?? dayDefaultOpen(iso);
  // Live record of the open state we last *rendered* for each day, updated
  // below in the render body. `<details>` fires `toggle` for our own
  // programmatic `open` changes (a filter/midnight shift, or the twin
  // desktop/mobile tree re-syncing) as well as for user clicks, and the event
  // can dispatch synchronously during commit — before the handler's closure
  // reflects the new render. Reading a ref rather than recomputing a derived
  // value dodges that staleness entirely: a programmatic toggle always equals
  // what we just rendered (ignored), while a native user flip always differs
  // (recorded). A flip back to the default clears the override so it never
  // pins a stale value.
  const renderedOpen = useRef<Map<string, boolean>>(new Map());
  const setDayOpen = (iso: string, open: boolean) => {
    if (open === renderedOpen.current.get(iso)) return;
    setDayOverride((prev) => {
      const next = new Map(prev);
      if (open === dayDefaultOpen(iso)) next.delete(iso);
      else next.set(iso, open);
      return next;
    });
  };
  const nextRenderedOpen = new Map<string, boolean>();
  for (const c of cells) nextRenderedOpen.set(c.iso, isDayOpen(c.iso));
  renderedOpen.current = nextRenderedOpen;

  return (
    <div class="schedule-wrap">
      <div class="schedule-filters">
        <button
          type="button"
          class={'sched-filter-btn past' + (hidePast ? ' active' : '')}
          aria-pressed={hidePast ? 'true' : 'false'}
          title="Hide events whose scheduled end time has passed"
          onClick={() => setHidePast((v) => !v)}
        >
          🕘 Hide past
        </button>
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
          class={'sched-filter-btn near' + (nearMeActive ? ' active' : '')}
          aria-pressed={nearMeActive ? 'true' : 'false'}
          title={brc
            ? 'Show only events at camps within ~15 min walk'
            : 'Near-me filtering will be available when this year’s map geometry is published'}
          onClick={toggleNearMe}
          disabled={!brc}
        >
          📍 Near me
        </button>
        {filtersOn && (
          <button
            type="button" class="subtle-btn sched-filter-clear"
            onClick={() => { setHidePast(false); setNowOnly(false); setNearMeOnly(false); stopGps(); }}
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
        {nearMeActive && (geo.status === 'idle' || geo.status === 'requesting') && (
          <span class="sched-filter-hint">Waiting for GPS…</span>
        )}
        {nearMeActive && geo.status === 'denied' && (
          <span class="sched-filter-hint err">
            Location denied — enable it in browser settings to use Near me.
          </span>
        )}
        {nearMeActive && geo.status === 'error' && (
          <span class="sched-filter-hint err">
            Location error: {geo.message}
          </span>
        )}
      </div>
      <div class="schedule-notice">
        Tap <span class="schedule-notice-star">☆</span> next to any event
        to add it here &mdash; starring a camp doesn't add its events.
        Tap <span class="schedule-notice-icon"><EyeIcon slashed /></span>
        next to a recurring event to hide it from that day.
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
          {filtersOn
            ? 'No events match the active filters — clear them to see the full schedule.'
            : <>Star events to build your schedule — open a camp in <strong>Camps</strong>,
              expand its events, and tap the ☆. They’ll show up here grouped by day.</>}
        </div>
      ) : (
        <>
          {/* Desktop: a day-tab strip selects one day, shown below as a
              dense agenda. Mobile: stacked accordion in chronological order. */}
          <div class="schedule-week">
            <div
              ref={tablistRef}
              class="schedule-days" role="tablist" aria-label="Schedule days"
              onKeyDown={onTabsKeyDown}
            >
              {cells.map((c) => {
                const count = byCell.get(c.iso)?.length ?? 0;
                const isSel = c.iso === selectedIso;
                return (
                  <button
                    key={c.iso}
                    id={`sched-tab-${c.iso}`}
                    type="button"
                    role="tab"
                    aria-selected={isSel ? 'true' : 'false'}
                    aria-controls={SCHED_TABPANEL_ID}
                    // Roving tabindex: only the selected tab is in the Tab
                    // order; arrow keys move between the rest (see onTabsKeyDown).
                    tabIndex={isSel ? 0 : -1}
                    class={'sched-daytab' + (isSel ? ' selected' : '')}
                    onClick={() => setSelectedIsoRaw(c.iso)}
                  >
                    <span class="sched-day-label">{c.weekday} {c.dateLabel}</span>
                    <span class="sched-day-count">{count}</span>
                  </button>
                );
              })}
            </div>
            {selectedCell && (
              <DayAgenda
                key={selectedCell.iso} cell={selectedCell}
                entries={byCell.get(selectedCell.iso) ?? []}
                hiddenEntries={hiddenByCell.get(selectedCell.iso) ?? []}
                onGotoCamp={onGotoCamp} youLabel={youLabel}
                onToggleHide={onToggleDayHidden}
                panelId={SCHED_TABPANEL_ID}
                labelId={`sched-tab-${selectedCell.iso}`}
              />
            )}
          </div>
          <div class="schedule-accordion">
            {cells.map((c) => {
              const entries = byCell.get(c.iso) ?? [];
              const hidden = hiddenByCell.get(c.iso) ?? [];
              if (entries.length === 0 && hidden.length === 0) return null;
              return (
                <details
                  key={c.iso}
                  open={isDayOpen(c.iso)}
                  onToggle={(e) =>
                    setDayOpen(c.iso, (e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary>
                    <span class="sched-day-chevron" aria-hidden="true">›</span>
                    <span class="sched-day-label">{c.weekday} {c.dateLabel}</span>
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
              <h3 class="sched-section-head">
                Unscheduled
                <span class="sched-day-count">{unscheduled.length}</span>
              </h3>
              <p class="footnote">
                These events did not include a usable occurrence time in the
                snapshot, so they cannot be placed on the calendar.
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
