// Three pieces of header UI in one component:
//   * "Install app" button (Chrome-like) → triggers native prompt
//   * "Install app" button (iOS) → opens a manual-steps modal,
//     because Apple doesn't expose an install API to web pages
//   * Small status pill: "Installed" when running standalone,
//     "Offline-ready" when the SW is controlling the page.
//
// Hidden when there's nothing useful to show (desktop Firefox, etc.).

import { useState } from 'preact/hooks';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { forceRefresh } from '../utils/refresh';

export function InstallPrompt() {
  const { canAutoPrompt, isIos, isStandalone, offlineReady, promptInstall } =
    useInstallPrompt();
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [refreshState, setRefreshState] = useState<'idle' | 'checking' | 'offline'>('idle');

  async function handleRefresh() {
    setRefreshState('checking');
    const outcome = await forceRefresh();
    // 'refreshed' → page is reloading right now, this component unmounts.
    // 'offline' → we kept the cache; tell the user and reset after a bit.
    if (outcome === 'offline') {
      setRefreshState('offline');
      window.setTimeout(() => setRefreshState('idle'), 3000);
    }
  }

  const refreshTitle =
    refreshState === 'checking' ? 'Checking for updates…'
    : refreshState === 'offline' ? 'Offline — kept your cached copy'
    : 'Check for a newer version';

  // Already an installed app — no need to push install, and the
  // "offline-ready" pill would be redundant. Just confirm the state.
  if (isStandalone) {
    return (
      <span
        class="install-pill installed"
        title="Running as an installed app"
      >
        ✓ Installed
      </span>
    );
  }

  const showInstallButton = canAutoPrompt || isIos;

  return (
    <>
      {showInstallButton && (
        <button
          class="install-btn"
          type="button"
          onClick={() => {
            if (canAutoPrompt) void promptInstall();
            else setIosHelpOpen(true);
          }}
          title="Install this site as an app on your device"
        >
          Install app
        </button>
      )}
      {offlineReady && (
        <>
          <span
            class="install-pill offline"
            title="The site is cached — it'll launch without a network next time"
          >
            ✓ Offline-ready
          </span>
          {/* Small refresh button next to the offline pill. One click
              pulls the latest build from the server (network-probed,
              so it's a no-op when offline). Separate from the full
              Force Refresh in the About modal — this is the quick,
              always-visible surface. */}
          <button
            type="button"
            class={'refresh-btn' + (refreshState === 'offline' ? ' offline' : '')}
            onClick={handleRefresh}
            disabled={refreshState === 'checking'}
            title={refreshTitle}
            aria-label={refreshTitle}
          >
            <svg
              class="refresh-icon" viewBox="0 0 24 24"
              width="14" height="14" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true"
            >
              {/* Circular refresh arrow — hand-drawn, not lifted from a
                  library. Three-quarter arc + a small arrowhead at one end. */}
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </>
      )}
      {iosHelpOpen && <IosInstallModal onClose={() => setIosHelpOpen(false)} />}
    </>
  );
}

function IosInstallModal({ onClose }: { onClose: () => void }) {
  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
  return (
    <div class="modal" role="dialog" aria-modal="true" onClick={onBackdrop}>
      <div class="modal-card install-modal-card">
        <div class="modal-head">
          <h2>Install on iOS</h2>
          <button class="modal-close" type="button" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div class="modal-body">
          <p>
            Apple doesn't let web pages trigger installation directly.
            To put this on your home screen:
          </p>
          <ol class="install-steps">
            <li>
              Open this page in <strong>Safari</strong> (not Chrome or another
              iOS browser — add-to-home lives behind Safari's share sheet).
            </li>
            <li>
              Tap the <strong>Share</strong> button (the square with an up
              arrow) in the bottom toolbar.
            </li>
            <li>
              Scroll the share sheet and pick <strong>Add to Home Screen</strong>.
            </li>
            <li>
              Confirm with <strong>Add</strong> in the top right.
            </li>
          </ol>
          <p class="footnote">
            Once installed, the app launches from your home screen without
            Safari chrome, full-screen, and works offline on playa.
          </p>
        </div>
      </div>
    </div>
  );
}
