// Renders at the top of the page when the URL has `#share=…`. If the
// user doesn't already have a friend with the incoming nickname, it's
// a straight import. If there IS a collision, we treat the new share
// as the most-recent truth: prompt Replace-with-latest or Ignore. No
// merge — sharing semantics are "this is my current state right now",
// so a stale local copy shouldn't survive the new import.
import type { SharePayload } from '../utils/share';
import type { FriendFavs } from '../types';

interface Props {
  payload: SharePayload;
  existing?: FriendFavs;            // present iff a friend with this name exists
  /** The current device's own nickname. When it matches the incoming
   *  share's nickname, we offer a self-restore path instead of (or
   *  alongside) the friend-import path. */
  ownNickname?: string;
  onImport: (opts: { targetName: string; mode: 'merge' | 'overwrite' }) => void;
  /** "This share is from me on another device" — overwrites the
   *  user's own favs + camp + meet spots with the share payload. */
  onImportAsSelf?: () => void;
  onDismiss: () => void;
}

export function ImportBanner({
  payload, existing, ownNickname,
  onImport, onImportAsSelf, onDismiss,
}: Props) {
  const { name, campIds, eventIds, myCampId, meetSpots } = payload;
  const total = campIds.length + eventIds.length;
  const isSelf =
    !!ownNickname && !!name && ownNickname.trim() === name.trim()
    && !!onImportAsSelf;
  // The rendezvous layer doesn't count toward `total` for the "nothing
  // to import" guard — a link that shares ONLY the sender's camp + a
  // couple meet spots is still worth importing, even with zero favs.
  const hasRendezvous = Boolean(myCampId) || (meetSpots?.length ?? 0) > 0;

  function doImport(mode: 'merge' | 'overwrite') {
    onImport({ targetName: name, mode });
  }

  return (
    <div class="import-banner" role="status">
      <div class="import-banner-body">
        <p>
          <strong>{name}</strong> shared{' '}
          <strong>{campIds.length}</strong> camp{campIds.length === 1 ? '' : 's'} and{' '}
          <strong>{eventIds.length}</strong> event{eventIds.length === 1 ? '' : 's'}
          {myCampId && <>, plus <strong>their camp</strong></>}
          {meetSpots && meetSpots.length > 0 && (
            <>
              {' '}and <strong>{meetSpots.length}</strong> meet{' '}
              spot{meetSpots.length === 1 ? '' : 's'}
            </>
          )}.
        </p>

        {isSelf && (
          <>
            <p class="import-conflict">
              The nickname matches yours &mdash; this looks like
              your own share from another device.
            </p>
            <div class="import-banner-actions">
              <button
                type="button" class="primary-btn"
                onClick={onImportAsSelf}
              >
                Replace my state with this
              </button>
              <button
                type="button" class="subtle-btn"
                onClick={() => doImport('merge')}
              >
                Import as a friend instead
              </button>
              <button type="button" class="subtle-btn" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          </>
        )}

        {!isSelf && !existing && (
          <div class="import-banner-actions">
            <button
              type="button" class="primary-btn"
              disabled={total === 0 && !hasRendezvous}
              onClick={() => doImport('overwrite')}
            >
              Import as "{name}"
            </button>
            <button type="button" class="subtle-btn" onClick={onDismiss}>Dismiss</button>
          </div>
        )}

        {!isSelf && existing && (
          <>
            <p class="import-conflict">
              You already have a friend called <strong>"{name}"</strong>{' '}
              ({existing.campIds.length} camp{existing.campIds.length === 1 ? '' : 's'} +{' '}
              {existing.eventIds.length} event{existing.eventIds.length === 1 ? '' : 's'}).
              The latest share is treated as their current state.
            </p>
            <div class="import-banner-actions">
              <button
                type="button" class="primary-btn"
                onClick={() => doImport('overwrite')}
              >
                Replace with latest
              </button>
              <button type="button" class="subtle-btn" onClick={onDismiss}>
                Ignore
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
