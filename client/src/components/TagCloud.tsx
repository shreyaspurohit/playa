// The chip cloud under the toolbar. Clicking toggles the tag in the active
// filter set (AND semantics in matches()). A small "Filter tags…" input lets
// you type to find a specific tag among the ~120 — substring match, showing
// every match regardless of the collapse cap.
//
// When the filter is empty: the collapsed top-50 is frequency-ranked so the
// most-used tags surface first (the useful default), and "Show all N tags"
// reveals the rest alphabetically — the order you want when scanning for one.

import { useState } from 'preact/hooks';

const TOP_TAGS = 50;

interface Props {
  sortedTags: ReadonlyArray<readonly [name: string, count: number]>;
  activeTags: Set<string>;
  expanded: boolean;
  onToggleTag: (tag: string) => void;
  onToggleExpanded: () => void;
}

export function TagCloud({
  sortedTags, activeTags, expanded, onToggleTag, onToggleExpanded,
}: Props) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const filtering = q.length > 0;

  // Filtering shows every match (rare tags included), still frequency-ranked
  // for relevance. Otherwise: expanded = full alphabetical, collapsed = top-50.
  const list = filtering
    ? sortedTags.filter(([name]) => name.toLowerCase().includes(q))
    : expanded
      ? [...sortedTags].sort((a, b) => a[0].localeCompare(b[0]))
      : sortedTags.slice(0, TOP_TAGS);

  return (
    <div class={'tagcloud' + (expanded && !filtering ? ' expanded' : '')}>
      {sortedTags.length > TOP_TAGS && (
        <input
          class="tagcloud-filter"
          type="search"
          value={filter}
          placeholder="Filter tags…"
          aria-label="Filter tags"
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
      )}
      {list.map(([name, n]) => (
        <button
          key={name}
          type="button"
          class={'tag' + (activeTags.has(name) ? ' active' : '')}
          onClick={() => onToggleTag(name)}
        >
          {name} <span class="n">{n}</span>
        </button>
      ))}
      {filtering && list.length === 0 && (
        <span class="tagcloud-empty">No tags match “{filter.trim()}”</span>
      )}
      {!filtering && sortedTags.length > TOP_TAGS && (
        <button type="button" class="tagcloud-toggle" onClick={onToggleExpanded}>
          {expanded ? 'Show fewer tags' : `Show all ${sortedTags.length} tags`}
        </button>
      )}
    </div>
  );
}
