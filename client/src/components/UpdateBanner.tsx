// "A new version of the site is live — refresh to get it" banner.
// Uses forceRefresh() (not plain location.reload) so the SW shell
// cache gets repopulated from origin before the reload — same
// non-destructive path the About modal's Force-refresh button takes.
import { useState } from 'preact/hooks';
import { forceRefresh } from '../utils/refresh';

interface Props {
  /** Version string from the server (just for showing in the title
   *  attribute — the user mostly just cares that something newer exists). */
  latest: string;
}

export function UpdateBanner({ latest }: Props) {
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  async function onRefresh() {
    setBusy(true);
    const outcome = await forceRefresh();
    if (outcome === 'offline') {
      // Network just dropped — keep the banner up so they can try
      // again when connectivity returns.
      setBusy(false);
    }
    // 'refreshed' triggers location.reload() inside forceRefresh, so
    // there's nothing else to do here.
  }

  return (
    <div class="update-banner" role="status" aria-live="polite">
      <span class="update-banner-msg">
        A newer version of Playa Camps is available.
      </span>
      <div class="update-banner-actions">
        <button
          type="button"
          class="primary-btn"
          onClick={onRefresh}
          disabled={busy}
          title={`Reload to ${latest}`}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          class="subtle-btn"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          Later
        </button>
      </div>
    </div>
  );
}
