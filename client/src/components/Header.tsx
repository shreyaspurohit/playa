// Top of page. Kept narrow so it works on mobile:
//   left:  title + version pill + stats line
//   right: nickname pill (always visible — it's the user's identity)
//          + a hamburger trigger that opens HeaderMenu (everything
//          else: source switcher, theme, about, report bug, install).
import type { Source } from '../types';
import type { View } from '../hooks/useHashRoute';
import type { SyncStatus } from '../hooks/useSync';
import { yearForSource } from '../hooks/useSource';
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
  onAskClick: () => void;
  onSyncNow: () => void;
  onSyncConnect: () => void;
  onSyncCancel: () => void;
  onSyncDisconnect: () => void;
  infoPulse: boolean;
  syncAvailable: boolean;
  syncConnected: boolean;
  syncStatus: SyncStatus;
  source: Source;
  availableSources: Source[];
  onSourceChange: (s: Source) => void;
}

export function Header({
  campTotal, campMatching, artTotal, artMatching,
  view, filterNote, fetchedDate, fetchedAt, version,
  currentTheme, onThemeChange, onInfoClick, onAskClick, onSyncNow,
  onSyncConnect, onSyncCancel, onSyncDisconnect, infoPulse,
  syncAvailable, syncConnected, syncStatus,
  source, availableSources, onSourceChange,
}: Props) {
  return (
    <header>
      <div class="topline">
        <div class="titleblock">
          <h1>
            Playa Camps
            <span class="header-year" title="Burn year you're viewing">{yearForSource(source)}</span>
          </h1>
          <span
            class="version"
            title={`Directory last fetched ${fetchedAt} UTC`}
          >
            Updated {fetchedDate} · {version}
          </span>
        </div>
        <div class="topline-right">
          <button
            type="button" class="ask-trigger" onClick={onAskClick}
            title="Ask a question about camps, events, food, and art"
          >✨ Ask</button>
          <NicknamePill />
          <HeaderMenu
            source={source}
            availableSources={availableSources}
            onSourceChange={onSourceChange}
            currentTheme={currentTheme}
            onThemeChange={onThemeChange}
            onInfoClick={onInfoClick}
            onSyncNow={onSyncNow}
            onSyncConnect={onSyncConnect}
            onSyncCancel={onSyncCancel}
            onSyncDisconnect={onSyncDisconnect}
            infoPulse={infoPulse}
            syncAvailable={syncAvailable}
            syncConnected={syncConnected}
            syncStatus={syncStatus}
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
