// Renders at the top of the page when the URL has `#share=…`. If the
// user doesn't already have a friend with the incoming nickname, it's
// a straight import. If there IS a collision, we treat the new share
// as the most-recent truth: prompt Replace-with-latest or Ignore. No
// merge — sharing semantics are "this is my current state right now",
// so a stale local copy shouldn't survive the new import.
//
// Source-mismatch path: when a share carries a `source` field that
// differs from the receiver's current source, the IDs inside don't
// match anything in the current view (different ID spaces — see
// docs/15-data-sources.md). We offer a "Switch source first" prompt
// before showing the regular import controls.
import type { SharePayload } from '../utils/share';
import type { FriendFavs, Source } from '../types';

interface Props {
  payload: SharePayload;
  existing?: FriendFavs;            // present iff a friend with this name exists
  /** The current device's own nickname. When it matches the incoming
   *  share's nickname, we offer a self-restore path instead of (or
   *  alongside) the friend-import path. */
  ownNickname?: string;
  /** Receiver's currently-active data source. */
  currentSource: Source;
  /** Sources embedded in this build — drives whether we can offer a
   *  one-click switch or just explain that the source isn't available. */
  availableSources: Source[];
  /** Switch the active source. The banner stays mounted afterward —
   *  re-renders against the new source so the regular import flow
   *  takes over. */
  onSwitchSource: (s: Source) => void;
  onImport: (opts: { targetName: string; mode: 'merge' | 'overwrite' }) => void;
  /** "This share is from me on another device" — overwrites the
   *  user's own favs + camp + meet spots with the share payload. */
  onImportAsSelf?: () => void;
  onDismiss: () => void;
}

function sourceLabel(s: Source): string {
  if (s === 'directory') return 'Directory';
  if (s.startsWith('api-')) return `API ${s.slice(4)}`;
  return s;
}

export function ImportBanner({
  payload, existing, ownNickname,
  currentSource, availableSources, onSwitchSource,
  onImport, onImportAsSelf, onDismiss,
}: Props) {
  const { name, campIds, eventIds, myCampId, meetSpots, source: shareSource } = payload;
  const total = campIds.length + eventIds.length;
  const isSelf =
    !!ownNickname && !!name && ownNickname.trim() === name.trim()
    && !!onImportAsSelf;
  // The rendezvous layer doesn't count toward `total` for the "nothing
  // to import" guard — a link that shares ONLY the sender's camp + a
  // couple meet spots is still worth importing, even with zero favs.
  const hasRendezvous = Boolean(myCampId) || (meetSpots?.length ?? 0) > 0;

  // Source mismatch — only triggers when the share explicitly tags
  // itself with a different source. Legacy shares (no `source` field)
  // are assumed to be `directory` and only mismatch if the receiver
  // is currently elsewhere.
  const effectiveShareSource: Source = shareSource ?? 'directory';
  const sourceMismatch = effectiveShareSource !== currentSource;
  const canSwitch = sourceMismatch && availableSources.includes(effectiveShareSource);

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

        {sourceMismatch && (
          <>
            <p class="import-conflict">
              This list is from <strong>{sourceLabel(effectiveShareSource)}</strong>,
              but you're currently viewing{' '}
              <strong>{sourceLabel(currentSource)}</strong>. Camp ids
              don't carry across sources, so the import won't line
              up with what you see here.
            </p>
            <div class="import-banner-actions">
              {canSwitch ? (
                <button
                  type="button" class="primary-btn"
                  onClick={() => onSwitchSource(effectiveShareSource)}
                >
                  Switch to {sourceLabel(effectiveShareSource)}
                </button>
              ) : (
                <span class="import-conflict-note">
                  This build doesn't include {sourceLabel(effectiveShareSource)}.
                </span>
              )}
              <button type="button" class="subtle-btn" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          </>
        )}

        {!sourceMismatch && isSelf && (
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

        {!sourceMismatch && !isSelf && !existing && (
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

        {!sourceMismatch && !isSelf && existing && (
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
