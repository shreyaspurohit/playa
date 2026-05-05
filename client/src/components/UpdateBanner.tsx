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
  const [staleHint, setStaleHint] = useState(false);

  if (dismissed) return null;

  async function onRefresh() {
    setBusy(true);
    setStaleHint(false);
    const outcome = await forceRefresh();
    if (outcome === 'offline') {
      // Network just dropped — keep the banner up so they can try
      // again when connectivity returns.
      setBusy(false);
    } else if (outcome === 'stale') {
      // CDN edge hasn't propagated the new build yet — version.txt is
      // ahead of index.html. Reloading is a no-op; tell the user to
      // wait a bit and keep the banner up.
      setBusy(false);
      setStaleHint(true);
    }
    // 'refreshed' triggers location.reload() inside forceRefresh, so
    // there's nothing else to do here.
  }

  return (
    <div class="update-banner" role="status" aria-live="polite">
      <span class="update-banner-msg">
        {staleHint
          ? 'New version detected, but the server is still propagating it. Try again in a minute.'
          : 'A newer version of Playa Camps is available.'}
      </span>
      <div class="update-banner-actions">
        <button
          type="button"
          class="primary-btn"
          onClick={onRefresh}
          disabled={busy}
          title={`Reload to ${latest}`}
        >
          {busy ? 'Refreshing…' : staleHint ? 'Try again' : 'Refresh'}
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
