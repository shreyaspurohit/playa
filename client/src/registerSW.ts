// Register the service worker emitted by the Python builder at
// /sw.js. Keeps registration a best-effort: never throws, never
// blocks rendering.
//
// Behavior:
//   - On first load: SW installs, pre-caches the shell (./, index.html,
//     robots.txt). Subsequent loads resolve from cache and work fully
//     offline.
//   - On every later load: SW background-fetches a fresh copy and
//     updates the cache, so the next visit picks up new data/layout.
//   - Local file:// and http:// URLs skip registration — service
//     workers require a secure context, and localhost is the only
//     non-https context browsers allow.

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // `file://` loads (the dev preview) and non-HTTPS/non-localhost are
  // blocked by spec. Don't noisily fail — just skip.
  const isSecure =
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';
  if (!isSecure) return;

  // The SW script lives next to index.html (./sw.js) on Pages.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .catch(() => { /* SW registration is best-effort */ });
  });
}
