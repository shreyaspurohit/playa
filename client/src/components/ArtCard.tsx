// One <article> in the art results grid. Mirrors CampCard but for art:
// shows name, artist, meta (location + canonical + navigate), image
// thumbnail, description, tags. Star toggle, friend faving chip row,
// and a navigate→map link when the address resolves. No events.
import { useState } from 'preact/hooks';
import type { Art } from '../types';
import { highlight } from '../utils/highlight';
import { FriendChip } from './FriendChip';

interface Props {
  art: Art;
  query: string;
  isFav: boolean;
  friendsFavingArt: string[];                       // names, not incl. "you"
  onToggleFav: (id: string) => void;
  onTagClick: (tag: string) => void;
  onNavigate: (artId: string) => void;              // → map view, selected
  /** Remove a specific friend's star on this art piece. Click on the
   *  × inside the friend's chip dispatches this. */
  onRemoveFriendStar: (friendName: string) => void;
}

export function ArtCard({
  art, query,
  isFav, friendsFavingArt,
  onToggleFav, onTagClick, onNavigate, onRemoveFriendStar,
}: Props) {
  const owners: string[] = [];
  if (isFav) owners.push('you');
  owners.push(...friendsFavingArt);

  // Image-load failures (offline, 404, BM CDN blip, etc.) flip this
  // off and the figure disappears entirely instead of showing the
  // browser's broken-image placeholder. The card still reads cleanly
  // — name + artist + description carry the piece on their own.
  const [imageOk, setImageOk] = useState(true);

  return (
    <article class="camp art" data-art-id={art.id}>
      <div class="camp-head">
        <h3>{highlight(art.name, query)}</h3>
        <button
          class={'fav-btn' + (isFav ? ' active' : '')}
          type="button"
          aria-pressed={isFav ? 'true' : 'false'}
          aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
          title={isFav ? 'Unfavorite' : 'Favorite'}
          onClick={() => onToggleFav(art.id)}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
      {art.artist && (
        <div class="art-byline">by {highlight(art.artist, query)}{art.hometown && ` · ${art.hometown}`}</div>
      )}
      <div class="meta">
        <span>{art.location || '—'}</span>
        {art.url && (
          <>
            {' · '}
            <a
              class="canonical"
              href={art.url}
              target="_blank"
              rel="noopener"
              title="Open on directory.burningman.org"
            >on directory ↗</a>
          </>
        )}
        {art.location && (
          <>
            {' · '}
            <button
              type="button"
              class="nav-link"
              title="Show on the BRC map"
              onClick={() => onNavigate(art.id)}
            >navigate ↗</button>
          </>
        )}
        {(art.category || art.program) && (
          <>
            {' · '}
            <span class="art-meta-chip">
              {[art.category, art.program].filter(Boolean).join(' · ')}
            </span>
          </>
        )}
      </div>
      {owners.length > 0 && (
        // Unlike CampCard (which suppresses the row when only "you"
        // starred and lets the star button alone signal that), art
        // ALWAYS shows the row. Imported friend's art is the
        // primary use case — the user wants to see "Alice" attached
        // to the piece, plus their own "you" tag if they also starred
        // it. Suppressing "you-only" rows would also drop attribution
        // for imported art the user doesn't yet self-star.
        <div class="fav-by">
          faved by:{' '}
          {owners.map((o, i) => {
            const mine = o === 'you';
            return (
              <span key={o}>
                {i > 0 && ', '}
                <FriendChip
                  name={o}
                  onRemove={mine ? undefined : () => onRemoveFriendStar(o)}
                />
              </span>
            );
          })}
        </div>
      )}
      {art.image_url && imageOk && (
        <div class="art-image">
          <img
            src={art.image_url}
            alt={`${art.name} thumbnail`}
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            onError={() => setImageOk(false)}
          />
        </div>
      )}
      {art.description ? (
        <p class="desc">{highlight(art.description, query)}</p>
      ) : (
        <p class="desc empty">no description</p>
      )}
      {art.tags.length > 0 && (
        <div class="tags">
          {art.tags.map((t) => (
            <span key={t} class="tagbadge" onClick={() => onTagClick(t)}>{t}</span>
          ))}
        </div>
      )}
    </article>
  );
}
