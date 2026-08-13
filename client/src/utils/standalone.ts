// Is the app running as an installed / standalone PWA (vs. a browser tab)?
//
// iOS Safari uses the non-standard `navigator.standalone`; everyone else uses
// the `display-mode: standalone` media query. Check both. Used by the install
// UI (to hide the install button) and by cloud sync (to pick the redirect OAuth
// path, since popups can't hand a code back into an iOS standalone web view —
// see docs/16 D13).
export function isStandaloneDisplay(): boolean {
  try {
    const iosStandalone =
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    const mq = typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches;
    return iosStandalone || mq;
  } catch {
    return false;
  }
}
