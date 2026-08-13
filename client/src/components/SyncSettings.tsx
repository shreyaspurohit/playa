import type { SyncController } from '../hooks/useSync';

export function SyncSettings({
  sync,
  showHeading = true,
}: {
  sync: SyncController;
  showHeading?: boolean;
}) {
  if (!sync.available) return null;
  const checking = sync.status === 'checking';
  const busy = checking || sync.status === 'syncing';
  const connected = sync.connected && sync.status !== 'expired';
  const time = sync.lastSyncedAt === null ? '' : new Date(sync.lastSyncedAt).toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit',
  });
  return (
    <section
      class="sync-settings"
      aria-labelledby={showHeading ? 'sync-settings-title' : undefined}
      aria-label={showHeading ? undefined : 'Dropbox backup and restore'}
    >
      {showHeading && (
        <h3
          id="sync-settings-title"
          class="modal-section"
        >Dropbox backup &amp; restore</h3>
      )}
      <p>
        Keep favorites, plans, friends, and preferences aligned across your
        devices, browsers, and tabs using your private Playa Camps app folder
        in Dropbox. Connecting immediately merges and restores your latest
        backup; changes continue syncing while this app is open.
      </p>
      <p class="guide-subtle">
        Dropbox access is limited to this app’s private folder:{' '}
        <strong>Apps → Playa Camps Sync</strong>. It cannot access your other
        Dropbox files.
      </p>
      <p class="guide-subtle">
        The backup contains plan IDs, preferences, and your nickname as readable
        JSON. Playa Camps cannot access the rest of your Dropbox. This device
        stays connected until you disconnect it or revoke access in Dropbox.
      </p>
      <div class="sync-actions">
        {!connected ? (
          <button
            class="action-btn"
            type="button"
            disabled={busy}
            onClick={() => sync.status === 'connecting'
              ? sync.cancelConnect()
              : void sync.connect()}
          >
            <span class="action-label">
              {checking
                ? 'Checking Dropbox connection…'
                : sync.status === 'connecting'
                  ? 'Cancel Dropbox sign-in'
                  : sync.status === 'expired'
                    ? 'Reconnect Dropbox'
                    : 'Connect Dropbox'}
            </span>
            <span class="action-desc">
              {sync.status === 'connecting'
                ? 'Close the sign-in window, then try again whenever you’re ready.'
                : 'Back up this device or restore an existing cloud copy.'}
            </span>
          </button>
        ) : (
          <>
            <button class="action-btn" type="button" disabled={busy} onClick={() => void sync.syncNow()}>
              <span class="action-label">{sync.status === 'syncing' ? 'Syncing…' : 'Sync now'}</span>
              <span class="action-desc">Pull, merge, and save changes from every connected device.</span>
            </button>
            <button class="action-btn" type="button" disabled={busy} onClick={() => void sync.disconnect()}>
              <span class="action-label">Disconnect Dropbox</span>
              <span class="action-desc">Keeps both your local plans and Dropbox backup.</span>
            </button>
          </>
        )}
      </div>
      {(sync.message || time) && (
        <p class={`sync-status sync-${sync.status}`} role="status">
          {sync.message}{time && sync.status === 'synced' ? ` Last synced at ${time}.` : ''}
        </p>
      )}
    </section>
  );
}
