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
//   'stale'     — version.txt proves a newer build exists, but the SW
//                 cache still contains an older shell. Means GitHub
//                 Pages' Fastly edge cache hasn't propagated the new
//                 index.html yet. Reload would be a no-op so we skip it;
//                 UI surfaces the wait.

import { isNewer } from '../hooks/useVersionCheck';

export type RefreshOutcome = 'refreshed' | 'offline' | 'stale';

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

/** Read the origin version pin. The SW deliberately bypasses this URL,
 *  so it tells us whether there really is a newer deployment to wait for. */
async function serverVersion(): Promise<string | null> {
  try {
    const r = await fetch('./version.txt', { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.text()).trim() || null;
  } catch {
    return null;
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

/** Pull the bm-version meta out of an index.html string. Returns null
 *  if it isn't present (e.g., a cached error page). */
function extractVersion(html: string): string | null {
  const m = html.match(/<meta\s+name=["']bm-version["']\s+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/** Read the version baked into the currently loaded page. */
function loadedVersion(): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector('meta[name="bm-version"]');
  return (meta?.getAttribute('content') ?? '').trim() || null;
}

/** Look at whatever index.html the SW would serve next reload, and
 *  pull its bm-version. We search every same-origin cache (the new SW
 *  could have just installed a brand-new cache while the old one still
 *  controls the page) and take the newest version found. Returns null
 *  if no cache has a parseable index.html. */
async function newestCachedVersion(): Promise<string | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const names = await caches.keys();
    let newest: string | null = null;
    for (const name of names) {
      const cache = await caches.open(name);
      const resp = await cache.match('./index.html');
      if (!resp) continue;
      const version = extractVersion(await resp.text());
      if (!version) continue;
      if (!newest || isNewer(version, newest)) newest = version;
    }
    return newest;
  } catch {
    return null;
  }
}

/** Only call the cache stale when the origin advertises a strictly newer
 *  build and the refreshed cache has not caught up. Equal versions mean the
 *  user is already current — the normal case for a manual Force refresh. */
export function shouldReportStale(
  current: string | null,
  cached: string | null,
  server: string | null,
): boolean {
  return Boolean(
    current && cached && server
    && isNewer(server, current)
    && isNewer(server, cached),
  );
}

export async function forceRefresh(): Promise<RefreshOutcome> {
  if (!await probeNetwork()) return 'offline';

  // Capture the origin's advertised version before refreshing the shell.
  // A missing version pin must not turn a healthy manual refresh into a
  // false "server propagating" warning.
  const server = await serverVersion();

  try {
    if ('serviceWorker' in navigator) {
      // Always trigger an update check so the browser fetches a
      // newer sw.js if one is at origin. The new SW's install
      // handler (in builder.py) uses cache: 'reload' per-URL, so a
      // fresh deploy is precached with origin-fresh bytes, bypassing
      // any HTTP-cache window that GH Pages may be serving inside.
      // This was the missing piece: previously, the old SW would
      // refresh its OWN cache via REFRESH_SHELL, but the new SW
      // could activate during reload and serve from its own cache
      // populated by addAll() with HTTP-cache-stale bytes.
      const reg = await navigator.serviceWorker.getRegistration();
      const updatePromise = reg?.update().catch(() => {});
      const sw = navigator.serviceWorker.controller;
      if (sw) {
        // Controlled page: also ask the existing SW to re-fetch its
        // shell entries — covers the case where no new sw.js exists
        // (just a rebuild without a version change is unusual but
        // possible) and minimizes the time-to-fresh-cache on the
        // current SW.
        const ack = waitForShellRefresh(SW_REFRESH_TIMEOUT_MS);
        sw.postMessage('REFRESH_SHELL');
        await ack;
      }
      // Wait for the update check to settle too — installs the new
      // SW (and runs its precache) before we reload.
      await updatePromise;
    }
  } catch {
    // Any failure here is non-fatal: the cache is untouched, the SW
    // still controls the page, and the reload below will serve what
    // was there before — exactly the state we started in.
  }

  // Stale-cache guard. Equal loaded/cached versions are not sufficient:
  // that is also what a fully up-to-date app looks like. Only surface the
  // propagation state when version.txt proves the server is ahead.
  const current = loadedVersion();
  const cached = await newestCachedVersion();
  if (shouldReportStale(current, cached, server)) {
    return 'stale';
  }

  location.reload();
  return 'refreshed';
}
