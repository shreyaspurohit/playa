// The main grid: tag cloud on top, result cards below.
import { useEffect, useRef } from 'preact/hooks';
import type { Camp } from '../types';
import { CampCard } from './CampCard';
import { TagCloud } from './TagCloud';

const RESULT_CAP = 600;

interface Props {
  camps: Camp[];
  total: number;
  query: string;
  queryLower: string;
  sortedTags: ReadonlyArray<readonly [name: string, count: number]>;
  activeTags: Set<string>;
  showAllTags: boolean;
  onToggleTag: (tag: string) => void;
  onToggleShowAllTags: () => void;
  isFav: (id: string) => boolean;
  isFavEvent: (id: string) => boolean;
  friendsFavingCamp: (id: string) => string[];
  friendsFavingEvent: (id: string) => string[];
  onToggleFav: (id: string) => void;
  onToggleFavEvent: (id: string) => void;
  onNavigate: (campId: string) => void;
  /** The user's own home camp id ('' when unset). Highlighted
   *  differently on the card and exposed in the share-link payload. */
  myCampId: string;
  onSetMyCamp: (campId: string) => void;
  /** When non-null, scroll that card into view + briefly flash it.
   * Changes each time — re-triggering even on the same id. */
  scrollToCampId: string | null;
  scrollToCampTick: number;
}

export function CampsView({
  camps, query, queryLower, sortedTags, activeTags, showAllTags,
  onToggleTag, onToggleShowAllTags,
  isFav, isFavEvent, friendsFavingCamp, friendsFavingEvent,
  onToggleFav, onToggleFavEvent, onNavigate,
  myCampId, onSetMyCamp,
  scrollToCampId, scrollToCampTick,
}: Props) {
  const toRender = camps.slice(0, RESULT_CAP);
  const overflow = camps.length > RESULT_CAP;
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!scrollToCampId) return;
    // Let the DOM paint first.
    const id = window.setTimeout(() => {
      const el = mainRef.current?.querySelector(
        `[data-camp-id="${CSS.escape(scrollToCampId)}"]`,
      ) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('camp-flash');
      window.setTimeout(() => el.classList.remove('camp-flash'), 1800);
    }, 50);
    return () => window.clearTimeout(id);
  }, [scrollToCampId, scrollToCampTick]);

  return (
    <>
      <TagCloud
        sortedTags={sortedTags}
        activeTags={activeTags}
        expanded={showAllTags}
        onToggleTag={onToggleTag}
        onToggleExpanded={onToggleShowAllTags}
      />
      <main ref={mainRef}>
        {camps.length === 0 ? (
          <div class="empty-state">No camps match. Try clearing filters.</div>
        ) : (
          toRender.map((c) => (
            <CampCard
              key={c.id}
              camp={c}
              query={query}
              queryLower={queryLower}
              isFav={isFav(c.id)}
              isFavEvent={isFavEvent}
              friendsFavingCamp={friendsFavingCamp(c.id)}
              friendsFavingEvent={friendsFavingEvent}
              onToggleFav={onToggleFav}
              onToggleFavEvent={onToggleFavEvent}
              onTagClick={onToggleTag}
              onNavigate={onNavigate}
              isMyCamp={myCampId === c.id}
              myCampSet={myCampId !== ''}
              onSetMyCamp={onSetMyCamp}
            />
          ))
        )}
        {overflow && (
          <div class="more">
            Showing first {RESULT_CAP} of {camps.length}. Narrow your search
            to see more.
          </div>
        )}
      </main>
    </>
  );
}
