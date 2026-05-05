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
  const [refreshState, setRefreshState] = useState<
    'idle' | 'checking' | 'offline' | 'stale'
  >('idle');

  async function handleRefresh() {
    setRefreshState('checking');
    const outcome = await forceRefresh();
    // 'refreshed' → page is reloading right now, this component unmounts.
    // 'offline' / 'stale' → tell the user, then reset after a beat.
    if (outcome === 'offline') {
      setRefreshState('offline');
      window.setTimeout(() => setRefreshState('idle'), 3000);
    } else if (outcome === 'stale') {
      setRefreshState('stale');
      window.setTimeout(() => setRefreshState('idle'), 4000);
    }
  }

  const refreshTitle =
    refreshState === 'checking' ? 'Checking for updates…'
    : refreshState === 'offline' ? 'Offline — kept your cached copy'
    : refreshState === 'stale' ? 'Server still propagating — try again in a minute'
    : 'Check for a newer version';

  const showInstallButton = !isStandalone && (canAutoPrompt || isIos);
  // Status row text — what to call the cached state to the user. When
  // running as an installed PWA, the SW is implicitly there, so we
  // collapse "Offline ready" + "Installed" into one row to avoid two
  // status pills saying nearly the same thing.
  const statusLabel = isStandalone
    ? 'Installed · offline ready'
    : offlineReady ? 'Offline ready' : null;
  const checkLabel =
    refreshState === 'checking' ? 'Checking…'
    : refreshState === 'offline' ? 'Still offline — kept cache'
    : refreshState === 'stale' ? 'Server propagating — retry'
    : 'Check for updates';

  return (
    <>
      {/* Status row — same layout as a header-menu-item (icon +
          two-line stack), but with a secondary "Check for updates"
          action button at the right. Always renders when the SW is
          managing the page so the user has a one-tap path to pick up
          a new build without leaving the menu. */}
      {statusLabel && (
        <div class="header-menu-status-row">
          <span class="header-menu-icon-svg" aria-hidden="true">
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
            >
              <path d="M7 18a4 4 0 0 1 -.5 -7.97A6 6 0 0 1 18 9.5a3.5 3.5 0 0 1 -1 6.85" />
              <path d="M9 14l2 2 4 -4" />
            </svg>
          </span>
          <span class="header-menu-status-label">{statusLabel}</span>
          <button
            type="button"
            class={
              'header-menu-status-action'
              + (refreshState === 'offline' ? ' offline' : '')
              + (refreshState === 'stale' ? ' stale' : '')
            }
            onClick={handleRefresh}
            disabled={refreshState === 'checking'}
            title={refreshTitle}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
            <span>{checkLabel}</span>
          </button>
        </div>
      )}
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
