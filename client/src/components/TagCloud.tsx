// The chip cloud under the toolbar. Tags are sorted by frequency;
// clicking toggles the tag in the active filter set (AND semantics in
// matches()). The "Show all N tags" control flips expanded mode.

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
  const list = expanded ? sortedTags : sortedTags.slice(0, TOP_TAGS);
  return (
    <div class={'tagcloud' + (expanded ? ' expanded' : '')}>
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
      {sortedTags.length > TOP_TAGS && (
        <button type="button" class="tagcloud-toggle" onClick={onToggleExpanded}>
          {expanded ? 'Show fewer tags' : `Show all ${sortedTags.length} tags`}
        </button>
      )}
    </div>
  );
}
