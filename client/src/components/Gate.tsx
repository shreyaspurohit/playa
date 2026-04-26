// Password gate, shown when the embedded data is encrypted. On
// success, caches the password in sessionStorage (per-tab — cleared on
// tab close, much tighter than localStorage). For multi-tab UX, an
// already-unlocked tab broadcasts the password over a BroadcastChannel
// so a freshly-opened tab can decrypt without re-prompting. Password
// never lands in localStorage / disk; if every tab is closed, the
// next session starts with the gate again.
import { useEffect, useRef, useState } from 'preact/hooks';
import { decryptPayload } from '../crypto';
import { SS, type EncryptedPayload } from '../types';

interface Props {
  enc: EncryptedPayload;
  onUnlock: (jsonText: string) => void;
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
        try { sessionStorage.setItem(SS.password, pw); } catch {}
        if (!cancelled) onUnlock(text);
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
          let pw: string | null = null;
          try { pw = sessionStorage.getItem(SS.password); } catch {}
          if (pw) channel.postMessage({ type: 'share', pw });
        } else if (msg.type === 'share' && typeof msg.pw === 'string') {
          if (cancelled) return;
          await tryPassword(msg.pw);
        }
      };
    }

    (async () => {
      // 1) sessionStorage cache (this tab unlocked earlier in its life).
      let remembered: string | null = null;
      try { remembered = sessionStorage.getItem(SS.password); } catch {}
      if (remembered) {
        if (await tryPassword(remembered)) return;
        try { sessionStorage.removeItem(SS.password); } catch {}
      }
      // 2) Ask other tabs over the channel.
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

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError('');
    const pw = inputRef.current?.value ?? '';
    if (!pw) return;
    try {
      const text = await decryptPayload(enc, pw);
      try { sessionStorage.setItem(SS.password, pw); } catch {}
      // Hand the password to any sibling tab that's still on the gate.
      try { channelRef.current?.postMessage({ type: 'share', pw }); } catch {}
      onUnlock(text);
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
