// Food availability from an event's parsed time vs. "now" (ADR docs/17 D4).
//
// Pure functions — no DOM, no state. "now" is supplied by the caller (which
// reads utils/clock so a simulated clock works). Availability is DATE-aware:
// an event only counts as "now"/"soon" when today is actually a day it occurs
// — inside the burn window, on a matching weekday, on/after its start date.
// Otherwise it's "later". This is why a "Daily 12–5pm (starts 8/31)" event is
// NOT "starting soon" on Aug 9.
import type { Event, ParsedTime } from '../types';
import { playaTimeParts } from './clock';

export type Availability = 'now' | 'soon' | 'later' | 'anytime';

/** Events starting within this many hours (and not yet started) are "soon". */
export const NOW_WINDOW_HOURS = 2;

export interface AvailabilityOpts {
  /** Burn window edges as 'YYYY-MM-DD' (from the bm-burn-start/end meta). */
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

/** 'M/D' → M*100+D for same-year ordering (burn stays within Aug–Sep). */
function mdNum(md: string | null | undefined): number | null {
  const m = md ? /^(\d{1,2})\/(\d{1,2})$/.exec(md) : null;
  return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : null;
}

/** 'YYYY-MM-DD' → M*100+D (year dropped to compare against M/D parses). */
function isoMdNum(iso: string | undefined): number | null {
  const m = iso ? /^\d{4}-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : null;
}

export interface NowContext {
  weekday: string;   // 'Mon' … matches parsed_time day abbreviations
  md: string;        // 'M/D' matches parsed_time.start_date
  mdNum: number;     // M*100+D
  minutes: number;   // minutes since midnight
}

export function nowContext(when: Date): NowContext {
  const parts = playaTimeParts(when);
  return {
    weekday: parts.weekday,
    md: `${parts.month}/${parts.day}`,
    mdNum: parts.month * 100 + parts.day,
    minutes: parts.hours * 60 + parts.minutes,
  };
}

/** True when today's date falls inside the burn window. When the window is
 *  unknown we don't gate (lenient fallback) — production always supplies it. */
function inBurnWindow(ctx: NowContext, opts?: AvailabilityOpts): boolean {
  const s = isoMdNum(opts?.burnStart);
  const e = isoMdNum(opts?.burnEnd);
  if (s === null || e === null) return true;
  return ctx.mdNum >= s && ctx.mdNum <= e;
}

/** Does this parsed time have an occurrence on `ctx`'s day?
 *  - single: its `start_date` (M/D) is today.
 *  - recurring: today is in the burn window, today's weekday is in `days`, and
 *    today is on/after the event's start date (recurring `start_date` is the
 *    earliest occurrence, stamped server-side; null when unknown). */
export function occursOn(p: ParsedTime, ctx: NowContext, opts?: AvailabilityOpts): boolean {
  if (p.kind === 'single') {
    if (p.start_date) return mdNum(p.start_date) === ctx.mdNum;
    return !!p.start_day && p.start_day === ctx.weekday && inBurnWindow(ctx, opts);
  }
  if (!inBurnWindow(ctx, opts)) return false;
  if (!(p.days ?? []).includes(ctx.weekday)) return false;
  const start = mdNum(p.start_date);
  if (start !== null && ctx.mdNum < start) return false; // hasn't started yet
  return true;
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
  const wrapsMidnight = end !== null && (
    (!!p.end_day && !!p.start_day && p.end_day !== p.start_day)
    || end < start
  );
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

/** True when the event still has a current/future occurrence — i.e. it's not
 *  a single-occurrence event whose date has already passed. Recurring events,
 *  undated events, and today/future singles all count as "yet to happen".
 *  Used by the Food tab's "Your picks · upcoming" summary. */
export function isUpcomingFood(
  ev: Event, when: Date, opts?: AvailabilityOpts,
): boolean {
  const p = ev.parsed_time;
  if (!p || p.kind !== 'single' || !p.start_date) return true;
  const availability = eventAvailability(ev, when, opts);
  if (availability === 'now' || availability === 'soon') return true;
  const sd = mdNum(p.start_date);
  if (sd === null) return true;
  const ctx = nowContext(when);
  if (sd !== ctx.mdNum) return sd > ctx.mdNum;
  const start = toMinutes(p.start_time);
  return start === null || ctx.minutes < start;
}
