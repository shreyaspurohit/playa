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
  onUnfavoriteAll: () => void;
  onShare: () => void;
  focusKey: number;          // increment to force-focus the search box
}

export function Toolbar({
  query, onQueryChange, onClear,
  favOnly, favCount, favCampN, favEventN,
  onToggleFavFilter, onUnfavoriteAll, onShare, focusKey,
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
  const hasAnything = (favCampN + favEventN) > 0;

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
        </div>
        <div class="actions">
          {hasAnything && (
            <button
              class="share-btn"
              type="button"
              title="Copy a share link"
              onClick={onShare}
            >
              <svg
                class="share-icon" viewBox="0 0 24 24"
                width="14" height="14" fill="none"
                stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true"
              >
                {/* Open-top box + up arrow — the iOS-style "share out"
                    glyph. Adapts to theme via currentColor. */}
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <path d="M12 3v13" />
                <path d="M7 8l5-5 5 5" />
              </svg>
              {' '}Share
            </button>
          )}
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
