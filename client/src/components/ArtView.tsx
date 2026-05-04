// Art grid: tag cloud on top, art cards below. Mirrors CampsView in
// shape but operates on `Art[]` and a separate fav set. No event-fav
// hooks since art doesn't carry events.
import { useEffect, useRef } from 'preact/hooks';
import type { Art } from '../types';
import { ArtCard } from './ArtCard';
import { TagCloud } from './TagCloud';

const RESULT_CAP = 600;

interface Props {
  art: Art[];
  query: string;
  sortedTags: ReadonlyArray<readonly [name: string, count: number]>;
  activeTags: Set<string>;
  showAllTags: boolean;
  onToggleTag: (tag: string) => void;
  onToggleShowAllTags: () => void;
  isFav: (id: string) => boolean;
  friendsFavingArt: (id: string) => string[];
  onToggleFav: (id: string) => void;
  onNavigate: (artId: string) => void;
  /** Per-card removal of a friend's star (× on chip). */
  onRemoveFriendStar: (friendName: string, artId: string) => void;
  scrollToArtId: string | null;
  scrollToArtTick: number;
}

export function ArtView({
  art, query, sortedTags, activeTags, showAllTags,
  onToggleTag, onToggleShowAllTags,
  isFav, friendsFavingArt,
  onToggleFav, onNavigate, onRemoveFriendStar,
  scrollToArtId, scrollToArtTick,
}: Props) {
  const toRender = art.slice(0, RESULT_CAP);
  const overflow = art.length > RESULT_CAP;
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!scrollToArtId) return;
    const id = window.setTimeout(() => {
      const el = mainRef.current?.querySelector(
        `[data-art-id="${CSS.escape(scrollToArtId)}"]`,
      ) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('camp-flash');
      window.setTimeout(() => el.classList.remove('camp-flash'), 1800);
    }, 50);
    return () => window.clearTimeout(id);
  }, [scrollToArtId, scrollToArtTick]);

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
        {art.length === 0 ? (
          <div class="empty-state">
            No art matches. Try clearing filters, or check the source —
            some sources don't carry art at all.
          </div>
        ) : (
          toRender.map((a) => (
            <ArtCard
              key={a.id}
              art={a}
              query={query}
              isFav={isFav(a.id)}
              friendsFavingArt={friendsFavingArt(a.id)}
              onToggleFav={onToggleFav}
              onTagClick={onToggleTag}
              onNavigate={onNavigate}
              onRemoveFriendStar={(name) => onRemoveFriendStar(name, a.id)}
            />
          ))
        )}
        {overflow && (
          <div class="more">
            Showing first {RESULT_CAP} of {art.length}. Narrow your search
            to see more.
          </div>
        )}
      </main>
    </>
  );
}
