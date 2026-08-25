// Food availability from an event's parsed time vs. "now" (ADR docs/17 D4).
//
// Pure functions — no DOM, no state. "now" is supplied by the caller (which
// reads utils/clock so a simulated clock works). Availability is DATE-aware:
// an event only counts as "now"/"soon" when today's full ISO date is one of
// its exact occurrences. Otherwise it's "later". This is why a 12–5pm event is
// NOT "starting soon" on Aug 9.
import type { Event, ParsedTime } from '../types';
import { playaDateKey, playaTimeParts } from './clock';

export type Availability = 'now' | 'soon' | 'later' | 'anytime';

/** Events starting within this many hours (and not yet started) are "soon". */
export const NOW_WINDOW_HOURS = 2;

export interface AvailabilityOpts {
  /** Active source's explicit annual window edges as 'YYYY-MM-DD'. */
  burnStart?: string;
  burnEnd?: string;
  windowHrs?: number;
}

/** "HH:MM" (24h) → minutes since midnight; null if unparseable. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface NowContext {
  weekday: string;   // 'Mon' … matches parsed_time day abbreviations
  iso: string;       // YYYY-MM-DD in Playa local time
  minutes: number;   // minutes since midnight
}

export function nowContext(when: Date): NowContext {
  const parts = playaTimeParts(when);
  return {
    weekday: parts.weekday,
    iso: playaDateKey(when),
    minutes: parts.hours * 60 + parts.minutes,
  };
}

function inAnnualWindow(iso: string, opts?: AvailabilityOpts): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const first = opts?.burnStart;
  const last = opts?.burnEnd;
  if (!first || !last) return true;
  return first.slice(0, 4) === last.slice(0, 4)
    && iso.slice(0, 4) === first.slice(0, 4)
    && first <= iso && iso <= last;
}

/** Does this parsed time have an occurrence on `ctx`'s day? The builder stamps
 *  the exact in-window occurrence dates (ADR 11), so this is simple membership:
 *  today's full ISO date is one of them. No weekday inference or remapping. */
export function occursOn(p: ParsedTime, ctx: NowContext, opts?: AvailabilityOpts): boolean {
  return inAnnualWindow(ctx.iso, opts) && (p.dates ?? []).includes(ctx.iso);
}

/** Classify one event's availability against `when`.
 *  - no parsed time / no start time → 'anytime' (hours not listed)
 *  - occurs today + clock inside the window → 'now'
 *  - occurs today + starts within the soon-window → 'soon'
 *  - otherwise (future day / not-yet-started / earlier today) → 'later' */
export function eventAvailability(
  ev: Event, when: Date, opts?: AvailabilityOpts,
): Availability {
  const p = ev.parsed_time;
  if (!p) return 'anytime';
  const start = toMinutes(p.start_time);
  if (start === null) return 'anytime';

  const end = toMinutes(p.end_time);
  const wrapsMidnight = end !== null && (p.overnight || end < start);
  const windowMin = (opts?.windowHrs ?? NOW_WINDOW_HOURS) * 60;
  const ctx = nowContext(when);

  if (wrapsMidnight && end !== null) {
    // Before midnight, the occurrence starts today. After midnight, it
    // belongs to an occurrence that started yesterday, so check yesterday's
    // date/weekday rather than requiring today to match the start day.
    if (occursOn(p, ctx, opts) && ctx.minutes >= start) return 'now';
    if (ctx.minutes < end) {
      const previous = new Date(when);
      previous.setDate(previous.getDate() - 1);
      if (occursOn(p, nowContext(previous), opts)) return 'now';
    }
    if (
      occursOn(p, ctx, opts)
      && ctx.minutes < start
      && start <= ctx.minutes + windowMin
    ) return 'soon';
    return 'later';
  }

  if (!occursOn(p, ctx, opts)) return 'later';

  if (end !== null) {
    if (ctx.minutes >= start && ctx.minutes < end) return 'now';
  } else if (ctx.minutes >= start && ctx.minutes < start + windowMin) {
    return 'now';
  }

  if (ctx.minutes < start && start <= ctx.minutes + windowMin) return 'soon';

  return 'later';
}

/** True when the event carries at least one food-type classification. */
export function isFoodEvent(ev: Event): boolean {
  return !!ev.food_tags && ev.food_tags.length > 0;
}

/** True when the event still has a current/future occurrence in the active
 *  source window. An event without structured hours remains eligible for
 *  Hours not listed; a structured event with no in-window date does not.
 *  Used by the Food tab's "Your picks · upcoming" summary. */
export function isUpcomingFood(
  ev: Event, when: Date, opts?: AvailabilityOpts,
): boolean {
  const p = ev.parsed_time;
  if (!p) return true;   // no structured hours → keep in Hours not listed
  const dates = (p.dates ?? []).filter((iso) => inAnnualWindow(iso, opts));
  if (dates.length === 0) return false;
  const availability = eventAvailability(ev, when, opts);
  if (availability === 'now' || availability === 'soon') return true;
  const ctx = nowContext(when);
  // Any future occurrence date keeps it upcoming.
  if (dates.some((iso) => iso > ctx.iso)) return true;
  // A today occurrence that hasn't started yet is still upcoming.
  if (dates.includes(ctx.iso)) {
    const start = toMinutes(p.start_time);
    return start === null || ctx.minutes < start;
  }
  return false;   // every occurrence is in the past
}
