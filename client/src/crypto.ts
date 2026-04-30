// Web Crypto decryption that mirrors the Python-side
// `SiteBuilder.encrypt_payload()` (gzip → openssl -aes-256-cbc -salt
// -pbkdf2). Key+IV are derived together as 48 bytes of PBKDF2-HMAC-SHA256,
// then split: first 32 = AES-CBC key, last 16 = IV. After decrypt, if
// the envelope's `compressed` flag is set, we pipe through
// DecompressionStream('gzip') to reverse the build-time gzip step
// (ADR D12). See CLAUDE.md "Encryption round-trip" for the contract.
import type { EncryptedPayload } from './types';
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
