import type { View } from '../hooks/useHashRoute';

interface Props {
  view: View;
  onGoto: (v: View) => void;
  scheduleBadge?: number;   // count of favorited events
}

const TABS: Array<[View, string, string]> = [
  ['camps',    '🏕',  'Camps'],
  ['schedule', '📅', 'Schedule'],
  ['map',      '🗺️', 'Map'],
];

export function TabBar({ view, onGoto, scheduleBadge }: Props) {
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
        </button>
      ))}
    </nav>
  );
}
