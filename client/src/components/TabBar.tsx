import type { View } from '../hooks/useHashRoute';

interface Props {
  view: View;
  onGoto: (v: View) => void;
  scheduleBadge?: number;   // count of favorited events
  artBadge?: number;        // count of favorited art
}

const TABS: Array<[View, string, string]> = [
  ['camps',    '🏕',  'Camps'],
  ['schedule', '📅', 'Schedule'],
  ['art',      '🎨', 'Art'],
  ['map',      '🗺️', 'Map'],
];

export function TabBar({ view, onGoto, scheduleBadge, artBadge }: Props) {
  return (
    <nav class="tabs" role="tablist" aria-label="View">
      {TABS.map(([v, icon, label]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v ? 'true' : 'false'}
          class={'tab' + (view === v ? ' active' : '')}
          onClick={() => onGoto(v)}
        >
          <span class="tab-icon" aria-hidden="true">{icon}</span>
          <span class="tab-label">{label}</span>
          {v === 'schedule' && scheduleBadge !== undefined && scheduleBadge > 0 && (
            <span class="tab-badge">{scheduleBadge}</span>
          )}
          {v === 'art' && artBadge !== undefined && artBadge > 0 && (
            <span class="tab-badge">{artBadge}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
