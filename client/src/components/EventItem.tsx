// One <li> in a camp's events list. Links the event name to the
// directory.burningman.org canonical page and has its own fav star.
import type { Event } from '../types';
import { highlight } from '../utils/highlight';
import { friendChipStyle } from '../utils/friendColor';

interface Props {
  event: Event;
  query: string;
  isFav: boolean;
  friends: string[];          // friend nicknames who fav'd this event
  onToggleFav: (id: string) => void;
}

export function EventItem({ event, query, isFav, friends, onToggleFav }: Props) {
  const evUrl = `https://directory.burningman.org/events/${encodeURIComponent(event.id)}/`;
  const when = event.display_time || event.time || '';
  return (
    <li>
      <div class="ev-head">
        <a
          class="evname"
          href={evUrl}
          target="_blank"
          rel="noopener"
          title="Open on directory.burningman.org"
        >
          {highlight(event.name, query)}
          <span class="ev-ext">↗</span>
        </a>
        <button
          class={'ev-fav' + (isFav ? ' active' : '')}
          type="button"
          aria-pressed={isFav ? 'true' : 'false'}
          aria-label={isFav ? 'Remove event from favorites' : 'Add event to favorites'}
          title={isFav ? 'Unfavorite event' : 'Favorite event'}
          onClick={() => onToggleFav(event.id)}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
      {when && <span class="evtime">{when}</span>}
      {friends.length > 0 && (
        <div class="ev-friends">
          {friends.map((n) => (
            <span key={n} class="fav-by-chip" style={friendChipStyle(n)}>★ {n}</span>
          ))}
        </div>
      )}
      {event.description && (
        <p class="evdesc">{highlight(event.description, query)}</p>
      )}
    </li>
  );
}
