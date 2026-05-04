// Reusable checkbox-list section used by ShareModal + ExportModal to
// let the user pick exactly which starred items go into a share or
// snapshot. Default-selects everything (the common case is "share my
// whole list"); the user opts out per-item or per-category as needed.
import type { JSX } from 'preact';

export interface PickerItem {
  id: string;
  name: string;
  subtitle?: string;             // e.g., "by Jane Doe" or "at Camp X"
}

interface Props {
  title: string;                 // e.g., "Starred camps"
  items: PickerItem[];
  /** Selected ids — controlled by the parent. Empty set = nothing
   *  picked (don't include this category in the output). */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** When true, render the section open by default. Used for
   *  small lists (e.g., 1-2 items) where collapsing would just be
   *  noise. */
  initialOpen?: boolean;
}

export function IncludePicker({
  title, items, selected, onChange, initialOpen = false,
}: Props): JSX.Element | null {
  if (items.length === 0) return null;

  const allSelected = items.every((i) => selected.has(i.id));
  const noneSelected = items.every((i) => !selected.has(i.id));

  function toggleAll() {
    if (allSelected) onChange(new Set());
    else onChange(new Set(items.map((i) => i.id)));
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  }

  return (
    <details class="include-picker" open={initialOpen}>
      <summary>
        <strong>{title}</strong>
        <span class="include-count">
          {' '}({selected.size === items.length
            ? items.length
            : `${selected.size} of ${items.length}`})
        </span>
      </summary>
      <div class="include-picker-actions">
        <button
          type="button"
          class="include-link-btn"
          onClick={(e) => { e.preventDefault(); toggleAll(); }}
        >
          {allSelected ? 'Deselect all' : noneSelected ? 'Select all' : 'Select all'}
        </button>
      </div>
      <ul class="include-picker-list">
        {items.map((item) => (
          <li key={item.id}>
            <label class="include-row">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggleOne(item.id)}
              />
              <span class="include-row-body">
                <span class="include-row-name">{item.name}</span>
                {item.subtitle && (
                  <span class="include-row-subtitle">{item.subtitle}</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
