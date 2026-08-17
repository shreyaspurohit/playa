// Journal time helpers (ADR 20 D5/D6). `occurredAt` is a Black Rock City
// wall-clock string, minute resolution — never converted to/from UTC. The
// burn edition defaults from the builder-emitted map year, independent of the
// clock (D6).

import { now, playaTimeParts } from './clock';
import { yearForSource } from '../hooks/useSource';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function occurredAtFromParts(p: {
  year: number; month: number; day: number; hours: number; minutes: number;
}): string {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hours)}:${pad2(p.minutes)}`;
}

/** The current BRC wall time (honors the ?now= simulation via clock.now()). */
export function currentOccurredAt(): string {
  return occurredAtFromParts(playaTimeParts(now()));
}

/** Split/join for `<input type="date">` + `<input type="time">` binding. The
 *  strings are already Playa wall time, so no timezone math is involved. */
export function splitOccurredAt(value: string): { date: string; time: string } {
  const [date, time] = value.split('T');
  return { date, time: time ?? '00:00' };
}

export function joinOccurredAt(date: string, time: string): string {
  return `${date}T${time}`;
}

/** The default burn edition for a new entry — the builder-emitted map year. */
export function defaultBurnYear(): number {
  const source = document.querySelector('meta[name="bm-brc-map-year"]')
    ?.getAttribute('content');
  return yearForSource(source ? `api-${source}` : '');
}
