// One <article> in the results grid. Shows name, meta (location +
// website + canonical), description, tags, and a collapsible events
// list. The events block auto-opens when a search hit is inside OR
// when any event is starred (so re-render after starring doesn't
// collapse the section the user is currently reading).
import type { Camp } from '../types';
import { highlight } from '../utils/highlight';
import { EventItem } from './EventItem';

interface Props {
  camp: Camp;
  query: string;
  queryLower: string;
  isFav: boolean;
  isFavEvent: (eventId: string) => boolean;
  onToggleFav: (id: string) => void;
  onToggleFavEvent: (id: string) => void;
  onTagClick: (tag: string) => void;
}

export function CampCard({
  camp,
  query,
  queryLower,
  isFav,
  isFavEvent,
  onToggleFav,
  onToggleFavEvent,
  onTagClick,
}: Props) {
  const hasFavEvent = (camp.events || []).some((e) => isFavEvent(e.id));
  const anyQueryHitInEvents =
    !!queryLower &&
    (camp.events || []).some(
      (e) =>
        (e.name && e.name.toLowerCase().includes(queryLower)) ||
        (e.description && e.description.toLowerCase().includes(queryLower)),
    );
  const shouldOpenEvents = anyQueryHitInEvents || hasFavEvent;

  return (
    <article class="camp">
      <div class="camp-head">
        <h3>{highlight(camp.name, query)}</h3>
        <button
          class={'fav-btn' + (isFav ? ' active' : '')}
          type="button"
          aria-pressed={isFav ? 'true' : 'false'}
          aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
          title={isFav ? 'Unfavorite' : 'Favorite'}
          onClick={() => onToggleFav(camp.id)}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
      <div class="meta">
        <span>{camp.location || '—'}</span>
        {camp.website && (
          <>
            {' · '}
            <a href={camp.website} target="_blank" rel="noopener">
              website ↗
            </a>
          </>
        )}
        {camp.url && (
          <>
            {' · '}
            <a
              class="canonical"
              href={camp.url}
              target="_blank"
              rel="noopener"
              title="Open on directory.burningman.org"
            >
              on directory ↗
            </a>
          </>
        )}
      </div>
      {camp.description ? (
        <p class="desc">{highlight(camp.description, query)}</p>
      ) : (
        <p class="desc empty">no description</p>
      )}
      <div class="tags">
        {camp.tags.map((t) => (
          <span key={t} class="tagbadge" onClick={() => onTagClick(t)}>
            {t}
          </span>
        ))}
      </div>
      {camp.events && camp.events.length > 0 && (
        <details class="events" open={shouldOpenEvents}>
          <summary>
            {camp.events.length} event{camp.events.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {camp.events.map((e) => (
              <EventItem
                key={e.id}
                event={e}
                query={query}
                isFav={isFavEvent(e.id)}
                onToggleFav={onToggleFavEvent}
              />
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
