// One <article> in the results grid. Shows name, meta (location +
// website + canonical + navigate), description, tags, and a collapsible
// events list. When anyone (you or friends) has starred it, a "faved
// by" chip row appears below the meta.
import type { Camp } from '../types';
import { highlight } from '../utils/highlight';
import { friendChipStyle } from '../utils/friendColor';
import { EventItem } from './EventItem';
import { TentIcon } from './TentIcon';

interface Props {
  camp: Camp;
  query: string;
  queryLower: string;
  isFav: boolean;
  isFavEvent: (eventId: string) => boolean;
  friendsFavingCamp: string[];                      // names, not incl. "you"
  friendsFavingEvent: (eventId: string) => string[];
  onToggleFav: (id: string) => void;
  onToggleFavEvent: (id: string) => void;
  onTagClick: (tag: string) => void;
  onNavigate: (campId: string) => void;             // → map view, selected
  isMyCamp: boolean;                                // "this is your home camp"
  /** True when *some* camp is already set as my-camp. Used to hide the
   *  "set as my camp" button on every other card so there's only one
   *  control in play — the one on the chosen camp, which acts as unset. */
  myCampSet: boolean;
  onSetMyCamp: (campId: string) => void;            // toggles (sets; second click unsets)
}

export function CampCard({
  camp, query, queryLower,
  isFav, isFavEvent, friendsFavingCamp, friendsFavingEvent,
  onToggleFav, onToggleFavEvent, onTagClick, onNavigate,
  isMyCamp, myCampSet, onSetMyCamp,
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

  const owners: string[] = [];
  if (isFav) owners.push('you');
  owners.push(...friendsFavingCamp);

  return (
    <article class="camp" data-camp-id={camp.id}>
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
            <a href={camp.website} target="_blank" rel="noopener">website ↗</a>
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
            >on directory ↗</a>
          </>
        )}
        {camp.location && (
          <>
            {' · '}
            <button
              type="button"
              class="nav-link"
              title="Show on the BRC map"
              onClick={() => onNavigate(camp.id)}
            >navigate ↗</button>
          </>
        )}
        {(isMyCamp || !myCampSet) && (
          <>
            {' · '}
            <button
              type="button"
              class={'my-camp-btn' + (isMyCamp ? ' active' : '')}
              title={
                isMyCamp
                  ? 'This is your home camp. Tap to unset.'
                  : 'Set as your home camp so friends can find you'
              }
              aria-pressed={isMyCamp ? 'true' : 'false'}
              onClick={() => onSetMyCamp(camp.id)}
            >
              <TentIcon size={12} /> {isMyCamp ? 'my camp' : 'set as my camp'}
            </button>
          </>
        )}
      </div>
      {owners.length > 0 && (isFav || friendsFavingCamp.length > 0) && (
        // We always show the row when friends have starred it, even if
        // it's only one of them. When only "you" starred and no friends,
        // the star button already communicates that — skip the chips.
        friendsFavingCamp.length > 0 && (
          <div class="fav-by">
            faved by:{' '}
            {owners.map((o, i) => {
              const mine = o === 'you';
              return (
                <span key={o}>
                  {i > 0 && ', '}
                  <span
                    class={'fav-by-chip' + (mine ? ' mine' : '')}
                    style={mine ? undefined : friendChipStyle(o)}
                  >{o}</span>
                </span>
              );
            })}
          </div>
        )
      )}
      {camp.description ? (
        <p class="desc">{highlight(camp.description, query)}</p>
      ) : (
        <p class="desc empty">no description</p>
      )}
      <div class="tags">
        {camp.tags.map((t) => (
          <span key={t} class="tagbadge" onClick={() => onTagClick(t)}>{t}</span>
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
                friends={friendsFavingEvent(e.id)}
                onToggleFav={onToggleFavEvent}
              />
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
