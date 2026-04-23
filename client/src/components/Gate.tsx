// Password gate, shown when the embedded data is encrypted. On
// success, caches the password in sessionStorage (per-tab — cleared on
// tab close, much tighter than localStorage).
import { useEffect, useRef, useState } from 'preact/hooks';
import { decryptPayload } from '../crypto';
import { SS, type EncryptedPayload } from '../types';

interface Props {
  enc: EncryptedPayload;
  onUnlock: (jsonText: string) => void;
}

export function Gate({ enc, onUnlock }: Props) {
  const [error, setError] = useState('');
  const [checkingCache, setCheckingCache] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Try a session-cached password first. If decryption succeeds, the
  // gate never paints. If it fails, clear the stale cache and show gate.
  useEffect(() => {
    (async () => {
      let remembered: string | null = null;
      try { remembered = sessionStorage.getItem(SS.password); } catch {}
      if (remembered) {
        try {
          const text = await decryptPayload(enc, remembered);
          onUnlock(text);
          return;
        } catch {
          try { sessionStorage.removeItem(SS.password); } catch {}
        }
      }
      setCheckingCache(false);
    })();
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
      onUnlock(text);
    } catch {
      setError('Wrong password. Try again.');
      inputRef.current?.select();
    }
  }

  return (
    <div class="gate">
      <div class="gate-card">
        <h2>Burning Man Camps — private</h2>
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
