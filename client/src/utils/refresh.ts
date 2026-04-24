// Safe force-refresh: non-destructive update that never leaves the
// user on a broken page when the network is flaky.
//
// How it used to work (destructive):
//   1. Probe network.
//   2. Unregister the SW.
//   3. Delete every Cache Storage entry.
//   4. `location.reload()`.
// If step 4's request failed after steps 2–3, the user landed on a
// blank/error page with no cache + no SW to fall back to.
//
// How it works now (non-destructive):
//   1. Probe network. Bail if offline.
//   2. Ask the SW (via `postMessage`) to re-fetch the shell from
//      origin into its current cache. Per-URL failures are swallowed;
//      the old cache entry stays.
//   3. `location.reload()`. The SW's cache-first handler serves
//      whatever is in cache — fresh bytes on success, the previous
//      cached copy if any fetch failed.
//
// Outcomes:
//   'refreshed' — page is reloading now. Fresh content if server was
//                 reachable; otherwise the cache stays as-is and the
//                 next load will look identical to the previous one,
//                 but at least the page still loads.
//   'offline'   — skipped everything. Existing cache + SW untouched.

type RefreshOutcome = 'refreshed' | 'offline';

/** Max time to wait for the SW to acknowledge the shell-refresh. After
 *  this we reload anyway — the SW's background-refresh pattern on
 *  normal fetch handling will eventually catch up. */
const SW_REFRESH_TIMEOUT_MS = 5000;

async function probeNetwork(): Promise<boolean> {
  if ('onLine' in navigator && navigator.onLine === false) return false;
  // HEAD bypasses our SW's fetch handler (it early-exits on non-GET),
  // so this hits the actual server.
  try {
    const r = await fetch('./index.html', {
      method: 'HEAD',
      cache: 'no-store',
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Resolves when the SW posts back `SHELL_REFRESHED`, or when the
 *  timeout elapses. Cleans up its listener either way. */
function waitForShellRefresh(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (!('serviceWorker' in navigator)) {
      resolve();
      return;
    }
    const onMsg = (e: MessageEvent) => {
      if (e.data === 'SHELL_REFRESHED') {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        window.clearTimeout(timer);
        resolve();
      }
    };
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMsg);
      resolve();
    }, timeoutMs);
    navigator.serviceWorker.addEventListener('message', onMsg);
  });
}

export async function forceRefresh(): Promise<RefreshOutcome> {
  if (!await probeNetwork()) return 'offline';

  try {
    if ('serviceWorker' in navigator) {
      const sw = navigator.serviceWorker.controller;
      if (sw) {
        // Controlled page: ask the SW to re-fetch its shell entries.
        // We await the ack (or the timeout) so the reload below has a
        // reasonable chance of seeing fresh content in cache. If the
        // fetch failed the SW leaves the old entry in place, so the
        // reload will still find something to serve.
        const ack = waitForShellRefresh(SW_REFRESH_TIMEOUT_MS);
        sw.postMessage('REFRESH_SHELL');
        await ack;
      } else {
        // No controller (hard-refreshed tab, first visit, or an older
        // SW that predates the message handler). Trigger the standard
        // SW update path so a new sw.js gets fetched + installed.
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      }
    }
  } catch {
    // Any failure here is non-fatal: the cache is untouched, the SW
    // still controls the page, and the reload below will serve what
    // was there before — exactly the state we started in.
  }

  location.reload();
  return 'refreshed';
}
