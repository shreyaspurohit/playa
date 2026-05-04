// Search + two-pane row (filters left, actions right).
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onClear: () => void;
  favOnly: boolean;
  favCount: number;          // number of camps that would match fav filter
  favCampN: number;
  favEventN: number;
  onToggleFavFilter: () => void;
  webOnly: boolean;
  webCount: number;          // number of camps with a website
  onToggleWebFilter: () => void;
  onUnfavoriteAll: () => void;
  focusKey: number;          // increment to force-focus the search box
}

export function Toolbar({
  query, onQueryChange, onClear,
  favOnly, favCount, favCampN, favEventN, onToggleFavFilter,
  webOnly, webCount, onToggleWebFilter,
  onUnfavoriteAll, focusKey,
}: Props) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const favFilterRef = useRef<HTMLButtonElement | null>(null);
  // Focus the search box on mount and whenever focusKey bumps (after a
  // Clear press, so the user can immediately start typing again).
  useEffect(() => { searchRef.current?.focus(); }, [focusKey]);

  const favFilterLabel = favOnly ? '★' : '☆';
  const favFilterTitle =
    `${favCampN} starred camp${favCampN === 1 ? '' : 's'}, ` +
    `${favEventN} starred event${favEventN === 1 ? '' : 's'}`;

  const showUnfav = favOnly && (favCampN + favEventN) > 0;

  function handleFilterClick() {
    if (!favOnly && favCampN === 0 && favEventN === 0) {
      // No favorites to show — nudge instead of silently engaging empty filter.
      favFilterRef.current?.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(4px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 220 },
      );
      return;
    }
    onToggleFavFilter();
  }

  return (
    <>
      <div class="controls">
        <input
          ref={searchRef}
          type="search"
          placeholder="Search name, description, events, location, or tags…"
          value={query}
          onInput={(e) => onQueryChange((e.target as HTMLInputElement).value)}
          autocomplete="off"
        />
      </div>
      <div class="controls toolbar-row">
        <div class="filters">
          <button
            ref={favFilterRef}
            id="fav-filter"
            class={'fav-filter' + (favOnly ? ' active' : '')}
            type="button"
            aria-pressed={favOnly ? 'true' : 'false'}
            title={favFilterTitle}
            onClick={handleFilterClick}
          >
            {favFilterLabel} Favorites <span class="count">({favCount})</span>
          </button>
          <button
            class={'fav-filter' + (webOnly ? ' active' : '')}
            type="button"
            aria-pressed={webOnly ? 'true' : 'false'}
            title={`${webCount} camps published a website on the directory`}
            onClick={onToggleWebFilter}
          >
            With website ↗ <span class="count">({webCount})</span>
          </button>
        </div>
        <div class="actions">
          <button
            class={'fav-clear' + (showUnfav ? '' : ' hidden')}
            type="button"
            onClick={onUnfavoriteAll}
          >
            Unfavorite all
          </button>
          <button type="button" onClick={onClear}>Clear</button>
        </div>
      </div>
    </>
  );
}
