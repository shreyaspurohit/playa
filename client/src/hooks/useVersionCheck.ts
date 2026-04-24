// Polls /version.txt periodically to detect when a new deploy is
// available. The current page's version comes from
// `<meta name="bm-version">`, baked in by the Python builder. The
// service worker is configured to bypass /version.txt so polls always
// go to origin (no risk of serving the just-cached copy).
//
// Lifecycle:
//   - First check fires shortly after mount (so a stale tab opened
//     after a deploy gets the banner immediately).
//   - Re-checks every POLL_INTERVAL_MS while the tab is visible.
//   - Pauses when the tab is hidden (no point burning network on a
//     backgrounded tab) and re-checks when it becomes visible.
//   - Stops polling once an update is found — there's nothing more to
//     learn after that and the user has the banner up.
import { useEffect, useState } from 'preact/hooks';

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
/** Tiny initial delay so the first check doesn't compete with mount /
 *  tab restore work. Long enough to not be jarring, short enough that
 *  a clearly-stale tab still surfaces the banner quickly. */
const INITIAL_DELAY_MS = 30 * 1000;

function loadedVersion(): string {
  if (typeof document === 'undefined') return '';
  const meta = document.querySelector('meta[name="bm-version"]');
  return (meta?.getAttribute('content') ?? '').trim();
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const r = await fetch('./version.txt', { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.text()).trim();
  } catch {
    return null;
  }
}

/**
 * Parse `v{YYYY}.{MM}.{DD}[.{HHMM}]` (or any dot-separated numeric
 * tail) into an array of integers. Missing trailing components default
 * to 0 so older builds compare correctly against newer ones.
 *
 * Exported so the unit test can assert against it directly.
 */
export function parseVersion(v: string): number[] {
  const cleaned = v.replace(/^v/i, '').trim();
  if (!cleaned) return [];
  return cleaned.split('.').map((s) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/**
 * True when `latest` is strictly newer than `current`. Compares
 * component-by-component as integers (so v2026.04.24.1715 > v2026.04.24).
 * Equal versions return false (no banner). A `latest` that's *older*
 * than current also returns false — covers the rollback case where the
 * user shouldn't be nagged after a deliberate revert.
 */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function useVersionCheck(): { updateAvailable: boolean; latest: string } {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latest, setLatest] = useState('');

  useEffect(() => {
    const current = loadedVersion();
    if (!current) return; // nothing to compare against

    let stopped = false;
    let timer: number | undefined;

    async function check() {
      if (stopped) return;
      const fresh = await fetchLatestVersion();
      if (stopped) return;
      // Only nag when the server is strictly newer — a rollback
      // (server version < ours) shouldn't pretend to be an upgrade.
      if (fresh && isNewer(fresh, current)) {
        setLatest(fresh);
        setUpdateAvailable(true);
        // Stop the timer + visibility listener — no more checks needed.
        cleanup();
      }
    }

    function schedule(delay: number) {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await check();
        schedule(POLL_INTERVAL_MS);
      }, delay);
    }

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      // Coming back to the tab — re-check immediately, then resume the
      // normal cadence from there.
      check();
    }

    function cleanup() {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    }

    schedule(INITIAL_DELAY_MS);
    document.addEventListener('visibilitychange', onVisible);
    return cleanup;
  }, []);

  return { updateAvailable, latest };
}
