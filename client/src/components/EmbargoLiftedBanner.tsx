// Burn-start nudge: shown once per device when the location embargo
// lifts WHILE the page is open (ADR D8). The user opened the tab
// before burn-start (so their camps were ingested with embargoed
// locations); now the cutoff has passed but the in-memory data is
// stale. We nudge them to refresh so the rebuilt camps show
// locations.
//
// Not shown if the page was loaded fresh on/after burn-start —
// in that case the embargo never applied to this session and a
// refresh wouldn't change anything. See App.tsx logic.
//
// Persistence: clicking either button writes an LS flag so the
// banner only ever appears once per burn year.

interface Props {
  onRefresh: () => void;
  onDismiss: () => void;
}

export function EmbargoLiftedBanner({ onRefresh, onDismiss }: Props) {
  return (
    <div class="import-banner" role="status">
      <div class="import-banner-body">
        <p>
          🔥 <strong>Burn week is here.</strong> Camp locations for the
          current-year API source are no longer hidden. Refresh to load
          the latest data.
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
