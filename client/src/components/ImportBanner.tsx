// Renders at the top of the page when the URL has `#share=…`. If the
// user doesn't already have a friend with the incoming nickname, it's a
// straight import. If there IS a collision, we offer Merge / Overwrite
// / Rename / Cancel so the user doesn't accidentally clobber or blend
// two different friends whose share-link sender names happened to match.
import { useState } from 'preact/hooks';
import type { SharePayload } from '../utils/share';
import type { FriendFavs } from '../types';

interface Props {
  payload: SharePayload;
  existing?: FriendFavs;            // present iff a friend with this name exists
  onImport: (opts: { targetName: string; mode: 'merge' | 'overwrite' }) => void;
  onDismiss: () => void;
}

export function ImportBanner({ payload, existing, onImport, onDismiss }: Props) {
  const { name, campIds, eventIds, myCampId, meetSpots } = payload;
  const total = campIds.length + eventIds.length;
  // The rendezvous layer doesn't count toward `total` for the "nothing
  // to import" guard — a link that shares ONLY the sender's camp + a
  // couple meet spots is still worth importing, even with zero favs.
  const hasRendezvous = Boolean(myCampId) || (meetSpots?.length ?? 0) > 0;
  const [stage, setStage] = useState<'intro' | 'rename'>('intro');
  const [renameTo, setRenameTo] = useState('');

  function doImport(mode: 'merge' | 'overwrite', targetName = name) {
    onImport({ targetName, mode });
  }

  function startRename() {
    setRenameTo(name + ' (2)');      // seed a reasonable default
    setStage('rename');
  }

  function confirmRename() {
    const t = renameTo.trim();
    if (!t) return;
    // Rename is conceptually a fresh import under the new key.
    doImport('overwrite', t);
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

        {!existing && stage === 'intro' && (
          <div class="import-banner-actions">
            <button
              type="button" class="primary-btn"
              disabled={total === 0 && !hasRendezvous}
              onClick={() => doImport('merge')}
            >
              Import as "{name}"
            </button>
            <button type="button" class="subtle-btn" onClick={onDismiss}>Dismiss</button>
          </div>
        )}

        {existing && stage === 'intro' && (
          <>
            <p class="import-conflict">
              You already have a friend called <strong>"{name}"</strong> with{' '}
              <strong>{existing.campIds.length}</strong> camp{existing.campIds.length === 1 ? '' : 's'} +{' '}
              <strong>{existing.eventIds.length}</strong> event{existing.eventIds.length === 1 ? '' : 's'}.
              Pick how to handle this:
            </p>
            <div class="import-banner-actions">
              <button type="button" class="primary-btn" onClick={() => doImport('merge')}>
                Merge (add to existing)
              </button>
              <button type="button" class="subtle-btn" onClick={() => doImport('overwrite')}>
                Overwrite
              </button>
              <button type="button" class="subtle-btn" onClick={startRename}>
                Rename & import
              </button>
              <button type="button" class="subtle-btn" onClick={onDismiss}>
                Ignore
              </button>
            </div>
          </>
        )}

        {stage === 'rename' && (
          <div class="import-rename">
            <label for="rename-field">
              Save their list under a different name so it stays separate
              from your existing "{name}":
            </label>
            <input
              id="rename-field"
              type="text"
              class="share-input"
              autoFocus
              value={renameTo}
              onInput={(e) => setRenameTo((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); }}
              maxLength={32}
            />
            <div class="import-banner-actions">
              <button
                type="button" class="primary-btn"
                disabled={!renameTo.trim()}
                onClick={confirmRename}
              >
                Import as "{renameTo.trim() || '…'}"
              </button>
              <button type="button" class="subtle-btn" onClick={() => setStage('intro')}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
