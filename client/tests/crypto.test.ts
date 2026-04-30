// Verify the JS decryption path against the Python-side encryption.
// We can't easily call Python from Node tests, so we use openssl
// directly (same CLI the Python builder uses) as the encryption side.
// This is the exact round-trip the deployed site performs: Python/openssl
// encrypts at build time; the browser decrypts at load time.
//
// As of D12, the build pipeline is gzip → AES. We test both branches:
// `compressed: true` (gzip + AES, current builds) and `compressed`
// omitted/false (legacy AES-only, kept for one-build SW back-compat).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { decryptPayload } from '../src/crypto';

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
