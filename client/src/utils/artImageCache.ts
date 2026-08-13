// Quietly warm the service worker's art-thumbnail cache while the browser is
// idle. Visible <img> requests are cached by the same worker as users scroll;
// this helper fills the remaining gaps without adding a bulk-download UI or
// competing with active interaction.

type ConnectionInfo = EventTarget & {
  saveData?: boolean;
  effectiveType?: string;
};

const FALLBACK_IDLE_MS = 2_500;
const WORKER_REPLY_TIMEOUT_MS = 30_000;
const ACTIVITY_EVENTS = ['scroll', 'pointerdown', 'touchstart', 'keydown'] as const;
// An acknowledged URL is already in the durable SW cache. Remember that for
// this page lifetime so switching sources does not repeat a MessageChannel
// round-trip for every image. Visible <img> requests still go through the SW's
// stale-while-revalidate path and can refresh an updated image from the CDN.
const warmedThisPage = new Set<string>();

function connectionInfo(): ConnectionInfo | undefined {
  return (navigator as Navigator & { connection?: ConnectionInfo }).connection;
}

// This app is offline-first: on the playa there is no network, so we cache as
// much art as possible while a connection exists. We therefore warm on any
// connection we can't positively rule out — including iOS Safari, which does
// not implement the Network Information API (navigator.connection is
// undefined). The only opt-outs we honor are the two explicit, positive
// signals the API does expose where present: the user's Data Saver preference
// and a genuinely slow (2g) link that a bulk warm would never finish anyway.
function mayWarmImages(): boolean {
  if (document.visibilityState !== 'visible' || navigator.onLine === false) return false;
  const connection = connectionInfo();
  if (connection?.saveData) return false;
  return connection?.effectiveType !== 'slow-2g' && connection?.effectiveType !== '2g';
}

function validImageUrls(urls: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:') unique.add(url.href);
    } catch { /* malformed source URL: leave the corresponding card text-only */ }
  }
  return [...unique];
}

function askWorkerToCache(worker: ServiceWorker, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (ok = false) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(ok);
    };
    const timeout = window.setTimeout(() => finish(false), WORKER_REPLY_TIMEOUT_MS);
    channel.port1.onmessage = (event) => finish(event.data?.ok === true);
    try {
      worker.postMessage({ type: 'CACHE_ART_IMAGE', url }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

/**
 * Cache one image per idle period, with at most one request in flight. Existing
 * entries are skipped by the service worker. Returns a Preact-effect cleanup.
 */
export function warmArtImagesWhenIdle(urls: Iterable<string>): () => void {
  const queue = validImageUrls(urls).filter((url) => !warmedThisPage.has(url));
  if (queue.length === 0 || !('serviceWorker' in navigator)) return () => {};
  // Some supported WebViews omit the idle-callback API even though the DOM
  // typings declare it unconditionally.
  const idleWindow = window as unknown as {
    requestIdleCallback?: (callback: IdleRequestCallback) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  let stopped = false;
  let scheduled = false;
  let active = false;
  let idleHandle: number | null = null;
  let timerHandle: number | null = null;
  let lastActivity = Date.now();

  const workerPromise = navigator.serviceWorker.ready
    .then((registration) => (
      navigator.serviceWorker.controller
      ?? registration.active
      ?? registration.waiting
      ?? null
    ))
    .catch(() => null);

  const noteActivity = () => { lastActivity = Date.now(); };

  const schedule = () => {
    if (stopped || scheduled || active || queue.length === 0 || !mayWarmImages()) return;
    scheduled = true;

    const run = () => {
      scheduled = false;
      if (stopped || active || queue.length === 0 || !mayWarmImages()) return;
      const quietFor = Date.now() - lastActivity;
      if (!idleWindow.requestIdleCallback && quietFor < FALLBACK_IDLE_MS) {
        schedule();
        return;
      }

      active = true;
      void (async () => {
        const worker = await workerPromise;
        if (stopped || !worker || !mayWarmImages()) return;
        const url = queue.shift();
        if (url && await askWorkerToCache(worker, url)) warmedThisPage.add(url);
      })().finally(() => {
        active = false;
        schedule();
      });
    };

    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(() => run());
    } else {
      const quietFor = Date.now() - lastActivity;
      timerHandle = window.setTimeout(run, Math.max(250, FALLBACK_IDLE_MS - quietFor));
    }
  };

  const resume = () => schedule();
  for (const type of ACTIVITY_EVENTS) {
    window.addEventListener(type, noteActivity, { passive: true });
  }
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  connectionInfo()?.addEventListener('change', resume);
  schedule();

  return () => {
    stopped = true;
    if (idleHandle !== null && idleWindow.cancelIdleCallback) {
      idleWindow.cancelIdleCallback(idleHandle);
    }
    if (timerHandle !== null) window.clearTimeout(timerHandle);
    for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, noteActivity);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
    connectionInfo()?.removeEventListener('change', resume);
  };
}
