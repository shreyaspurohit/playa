import type { View } from '../hooks/useHashRoute';

interface Props {
  view: View;
  onGoto: (v: View) => void;
}

const TABS: Array<[View, string, string]> = [
  ['camps',    '🏕',  'Camps'],
  ['schedule', '📅', 'Schedule'],
  ['food',     '🍽',  'Food'],
  ['art',      '🎨', 'Art'],
  ['map',      '🗺️', 'Map'],
];

export function TabBar({ view, onGoto }: Props) {
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
        </button>
      ))}
    </nav>
  );
}
