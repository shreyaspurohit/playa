// Top of page. Kept narrow so it works on mobile:
//   left:  title + version pill + stats line
//   right: nickname pill (always visible — it's the user's identity)
//          + a hamburger trigger that opens HeaderMenu (everything
//          else: source switcher, theme, about, report bug, install).
import type { Source } from '../types';
import type { View } from '../hooks/useHashRoute';
import { HeaderMenu } from './HeaderMenu';
import { NicknamePill } from './NicknamePill';

interface Props {
  campTotal: number;
  campMatching: number;
  artTotal: number;
  artMatching: number;
  /** Active tab — drives which "matching" count is shown (camps' or
   *  art's) and which filter-note tag, when present, is appended. */
  view: View;
  filterNote: string;
  fetchedDate: string;
  fetchedAt: string;
  version: string;
  currentTheme: string;
  onThemeChange: (name: string) => void;
  onInfoClick: () => void;
  infoPulse: boolean;
  source: Source;
  availableSources: Source[];
  onSourceChange: (s: Source) => void;
}

export function Header({
  campTotal, campMatching, artTotal, artMatching,
  view, filterNote, fetchedDate, fetchedAt, version,
  currentTheme, onThemeChange, onInfoClick, infoPulse,
  source, availableSources, onSourceChange,
}: Props) {
  return (
    <header>
      <div class="topline">
        <div class="titleblock">
          <h1>Playa Camps</h1>
          <span
            class="version"
            title={`Directory last fetched ${fetchedAt} UTC`}
          >
            Updated {fetchedDate} · {version}
          </span>
        </div>
        <div class="topline-right">
          <NicknamePill />
          <HeaderMenu
            source={source}
            availableSources={availableSources}
            onSourceChange={onSourceChange}
            currentTheme={currentTheme}
            onThemeChange={onThemeChange}
            onInfoClick={onInfoClick}
            infoPulse={infoPulse}
          />
        </div>
      </div>
      <div class="stats">
        {/* Totals always visible. The "matching" suffix only renders
            when filtering applies to the current view (camps or art).
            Schedule + Map tabs don't filter, so they just show totals. */}
        <span>{campTotal.toLocaleString()}</span> camps ·{' '}
        <span>{artTotal.toLocaleString()}</span> art
        {view === 'camps' && (
          <>
            {' · '}
            <span>{campMatching.toLocaleString()}</span> matching
          </>
        )}
        {view === 'art' && (
          <>
            {' · '}
            <span>{artMatching.toLocaleString()}</span> matching
          </>
        )}
        {filterNote && <span>{filterNote}</span>}
      </div>
    </header>
  );
}
