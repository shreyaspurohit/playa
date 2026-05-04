// Web Crypto decryption that mirrors the Python-side
// `SiteBuilder.encrypt_payload()` (gzip → openssl -aes-256-cbc -salt
// -pbkdf2). Key+IV are derived together as 48 bytes of PBKDF2-HMAC-SHA256,
// then split: first 32 = AES-CBC key, last 16 = IV. After decrypt, if
// the envelope's `compressed` flag is set, we pipe through
// DecompressionStream('gzip') to reverse the build-time gzip step
// (ADR D12). See CLAUDE.md "Encryption round-trip" for the contract.
//
// Envelope-mode helpers (ADR D10):
//   `unwrapDek`     — PBKDF2 → AES-CBC decrypt a 48-byte DEK+IV blob
//                     using the user's tier password.
//   `decryptSource` — given the unwrapped DEK+IV, decrypt the source
//                     cipher (no PBKDF2; key+iv applied directly).
import type { EncryptedPayload, SourceCipher } from './types';
import { decompressGzip } from './utils/gzip';

// TS 5.7 tightened Uint8Array<ArrayBufferLike> typing vs Web Crypto's
// BufferSource, which insists on ArrayBuffer. We allocate backing
// ArrayBuffers explicitly so the narrower type is satisfied without casts.
function b64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return view;
}

export async function decryptPayload(
  enc: EncryptedPayload,
  password: string,
): Promise<string> {
  const salt = b64(enc.salt);
  const ct = b64(enc.ct);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: enc.iter, hash: 'SHA-256' },
      baseKey,
      48 * 8,
    ),
  );
  // .slice() on Uint8Array returns a copy backed by a fresh ArrayBuffer.
  const key = await crypto.subtle.importKey(
    'raw',
    derived.slice(0, 32),
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  const iv = derived.slice(32, 48);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct);
  if (enc.compressed) {
    const inflated = await decompressGzip(new Uint8Array(plaintext));
    return new TextDecoder().decode(inflated);
  }
  return new TextDecoder().decode(plaintext);
}

/** Try to unwrap a (source, tier) DEK+IV with the user's password.
 *
 *  Returns the 48-byte concat `[dek(32) || iv(16)]` on success, or
 *  `null` on bad password (Web Crypto rejects with a descriptive
 *  exception when the AES-CBC MAC doesn't validate; we treat any
 *  exception as wrong-password).
 *
 *  Same primitive as `decryptPayload` — PBKDF2 + AES-CBC — just
 *  applied to a 48-byte plaintext instead of a JSON string. */
export async function unwrapDek(
  wrapper: EncryptedPayload,
  password: string,
): Promise<Uint8Array | null> {
  try {
    const salt = b64(wrapper.salt);
    const ct = b64(wrapper.ct);
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const derived = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: wrapper.iter, hash: 'SHA-256' },
        baseKey,
        48 * 8,
      ),
    );
    const kek = await crypto.subtle.importKey(
      'raw',
      derived.slice(0, 32),
      { name: 'AES-CBC' },
      false,
      ['decrypt'],
    );
    const iv = derived.slice(32, 48);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv }, kek, ct,
    );
    const bytes = new Uint8Array(plain);
    if (bytes.length !== 48) return null;
    return bytes;
  } catch {
    return null;
  }
}

/** Decrypt a source cipher with the unwrapped DEK+IV.
 *
 *  No PBKDF2 step — the DEK is full-entropy random from the build,
 *  used as the AES-CBC key directly. The IV comes from `cipher.iv`
 *  when the cipher carries one (which it always does in current
 *  builds — and matches the IV portion of `dekIv` for camps ciphers,
 *  but DIFFERS for art ciphers since they reuse the same DEK with a
 *  fresh IV). Falls back to `dekIv[32:48]` for cipher shapes without
 *  an `iv` field — defensive for older bundles, never expected to
 *  fire in practice.
 *
 *  Empty `cipher.ct` short-circuits to "[]" — used when an envelope
 *  bundle predates art support, so the art cipher script tag was
 *  synthesized client-side with empty fields.
 *
 *  Output is gunzipped if the cipher's `compressed` flag is set
 *  (always today; kept as a flag for forward-compat). */
export async function decryptSource(
  cipher: SourceCipher,
  dekIv: Uint8Array,
): Promise<string> {
  if (dekIv.length !== 48) {
    throw new Error(`expected 48-byte DEK+IV, got ${dekIv.length}`);
  }
  if (!cipher.ct) {
    // Synthetic empty cipher — no data, return empty array literal.
    return '[]';
  }
  const keyBytes = new Uint8Array(dekIv.slice(0, 32));
  const ivBytes = cipher.iv
    ? b64(cipher.iv)
    : new Uint8Array(dekIv.slice(32, 48));
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'],
  );
  const ct = b64(cipher.ct);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: ivBytes }, key, ct,
  );
  if (cipher.compressed) {
    const inflated = await decompressGzip(new Uint8Array(plaintext));
    return new TextDecoder().decode(inflated);
  }
  return new TextDecoder().decode(plaintext);
}
