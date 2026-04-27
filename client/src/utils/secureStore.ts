// Tiny secure-store for the cached site password. The threat model:
//
//   - localStorage values can leak via browser backups (iOS / Android
//     cloud sync), forensic dumps of the profile dir, dev-tools
//     screenshots, or shared-device snooping.
//   - We can't make ourselves invulnerable in the browser context (a
//     full malware compromise of the browser process can do anything),
//     but we can make the value-on-disk meaningless on its own.
//
// Strategy:
//
//   1. Generate a random AES-GCM key with `extractable: false` and
//      stash the CryptoKey object itself in IndexedDB. IDB stores
//      CryptoKey objects via structured-clone, and a non-extractable
//      key's raw bytes are never exposed to JS — `subtle.exportKey`
//      throws on it, so even our own code can't read the key after
//      it lands.
//   2. Encrypt the password with that key + a fresh 12-byte IV per
//      write, store `{iv, ct}` (base64) in localStorage.
//   3. On read, look up the key in IDB and decrypt.
//
// What this defends against:
//   - Anyone exporting a snapshot of localStorage (cloud sync,
//     "browser data" backups, tab-restore files) sees only
//     `{iv:"…",ct:"…"}` blobs they can't decode without the IDB key.
//   - Forensic dumps of the IDB file see encrypted bytes for the
//     stored CryptoKey too (UAs wrap non-extractable keys at rest).
//
// What this does NOT defend against:
//   - Malware running in the same browser process — Web Crypto runs
//     there, so the same JS that decrypts can be subverted.
//   - Someone with the device PIN / unlock + physical access. (The
//     browser will happily decrypt for them, same as any native app.)

import { LS } from '../types';
import { readString, removeKey, writeString } from './storage';

const DB_NAME = 'playa-camps-secure';
const DB_VERSION = 1;
const STORE = 'keys';
const KEY_ID = 'pw-key';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);   // private mode, quota, etc.
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idbPut(db: IDBDatabase, value: unknown, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get the per-device wrapping key, generating one on first use.
 *  `extractable: false` is the load-bearing flag — once stored, the
 *  raw bytes can't be recovered by our JS, by dev tools, or by any
 *  other code on the page. */
async function getWrappingKey(): Promise<CryptoKey | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const db = await openDb();
  if (!db) return null;
  try {
    const existing = await idbGet(db, KEY_ID);
    if (existing && (existing as CryptoKey).type === 'secret') {
      return existing as CryptoKey;
    }
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,                             // NOT extractable — see file header
      ['encrypt', 'decrypt'],
    );
    await idbPut(db, key, KEY_ID);
    return key;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function b64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encrypt + store the password in localStorage. If Web Crypto and
 * IndexedDB aren't both available (very old browser, locked-down
 * private mode), the cache is silently skipped — the user re-prompts
 * next visit, but no plaintext password ever lands on disk.
 */
export async function cachePassword(pw: string): Promise<void> {
  const key = await getWrappingKey();
  if (!key) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(pw),
    ),
  );
  writeString(LS.password, JSON.stringify({
    v: 1, iv: bytesToB64(iv), ct: bytesToB64(ct),
  }));
}

/**
 * Read + decrypt the cached password. Returns null if absent /
 * corrupted / undecryptable. Only the encrypted JSON envelope
 * `{v, iv, ct}` is recognized — earlier sessionStorage cache is
 * migrated by the Gate, not here.
 */
export async function loadCachedPassword(): Promise<string | null> {
  const raw = readString(LS.password, '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: number; iv?: string; ct?: string };
    if (parsed.v !== 1 || !parsed.iv || !parsed.ct) return null;
    const key = await getWrappingKey();
    if (!key) return null;
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(parsed.iv) },
      key,
      b64ToBytes(parsed.ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** Drop the cached password (LS) AND the wrapping key (IDB). The key
 *  deletion is async-fire-and-forget — callers don't have to await
 *  for the LS removal to take effect. */
export function clearCachedPassword(): void {
  removeKey(LS.password);
  // Also blow away the wrapping key so a "Clear all local data"
  // truly leaves no trace of the unlock state on disk.
  if (typeof indexedDB !== 'undefined') {
    try { indexedDB.deleteDatabase(DB_NAME); } catch { /* ignore */ }
  }
}
