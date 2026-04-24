// PWA install + offline-ready state. Three signals merge here:
//
//   1. `beforeinstallprompt` — Chrome/Edge/Samsung fire this when the
//      site qualifies for installation (valid manifest + registered SW
//      + engagement heuristic). We stash the event so a user click
//      can trigger `prompt()` later.
//
//   2. iOS detection — Apple doesn't expose any install API. We sniff
//      the UA so the button can open a manual-instructions modal
//      instead (Share → Add to Home Screen).
//
//   3. Standalone + SW-controller state — tells the user they're
//      already installed, or that the site is cached and will launch
//      offline next time.

import { useEffect, useState } from 'preact/hooks';

/** Custom shape of the `beforeinstallprompt` event. Not in lib.dom.d.ts
 *  yet — it's a Chrome-ism adopted by Edge/Samsung/Opera. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export interface InstallState {
  /** The browser captured `beforeinstallprompt`; calling
   *  `promptInstall()` will surface the native dialog. */
  canAutoPrompt: boolean;
  /** UA says we're on iOS Safari (or any iOS browser — all run
   *  WebKit and share the same no-API constraint). The install
   *  button should show manual steps instead. */
  isIos: boolean;
  /** Running as an installed PWA. No install UI needed. */
  isStandalone: boolean;
  /** Service worker has claimed this page — the shell is cached and
   *  the site will boot offline next time. */
  offlineReady: boolean;
  /** Fires the native install dialog. Resolves with the user's
   *  outcome, or 'unavailable' when no event was captured. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
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

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ masquerades as Mac — disambiguate via touch support.
  const isIosDevice =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
  return isIosDevice;
}

export function useInstallPrompt(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(matchesStandalone);
  // Start false; flipped true once we confirm a SW registration exists
  // with an active worker. We use `serviceWorker.ready` rather than
  // `serviceWorker.controller` because a hard-refresh (Cmd+Shift+R)
  // loads the page explicitly bypassing the SW, leaving `controller`
  // null even though the SW is still registered and caching the shell.
  const [offlineReady, setOfflineReady] = useState<boolean>(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();                         // stop the default mini-infobar
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      // Fires on successful install from any path (our prompt, browser
      // infobar, menu). Drop the deferred event; flip standalone.
      setDeferred(null);
      setIsStandalone(matchesStandalone());
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
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
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onMq);
      navigator.serviceWorker?.removeEventListener('controllerchange', onCtl);
    };
  }, []);

  const promptInstall: InstallState['promptInstall'] = async () => {
    if (!deferred) return 'unavailable';
    await deferred.prompt();
    const choice = await deferred.userChoice;
    // Per spec the event can only prompt once; discard it either way.
    setDeferred(null);
    return choice.outcome;
  };

  return {
    canAutoPrompt: deferred !== null,
    isIos: detectIos(),
    isStandalone,
    offlineReady,
    promptInstall,
  };
}
