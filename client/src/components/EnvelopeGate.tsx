// Multi-tier password gate for envelope-encrypted builds (ADR D10).
//
// Walks every wrapper for every source with the entered password.
// First successful unwrap per source caches the 48-byte DEK+IV and
// adds that source to the user's unlocked set. If at least one
// source unlocks, the app proceeds (with the dropdown narrowed to
// the unlocked subset). All-fail → "wrong password".
//
// Caching, cross-tab broadcast, and the "browser too old" upgrade
// banner mirror Gate.tsx — the only behavioral difference is the
// multi-wrapper try-loop and the unlock callback shape.
import { useEffect, useRef, useState } from 'preact/hooks';
import { unwrapDek } from '../crypto';
import { SS, type Source } from '../types';
import type { EnvelopeSource } from '../data';
import {
  cachePassword, clearCachedPassword, loadCachedPassword,
} from '../utils/secureStore';
import { isGzipDecompressSupported } from '../utils/gzip';

interface Props {
  sources: EnvelopeSource[];
  /** Called with the per-source DEK+IV map after a successful unlock.
   *  An empty map is never passed — onUnlock only fires when at least
   *  one wrapper successfully unwraps. */
  onUnlock: (unlocked: Map<Source, Uint8Array>) => void;
}

const PW_CHANNEL = 'playa-camps-pw';
const PW_REQUEST_TIMEOUT_MS = 700;

export function EnvelopeGate({ sources, onUnlock }: Props) {
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

    /** Try a password against every (source, wrapper) pair. Returns
     *  the unlocked map if any source unlocked, else null. Walks
     *  wrappers in order; first success per source wins. */
    async function tryPassword(
      pw: string,
    ): Promise<Map<Source, Uint8Array> | null> {
      const unlocked = new Map<Source, Uint8Array>();
      for (const src of sources) {
        for (const wrapper of src.wrappers) {
          const dekIv = await unwrapDek(wrapper, pw);
          if (dekIv) {
            unlocked.set(src.source, dekIv);
            break;     // first wrapper-success is enough for this source
          }
        }
      }
      return unlocked.size > 0 ? unlocked : null;
    }

    if (channel) {
      channel.onmessage = async (e) => {
        const msg = e.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'request') {
          const pw = await loadCachedPassword();
          if (pw) channel.postMessage({ type: 'share', pw });
        } else if (msg.type === 'share' && typeof msg.pw === 'string') {
          if (cancelled) return;
          const m = await tryPassword(msg.pw);
          if (m) {
            await cachePassword(msg.pw);
            onUnlock(m);
          }
        }
      };
    }

    (async () => {
      let remembered = await loadCachedPassword();
      if (!remembered) {
        try {
          const legacy = sessionStorage.getItem(SS.password);
          if (legacy) {
            remembered = legacy;
            sessionStorage.removeItem(SS.password);
          }
        } catch { /* private mode etc */ }
      }
      if (remembered) {
        const m = await tryPassword(remembered);
        if (m) {
          if (!cancelled) onUnlock(m);
          return;
        }
        clearCachedPassword();
      }
      if (channel && !cancelled) {
        channel.postMessage({ type: 'request' });
        await new Promise((r) => setTimeout(r, PW_REQUEST_TIMEOUT_MS));
      }
      if (!cancelled) setCheckingCache(false);
    })();

    return () => {
      cancelled = true;
      try { channel?.close(); } catch {}
      channelRef.current = null;
    };
  }, [sources, onUnlock]);

  useEffect(() => {
    if (!checkingCache) inputRef.current?.focus();
  }, [checkingCache]);

  if (checkingCache) return null;

  // Envelope ciphers are always gzipped (D12). If DecompressionStream
  // isn't there, even a successful unlock would fail at decryptSource.
  // Surface the upgrade card now, before the password prompt.
  if (!isGzipDecompressSupported()) {
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
    const unlocked = new Map<Source, Uint8Array>();
    for (const src of sources) {
      for (const wrapper of src.wrappers) {
        const dekIv = await unwrapDek(wrapper, pw);
        if (dekIv) {
          unlocked.set(src.source, dekIv);
          break;
        }
      }
    }
    if (unlocked.size === 0) {
      setError('Wrong password. Try again.');
      inputRef.current?.select();
      return;
    }
    await cachePassword(pw);
    try { channelRef.current?.postMessage({ type: 'share', pw }); } catch {}
    onUnlock(unlocked);
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
