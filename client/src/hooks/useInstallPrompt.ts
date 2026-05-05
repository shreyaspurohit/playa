// PWA standalone + offline-ready state.
//
// We used to also capture `beforeinstallprompt` and detect iOS to
// drive a hand-rolled install button + manual instruction modal. Both
// jobs are now done by the `<pwa-install>` Web Component
// (@khmyznikov/pwa-install), so this hook is reduced to the two
// signals the surrounding UI still cares about:
//
//   1. Standalone — running as an installed app, so the install
//      button + offline pill should be hidden / collapsed.
//   2. Offline-ready — the SW has claimed the page; the site will
//      boot without a network next time.

import { useEffect, useState } from 'preact/hooks';

export interface InstallState {
  /** Running as an installed PWA. No install UI needed. */
  isStandalone: boolean;
  /** Service worker has claimed this page — the shell is cached and
   *  the site will boot offline next time. */
  offlineReady: boolean;
}

function matchesStandalone(): boolean {
  try {
    // iOS Safari uses the non-standard navigator.standalone. Everyone
    // else uses the display-mode media query. Check both.
    const iosStandalone =
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    const mq = typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches;
    return iosStandalone || mq;
  } catch {
    return false;
  }
}

export function useInstallPrompt(): InstallState {
  const [isStandalone, setIsStandalone] = useState<boolean>(matchesStandalone);
  // Start false; flipped true once we confirm a SW registration exists
  // with an active worker. We use `serviceWorker.ready` rather than
  // `serviceWorker.controller` because a hard-refresh (Cmd+Shift+R)
  // loads the page explicitly bypassing the SW, leaving `controller`
  // null even though the SW is still registered and caching the shell.
  const [offlineReady, setOfflineReady] = useState<boolean>(false);

  useEffect(() => {
    const onInstalled = () => {
      // Fires on successful install from any path (pwa-install lib's
      // dialog, browser infobar, OS-level "Add to Home Screen"). Flip
      // standalone so the menu collapses to the installed state.
      setIsStandalone(matchesStandalone());
    };
    window.addEventListener('appinstalled', onInstalled);

    // Standalone can toggle mid-session if a user opens the site from a
    // different context; listen for that too.
    const mq = typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)')
      : null;
    const onMq = () => setIsStandalone(matchesStandalone());
    mq?.addEventListener?.('change', onMq);

    // `ready` resolves once the scope has a registered + active SW —
    // even on a load where this page isn't being SW-controlled (hard
    // refresh). It also resolves immediately on subsequent loads when
    // an SW is already in place.
    let cancelled = false;
    navigator.serviceWorker?.ready
      .then((reg) => { if (!cancelled && reg.active) setOfflineReady(true); })
      .catch(() => { /* no SW support — leave offlineReady false */ });

    // A new SW can take over mid-session (e.g., after a deploy while
    // the tab is open). Flip the flag eagerly.
    const onCtl = () => {
      if (navigator.serviceWorker?.controller) setOfflineReady(true);
    };
    navigator.serviceWorker?.addEventListener('controllerchange', onCtl);

    return () => {
      cancelled = true;
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onMq);
      navigator.serviceWorker?.removeEventListener('controllerchange', onCtl);
    };
  }, []);

  return { isStandalone, offlineReady };
}
