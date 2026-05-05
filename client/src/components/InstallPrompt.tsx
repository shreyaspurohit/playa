// Header-menu install + status block. Two pieces:
//
//   1. Status row — "Installed · offline ready" / "Offline ready",
//      with a "Check for updates" trailing button that calls
//      `forceRefresh()`. Always visible when the SW has claimed the
//      page, so an update is one tap from the menu (regardless of
//      whether the version-check banner has fired).
//
//   2. "Install app" button — defers to the `<pwa-install>` Web
//      Component (@khmyznikov/pwa-install). The library handles the
//      Chrome `beforeinstallprompt` capture, Apple's no-API
//      restriction (renders Add-to-Home-Screen instructions with the
//      current iOS share-sheet visuals), and the Firefox/Opera
//      fallback. We import it lazily on first click so the ~28KB
//      brotli payload only lands when someone actually wants to
//      install — keeps the initial bundle close to what it was.
//
// Hidden when there's nothing useful to show (already installed +
// SW not yet registered).

import { useState } from 'preact/hooks';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { forceRefresh } from '../utils/refresh';

/** Element type for the lazy-loaded `<pwa-install>` Web Component.
 *  Captures the only method we call on it. */
interface PwaInstallElement extends HTMLElement {
  showDialog: (forced?: boolean) => void;
}

/** Lazy-load the pwa-install Web Component on first use, mount a
 *  single instance into <body>, and trigger its dialog. Subsequent
 *  calls reuse the same element. */
async function showPwaInstallDialog(): Promise<void> {
  if (!customElements.get('pwa-install')) {
    await import('@khmyznikov/pwa-install');
    await customElements.whenDefined('pwa-install');
  }
  let el = document.querySelector<PwaInstallElement>('pwa-install');
  if (!el) {
    el = document.createElement('pwa-install') as PwaInstallElement;
    // Manual mode for both Chrome + Apple — we trigger via showDialog
    // when the user clicks Install. Without these, the lib pops the
    // dialog on its own heuristic (first-visit timer / engagement),
    // which is intrusive for our menu-driven flow.
    el.setAttribute('manual-apple', '');
    el.setAttribute('manual-chrome', '');
    el.setAttribute('manifest-url', './manifest.webmanifest');
    // Long-lived dismissal so users who say "no thanks" aren't
    // pestered by the lib's internal show-once heuristic on every
    // tab open. The menu button can still trigger it explicitly.
    el.setAttribute('use-local-storage', '');
    document.body.appendChild(el);
  }
  el.showDialog(true);
}

export function InstallPrompt() {
  const { isStandalone, offlineReady } = useInstallPrompt();
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
      {!isStandalone && (
        <button
          class="install-btn"
          type="button"
          onClick={() => { void showPwaInstallDialog(); }}
          title="Install this site as an app on your device"
        >
          Install app
        </button>
      )}
    </>
  );
}
