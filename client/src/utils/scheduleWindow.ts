import type { Source } from '../types';

/** Explicit, build-supplied schedule bounds for one annual API source. */
export interface AnnualWindow {
  start: string;
  end: string;
}

export type ScheduleWindows = Record<Source, AnnualWindow>;

function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Parse the reviewed annual windows emitted by the builder. Invalid or
 * cross-year entries fail closed; the client never derives missing dates.
 */
export function parseScheduleWindows(raw: string): ScheduleWindows {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const windows: ScheduleWindows = {};
  for (const [source, candidate] of Object.entries(parsed)) {
    const match = /^api-(\d{4})$/.exec(source);
    if (!match || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const values = candidate as Record<string, unknown>;
    if (!validIsoDate(values.start) || !validIsoDate(values.end)) continue;
    const sourceYear = Number.parseInt(match[1], 10);
    if (
      Number.parseInt(values.start.slice(0, 4), 10) !== sourceYear
      || Number.parseInt(values.end.slice(0, 4), 10) !== sourceYear
      || values.start > values.end
    ) continue;
    windows[source] = { start: values.start, end: values.end };
  }
  return windows;
}
