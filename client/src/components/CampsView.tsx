// The main grid: tag cloud on top, result cards below.
import type { Camp } from '../types';
import { CampCard } from './CampCard';
import { TagCloud } from './TagCloud';

const RESULT_CAP = 600;

interface Props {
  camps: Camp[];                  // already filtered
  total: number;                  // full dataset size (for info)
  query: string;
  queryLower: string;
  sortedTags: ReadonlyArray<readonly [name: string, count: number]>;
  activeTags: Set<string>;
  showAllTags: boolean;
  onToggleTag: (tag: string) => void;
  onToggleShowAllTags: () => void;
  isFav: (id: string) => boolean;
  isFavEvent: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  onToggleFavEvent: (id: string) => void;
}

export function CampsView({
  camps, query, queryLower, sortedTags, activeTags, showAllTags,
  onToggleTag, onToggleShowAllTags,
  isFav, isFavEvent, onToggleFav, onToggleFavEvent,
}: Props) {
  const toRender = camps.slice(0, RESULT_CAP);
  const overflow = camps.length > RESULT_CAP;

  return (
    <>
      <TagCloud
        sortedTags={sortedTags}
        activeTags={activeTags}
        expanded={showAllTags}
        onToggleTag={onToggleTag}
        onToggleExpanded={onToggleShowAllTags}
      />
      <main>
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
              onToggleFav={onToggleFav}
              onToggleFavEvent={onToggleFavEvent}
              onTagClick={onToggleTag}
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
