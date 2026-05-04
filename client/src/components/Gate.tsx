// Password gate, shown when the embedded data is encrypted. On
// success, caches the password in localStorage so the unlock survives
// tab kills — mobile browsers reclaim backgrounded tabs aggressively
// and sessionStorage went with them, which made the app re-prompt
// every time you switched away and back. The cached value is
// AES-GCM-encrypted with a non-extractable per-device key in
// IndexedDB so the disk-side blob is meaningless without the
// browser's runtime — see `utils/secureStore.ts` for the threat
// model. For multi-tab UX, an already-unlocked tab also broadcasts
// the password over a BroadcastChannel so a freshly-opened tab
// decrypts silently. "Clear all local data" in the About modal
// wipes both the encrypted blob and the wrapping key.
import { useEffect, useRef, useState } from 'preact/hooks';
import { decryptPayload } from '../crypto';
import { SS, type EncryptedPayload } from '../types';
import {
  cachePassword, clearCachedPassword, loadCachedPassword,
} from '../utils/secureStore';
import { isGzipDecompressSupported } from '../utils/gzip';

interface Props {
  enc: EncryptedPayload;
  /** Called after a successful unlock with the decrypted camps JSON
   *  AND the password the user entered. The password is needed by
   *  the parent so it can also decrypt the parallel `art-data-…
   *  -encrypted` script (single-tier mode embeds two ciphers per
   *  source — camps + art — protected by the same password). */
  onUnlock: (jsonText: string, password: string) => void;
}

const PW_CHANNEL = 'playa-camps-pw';
/** How long a fresh tab waits for an existing tab to broadcast the
 *  password. Long enough to cover slow page paint + channel latency,
 *  short enough that opening the very-first tab doesn't feel laggy. */
const PW_REQUEST_TIMEOUT_MS = 700;

export function Gate({ enc, onUnlock }: Props) {
  const [error, setError] = useState('');
  const [checkingCache, setCheckingCache] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    let cancelled = false;
    const channel = 'BroadcastChannel' in window
      ? new BroadcastChannel(PW_CHANNEL)
      : null;
    channelRef.current = channel;

    async function tryPassword(pw: string): Promise<boolean> {
      try {
        const text = await decryptPayload(enc, pw);
        await cachePassword(pw);
        if (!cancelled) onUnlock(text, pw);
        return true;
      } catch {
        return false;
      }
    }

    // Existing tabs answer "request"s with the cached password; tabs
    // also relay successful unlocks ("share"). New tabs listen for
    // either and use whichever lands first.
    if (channel) {
      channel.onmessage = async (e) => {
        const msg = e.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'request') {
          const pw = await loadCachedPassword();
          if (pw) channel.postMessage({ type: 'share', pw });
        } else if (msg.type === 'share' && typeof msg.pw === 'string') {
          if (cancelled) return;
          await tryPassword(msg.pw);
        }
      };
    }

    (async () => {
      // 1) Encrypted localStorage cache (this device unlocked earlier).
      //    Also handles the legacy plaintext format from older builds
      //    transparently — see secureStore.loadCachedPassword.
      let remembered = await loadCachedPassword();
      // 2) Migrate sessionStorage cache from the previous-previous
      //    build (sessionStorage → plaintext LS → encrypted LS).
      if (!remembered) {
        try {
          const legacy = sessionStorage.getItem(SS.password);
          if (legacy) {
            remembered = legacy;
            sessionStorage.removeItem(SS.password);
          }
        } catch { /* private mode etc — fall through */ }
      }
      if (remembered) {
        if (await tryPassword(remembered)) return;
        // Stored value didn't decrypt — server password rotated.
        // Drop the cache (and wrapping key) so we don't loop.
        clearCachedPassword();
      }
      // 3) Ask other tabs over the channel.
      if (channel && !cancelled) {
        channel.postMessage({ type: 'request' });
        await new Promise((r) => setTimeout(r, PW_REQUEST_TIMEOUT_MS));
      }
      // If a sibling tab answered, onUnlock has already been called and
      // this Gate is being unmounted (cancelled = true). Otherwise show
      // the prompt.
      if (!cancelled) setCheckingCache(false);
    })();

    return () => {
      cancelled = true;
      try { channel?.close(); } catch {}
      channelRef.current = null;
    };
  }, [enc, onUnlock]);

  useEffect(() => {
    if (!checkingCache) inputRef.current?.focus();
  }, [checkingCache]);

  if (checkingCache) return null;

  // Compression-streams support is the floor for any encrypted build
  // post-D12 (encrypted ciphers are gzipped first). If the user's
  // browser doesn't have it AND the embedded payload is compressed,
  // unlock would silently fail. Surface a clear upgrade prompt
  // instead — same gate slot the password form would use.
  if (enc.compressed && !isGzipDecompressSupported()) {
    return (
      <div class="gate">
        <div class="gate-card">
          <h2>Browser too old</h2>
          <p>
            This site needs the <code>DecompressionStream</code> Web API,
            which shipped in Chrome 80 (Feb 2020), Safari 16.4 / iOS 16.4
            (March 2023), and Firefox 113 (May 2023). Please update your
            browser or OS — most devices made in the last few years can.
          </p>
        </div>
      </div>
    );
  }

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError('');
    const pw = inputRef.current?.value ?? '';
    if (!pw) return;
    try {
      const text = await decryptPayload(enc, pw);
      await cachePassword(pw);
      // Hand the password to any sibling tab that's still on the gate.
      try { channelRef.current?.postMessage({ type: 'share', pw }); } catch {}
      onUnlock(text, pw);
    } catch {
      setError('Wrong password. Try again.');
      inputRef.current?.select();
    }
  }

  return (
    <div class="gate">
      <div class="gate-card">
        <h2>Playa Camps — private</h2>
        <p>
          This is a personal, non-commercial index of the public Playa Info
          directory, shared with friends. Enter the password you were given
          to continue.
        </p>
        <form onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="password"
            autocomplete="current-password"
            placeholder="Password"
          />
          <button type="submit">Unlock</button>
        </form>
        <div class="err" aria-live="polite">{error}</div>
      </div>
    </div>
  );
}
