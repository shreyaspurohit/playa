// Banner for JSON-snapshot imports. Mirrors ImportBanner's layout +
// styling so the file-import flow doesn't feel like a different app
// (used to use a `confirm()` dialog, which felt out of place).
//
// Three branches based on nickname comparison:
//   - own nickname matches → "Restore your snapshot"
//   - friend exists with that name → "Replace existing X with latest"
//   - new nickname → "Import as friend X"
import type { FriendFavs } from '../types';
import type { Snapshot } from '../utils/exportImport';

interface Props {
  snapshot: Snapshot;
  /** Current device's own nickname; when it equals snapshot.nickname,
   *  the self-restore action shows. */
  ownNickname?: string;
  /** Present when a friend already exists with snapshot.nickname.
   *  Drives the conflict copy + Replace-with-latest action. */
  existing?: FriendFavs;
  /** Restore the user's OWN state from this snapshot (overwrite all). */
  onApplySelf: () => void;
  /** Import the snapshot as a friend (new or replace). */
  onImportAsFriend: () => void;
  onDismiss: () => void;
}

export function SnapshotImportBanner({
  snapshot, ownNickname, existing,
  onApplySelf, onImportAsFriend, onDismiss,
}: Props) {
  const date = snapshot.exportedAt.slice(0, 10);
  const isSelf = !!ownNickname && !!snapshot.nickname
    && ownNickname.trim() === snapshot.nickname.trim();
  const senderLabel = snapshot.nickname || 'unknown';

  return (
    <div class="import-banner" role="status">
      <div class="import-banner-body">
        <p>
          <strong>{senderLabel}</strong>'s snapshot from{' '}
          <strong>{date}</strong>:{' '}
          <strong>{snapshot.campFavs.length}</strong> camp
          {snapshot.campFavs.length === 1 ? '' : 's'},{' '}
          <strong>{snapshot.eventFavs.length}</strong> event
          {snapshot.eventFavs.length === 1 ? '' : 's'}
          {(snapshot.artFavs?.length ?? 0) > 0 && (
            <>
              ,{' '}<strong>{snapshot.artFavs!.length}</strong> art
              {snapshot.artFavs!.length === 1 ? ' piece' : ' pieces'}
            </>
          )}
          {snapshot.myCampId && <>, plus <strong>their camp</strong></>}
          {snapshot.meetSpots.length > 0 && (
            <>
              {' '}and <strong>{snapshot.meetSpots.length}</strong> meet{' '}
              spot{snapshot.meetSpots.length === 1 ? '' : 's'}
            </>
          )}.
        </p>

        {isSelf && (
          <>
            <p class="import-conflict">
              The nickname matches yours &mdash; this looks like
              your own snapshot from another device. Restoring
              replaces every camp, event, meet spot, hidden day, and
              imported friend on this device.
            </p>
            <div class="import-banner-actions">
              <button
                type="button" class="primary-btn"
                onClick={onApplySelf}
              >
                Restore my snapshot
              </button>
              <button
                type="button" class="subtle-btn"
                onClick={onImportAsFriend}
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
              disabled={!snapshot.nickname}
              onClick={onImportAsFriend}
            >
              Import as "{senderLabel}"
            </button>
            <button type="button" class="subtle-btn" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        )}

        {!isSelf && existing && (
          <>
            <p class="import-conflict">
              You already have a friend called <strong>"{senderLabel}"</strong>{' '}
              ({existing.campIds.length} camp{existing.campIds.length === 1 ? '' : 's'} +{' '}
              {existing.eventIds.length} event{existing.eventIds.length === 1 ? '' : 's'}).
              The latest snapshot is treated as their current state.
            </p>
            <div class="import-banner-actions">
              <button
                type="button" class="primary-btn"
                onClick={onImportAsFriend}
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
