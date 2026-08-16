// Kind-specific nudge shown when a camp or art location release time
// passes while the page remains open (ADR D8). In-memory records were
// masked at ingest, so a refresh is needed to restore that field.
//
// Not shown if the page was loaded fresh on/after burn-start —
// in that case the embargo never applied to this session and a
// refresh wouldn't change anything. See App.tsx logic.
//
// Persistence: clicking either button writes an LS flag so the
// banner only ever appears once per burn year.

interface Props {
  kind: 'camp' | 'art';
  onRefresh: () => void;
  onDismiss: () => void;
}

export function EmbargoLiftedBanner({ kind, onRefresh, onDismiss }: Props) {
  const label = kind === 'camp' ? 'Camp' : 'Art';
  return (
    <div class="import-banner" role="status">
      <div class="import-banner-body">
        <p>
          🔥 <strong>{label} locations are now available.</strong>{' '}
          Refresh to load the latest data.
        </p>
        <div class="import-banner-actions">
          <button type="button" class="primary-btn" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" class="subtle-btn" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
