// Tests for the at-rest password encryption layer. Uses fake-indexeddb
// + Node's built-in crypto.subtle to round-trip a real AES-GCM encrypt
// + decrypt across the cachePassword / loadCachedPassword pair.
//
// What we want to pin:
//   - Round-trip: cache → load returns the same value.
//   - Multiple writes round-trip independently (different IVs).
//   - Garbage / non-JSON LS values return null instead of throwing.
//   - clearCachedPassword wipes both LS AND the IDB-stored wrapping
//     key, so a re-cache afterwards mints a fresh key.
//   - Two browsers / origins (simulated by deleting + re-creating the
//     IDB) end up with different wrapping keys → ciphertext from one
//     can't be decrypted with the other's key.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

// fake-indexeddb provides a synchronous-ish, in-memory IDB
// implementation. Importing the auto module installs it as the global
// `indexedDB` for the rest of the run.
import 'fake-indexeddb/auto';

// happy-dom for `window` + the storage helpers in secureStore use
// `window.localStorage`. Note: the secureStore module also reads
// `crypto.subtle` — Node 22 exposes it as a global, so we don't need
// a polyfill there.
import { installDom, teardownDom } from './_dom';

// Imports happen AFTER the polyfills are installed so the module
// captures the patched globals.
let cachePassword: typeof import('../src/utils/secureStore').cachePassword;
let loadCachedPassword: typeof import('../src/utils/secureStore').loadCachedPassword;
let clearCachedPassword: typeof import('../src/utils/secureStore').clearCachedPassword;

beforeEach(async () => {
  installDom();
  // Ensure crypto + indexedDB are visible on globalThis (they may be
  // on the happy-dom Window only after install).
  if (typeof (globalThis as { crypto?: Crypto }).crypto === 'undefined'
    || !(globalThis as { crypto?: Crypto }).crypto?.subtle) {
    // Node 22 has it; surface the global to the modules.
    const nodeCrypto = (await import('node:crypto')).webcrypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: nodeCrypto, configurable: true, writable: true,
    });
  }
  // Re-import the module fresh so it picks up the test's globals each
  // time. Cache busting via query string forces re-evaluation.
  const mod = await import('../src/utils/secureStore?t=' + Date.now());
  cachePassword = mod.cachePassword;
  loadCachedPassword = mod.loadCachedPassword;
  clearCachedPassword = mod.clearCachedPassword;
});

afterEach(() => {
  // Wipe IDB between tests so each starts with a fresh wrapping key.
  // fake-indexeddb's `deleteDatabase` resolves quickly.
  try { indexedDB.deleteDatabase('playa-camps-secure'); } catch { /* ignore */ }
  try { localStorage.clear(); } catch { /* ignore */ }
  teardownDom();
});

describe('secureStore', () => {
  test('round-trip: cachePassword → loadCachedPassword returns the same value', async () => {
    await cachePassword('hunter2');
    const back = await loadCachedPassword();
    assert.equal(back, 'hunter2');
  });

  test('cached blob in LS is JSON-shaped, not the plaintext password', async () => {
    await cachePassword('please-do-not-leak');
    const raw = localStorage.getItem('bm-pw');
    assert.ok(raw);
    assert.ok(raw!.startsWith('{'), 'should be JSON envelope');
    assert.ok(!raw!.includes('please-do-not-leak'),
      'plaintext must not appear in localStorage');
    const parsed = JSON.parse(raw!);
    assert.equal(parsed.v, 1);
    assert.ok(typeof parsed.iv === 'string');
    assert.ok(typeof parsed.ct === 'string');
  });

  test('two writes use different IVs (so identical passwords still differ on disk)', async () => {
    await cachePassword('same-password');
    const first = localStorage.getItem('bm-pw');
    await cachePassword('same-password');
    const second = localStorage.getItem('bm-pw');
    assert.notEqual(first, second,
      'AES-GCM with a fresh IV per write should produce different ciphertext');
  });

  test('loadCachedPassword returns null when LS is empty', async () => {
    const result = await loadCachedPassword();
    assert.equal(result, null);
  });

  test('loadCachedPassword returns null on garbage in LS (not a JSON envelope)', async () => {
    localStorage.setItem('bm-pw', 'totally-not-json');
    const result = await loadCachedPassword();
    assert.equal(result, null);
  });

  test('loadCachedPassword returns null when v is wrong', async () => {
    localStorage.setItem('bm-pw', JSON.stringify({ v: 999, iv: 'x', ct: 'y' }));
    const result = await loadCachedPassword();
    assert.equal(result, null);
  });

  test('loadCachedPassword returns null when iv/ct missing', async () => {
    localStorage.setItem('bm-pw', JSON.stringify({ v: 1 }));
    const result = await loadCachedPassword();
    assert.equal(result, null);
  });

  test('decrypt failure (corrupted ct) returns null instead of throwing', async () => {
    await cachePassword('original');
    // Tamper with the stored blob's ct.
    const raw = localStorage.getItem('bm-pw')!;
    const blob = JSON.parse(raw);
    blob.ct = 'AAAAAAAAAAAA';   // valid base64 but wrong bytes
    localStorage.setItem('bm-pw', JSON.stringify(blob));
    const result = await loadCachedPassword();
    assert.equal(result, null);
  });

  test('clearCachedPassword removes the LS blob', async () => {
    await cachePassword('something');
    assert.ok(localStorage.getItem('bm-pw'));
    clearCachedPassword();
    assert.equal(localStorage.getItem('bm-pw'), null);
  });

  test('clearCachedPassword deletes the IDB wrapping key (next cache mints a new one)', async () => {
    await cachePassword('first');
    const firstBlob = localStorage.getItem('bm-pw');
    clearCachedPassword();
    // fake-indexeddb's deleteDatabase is async; let it settle.
    await new Promise((r) => setTimeout(r, 50));
    await cachePassword('second');
    const secondBlob = localStorage.getItem('bm-pw');
    // Different wrapping key + new IV → blobs must differ even if
    // the strings happen to be the same length.
    assert.notEqual(firstBlob, secondBlob);
    // And the second blob should round-trip cleanly.
    const back = await loadCachedPassword();
    assert.equal(back, 'second');
  });

  test('a blob encrypted under one wrapping key is undecryptable after clear', async () => {
    await cachePassword('to-survive-or-not');
    const oldBlob = localStorage.getItem('bm-pw')!;
    clearCachedPassword();   // drops IDB + LS
    await new Promise((r) => setTimeout(r, 50));
    // Re-plant the OLD blob into LS but the IDB key is gone — a fresh
    // key gets minted on the next loadCachedPassword call, which can't
    // decrypt the old ciphertext. Should fail closed (return null).
    localStorage.setItem('bm-pw', oldBlob);
    const result = await loadCachedPassword();
    assert.equal(result, null);
  });
});
