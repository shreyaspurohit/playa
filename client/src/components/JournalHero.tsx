// Compact decorative banner atop the Journal view whose sky follows the current
// Playa time (ADR 20 D18). All CSS/inline-SVG; honors the ?now= simulation via
// clock.now(). Sky gradient + a Black Rock City horizon silhouette + a sun/moon.
import { now, playaTimeParts } from '../utils/clock';
import { timeOfDayBucket } from '../utils/journalStore';

export function JournalHero() {
  const bucket = timeOfDayBucket(playaTimeParts(now()).hours);
  return (
    <div class={`journal-hero journal-sky-${bucket}`} aria-hidden="true">
      <div class="journal-hero-orb" />
      {bucket === 'night' && <div class="journal-hero-stars" />}
      <svg class="journal-hero-silhouette" viewBox="0 0 300 40" preserveAspectRatio="none">
        <path d="M0 40 L0 30 L38 26 L72 31 L108 20 L146 27 L146 9 L152 6 L158 9 L158 27 L200 22 L244 31 L300 25 L300 40 Z" />
      </svg>
    </div>
  );
}
