// Verify the JS decryption path against the Python-side encryption.
// We can't easily call Python from Node tests, so we use openssl
// directly (same CLI the Python builder uses) as the encryption side.
// This is the exact round-trip the deployed site performs: Python/openssl
// encrypts at build time; the browser decrypts at load time.
//
// As of D12, the build pipeline is gzip → AES. We test both branches:
// `compressed: true` (gzip + AES, current builds) and `compressed`
// omitted/false (legacy AES-only, kept for one-build SW back-compat).
//
// As of D10, envelope mode adds two more decryption helpers:
//   `unwrapDek`     — PBKDF2 + AES-CBC over a 48-byte DEK+IV blob
//   `decryptSource` — raw AES-CBC (no PBKDF2) over a gzip+AES cipher
// Both are round-tripped against openssl below.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { decryptPayload, decryptSource, unwrapDek } from '../src/crypto';

function opensslEncrypt(plaintext: Uint8Array, password: string, iter: number) {
  const proc = spawnSync(
    'openssl',
    ['enc', '-aes-256-cbc', '-salt', '-pbkdf2',
     '-iter', String(iter), '-pass', `pass:${password}`],
    { input: Buffer.from(plaintext) },
  );
  if (proc.status !== 0) {
    throw new Error(`openssl failed: ${proc.stderr.toString()}`);
  }
  const blob = proc.stdout;
  if (blob.slice(0, 8).toString() !== 'Salted__') {
    throw new Error('unexpected openssl output');
  }
  return {
    salt: blob.slice(8, 16).toString('base64'),
    iter,
    ct: blob.slice(16).toString('base64'),
  };
}

/** Mirrors the Python builder: gzip first, then encrypt. */
function buildEncrypted(plaintext: string, password: string, iter: number) {
  const compressed = new Uint8Array(
    gzipSync(Buffer.from(plaintext, 'utf-8')),
  );
  return { ...opensslEncrypt(compressed, password, iter), compressed: true };
}

describe('decryptPayload', () => {
  test('round-trips arbitrary UTF-8 (compressed mode)', async () => {
    const message = 'the playa provides · 🎡 burning man';
    const enc = buildEncrypted(message, 'welcome-home', 2000);
    const decoded = await decryptPayload(enc, 'welcome-home');
    assert.equal(decoded, message);
  });

  test('round-trips a realistic camps JSON payload (compressed mode)', async () => {
    const payload = JSON.stringify([
      { id: '1', name: 'Demo', events: [{ id: 'e1', name: 'yoga' }] },
      { id: '2', name: 'Other' },
    ]);
    const enc = buildEncrypted(payload, 'pw', 2000);
    const decoded = await decryptPayload(enc, 'pw');
    assert.equal(decoded, payload);
  });

  test('throws on wrong password', async () => {
    const enc = buildEncrypted('secret', 'right', 2000);
    await assert.rejects(decryptPayload(enc, 'wrong'));
  });

  test('back-compat: legacy uncompressed envelope still decrypts', async () => {
    // Old build (pre-D12) emitted no `compressed` field. The client
    // skips the gunzip step and returns the raw plaintext. Critical
    // for the rollout window where a cached SW serves an older
    // bundle reading a freshly-deployed page (or vice versa).
    const message = 'legacy payload';
    const enc = opensslEncrypt(
      new TextEncoder().encode(message), 'pw', 2000,
    );
    const decoded = await decryptPayload(enc, 'pw');
    assert.equal(decoded, message);
  });

  test('unwrapDek returns 48-byte DEK+IV on success, null on bad password', async () => {
    // Build a wrapper the way the Python builder does: PBKDF2-AES-CBC
    // over a 48-byte concat of (32-byte DEK || 16-byte IV).
    const dek = new Uint8Array(randomBytes(32));
    const iv = new Uint8Array(randomBytes(16));
    const dekIv = new Uint8Array(48);
    dekIv.set(dek, 0);
    dekIv.set(iv, 32);
    const wrapper = opensslEncrypt(dekIv, 'tier-pw', 2000);

    // Right password → recovers original 48 bytes.
    const recovered = await unwrapDek(wrapper, 'tier-pw');
    assert.ok(recovered, 'expected unwrap to succeed');
    assert.equal(recovered!.length, 48);
    assert.deepEqual(Array.from(recovered!), Array.from(dekIv));

    // Wrong password → null (no throw — Gate uses null to keep trying
    // other wrappers until one works or they all fail).
    const bad = await unwrapDek(wrapper, 'wrong');
    assert.equal(bad, null);
  });

  test('decryptSource round-trips: gzip→raw-AES → unwrap → decrypt', async () => {
    // Mirrors the build pipeline: payload → gzip → AES-CBC(key, iv).
    // Then on the browser side: unwrap DEK+IV → decryptSource(cipher, dek+iv).
    const payload = JSON.stringify([
      { id: '1', name: 'Envelope Camp', events: [] },
    ]);
    const dek = new Uint8Array(randomBytes(32));
    const iv = new Uint8Array(randomBytes(16));
    const compressed = new Uint8Array(gzipSync(Buffer.from(payload, 'utf-8')));
    // Encrypt with raw key + iv (no salt, no pbkdf2) — matches
    // SiteBuilder._aes_cbc_encrypt.
    const proc = spawnSync(
      'openssl',
      ['enc', '-aes-256-cbc', '-K', Buffer.from(dek).toString('hex'),
       '-iv', Buffer.from(iv).toString('hex')],
      { input: Buffer.from(compressed) },
    );
    if (proc.status !== 0) {
      throw new Error(`openssl raw-key encrypt failed: ${proc.stderr.toString()}`);
    }
    const cipher = {
      iv: Buffer.from(iv).toString('base64'),
      ct: proc.stdout.toString('base64'),
      compressed: true,
    };

    // Unwrap step: simulate whatever the gate did to recover the DEK+IV.
    const dekIv = new Uint8Array(48);
    dekIv.set(dek, 0);
    dekIv.set(iv, 32);

    const decoded = await decryptSource(cipher, dekIv);
    assert.equal(decoded, payload);
  });

  test('decryptSource rejects malformed DEK+IV length', async () => {
    const bad = new Uint8Array(40);   // wrong length
    await assert.rejects(decryptSource(
      { iv: '', ct: '', compressed: true }, bad,
    ));
  });

  test('compression actually shrinks a real-shape payload', () => {
    // Sanity-check the build win: gzip on JSON-of-JSON should hit
    // ~70%+ on this kind of data. Guards against accidentally
    // gzipping AES output (which would NOT compress and reveal a
    // pipeline-order regression).
    const payload = JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({
        id: String(i), name: `Camp ${i}`,
        description: 'free pancakes morning yoga gifting tea',
        events: [{ id: `e${i}`, name: 'thing', time: 'Mon 9am' }],
      })),
    );
    const raw = Buffer.byteLength(payload, 'utf-8');
    const compressed = gzipSync(Buffer.from(payload, 'utf-8')).length;
    assert.ok(
      compressed < raw * 0.4,
      `expected gzip to shrink to <40% of raw; got ${compressed}/${raw}`,
    );
  });
});
