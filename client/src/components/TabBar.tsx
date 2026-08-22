import type { View } from '../hooks/useHashRoute';

interface Props {
  view: View;
  onGoto: (v: View) => void;
  counts?: Partial<Record<View, number>>;
}

const TABS: Array<[View, string, string]> = [
  ['camps',    '🏕',  'Camps'],
  ['schedule', '📅', 'Schedule'],
  ['food',     '🍽',  'Food'],
  ['art',      '🎨', 'Art'],
  ['map',      '🗺️', 'Map'],
  ['journal',  '📓', 'Journal'],
];

export function TabBar({ view, onGoto, counts }: Props) {
  return (
    <nav class="tabs" role="tablist" aria-label="View">
      {TABS.map(([v, icon, label]) => {
        const n = counts?.[v] ?? 0;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v ? 'true' : 'false'}
            class={'tab' + (view === v ? ' active' : '')}
            aria-label={n > 0 ? `${label}, ${n} saved` : label}
            onClick={() => onGoto(v)}
          >
            <span class="tab-icon" aria-hidden="true">{icon}</span>
            <span class="tab-label">{label}</span>
            {n > 0 && (
              <span class="tab-count" aria-hidden="true">{n > 99 ? '99+' : n}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
