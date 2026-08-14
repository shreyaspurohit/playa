// Small inline-SVG glyph for an entry's time-of-day bucket (ADR 20 D18).
// currentColor so the per-bucket tint (set in CSS) colors it. Dawn/dusk share
// the sun-on-horizon shape; their tint (peach vs orange) tells them apart.
import type { TimeOfDay } from '../utils/journalStore';

export function TimeOfDayIcon({ bucket, size = 16 }: { bucket: TimeOfDay; size?: number }) {
  if (bucket === 'night') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 14.2A7.5 7.5 0 1 1 9.8 4a6 6 0 0 0 10.2 10.2Z" />
        <path d="M18 4.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3L16.2 6l1.3-.5Z" stroke-width="1.1" />
      </svg>
    );
  }
  const horizon = bucket === 'dawn' || bucket === 'dusk';
  const cy = horizon ? 13 : 12;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy={cy} r="3.6" />
      <g stroke-width="1.6">
        <path d="M12 3.2v1.8" />
        <path d="M4.8 6.2l1.3 1.3" />
        <path d="M17.9 6.2l-1.3 1.3" />
        <path d="M3.2 12h1.8" />
        <path d="M19 12h1.8" />
        {!horizon && <path d="M12 19v1.8" />}
        {!horizon && <path d="M4.8 17.8l1.3-1.3" />}
        {!horizon && <path d="M17.9 17.8l-1.3-1.3" />}
      </g>
      {horizon && <path d="M3.5 18h17" />}
    </svg>
  );
}
