// Verify the JS decryption path against the Python-side encryption.
// We can't easily call Python from Node tests, so we use openssl
// directly (same CLI the Python builder uses) as the encryption side.
// This is the exact round-trip the deployed site performs: Python/openssl
// encrypts at build time; the browser decrypts at load time.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

describe('decryptPayload', () => {
  test('round-trips arbitrary UTF-8 against openssl-encrypted input', async () => {
    const message = 'the playa provides · 🎡 burning man';
    const enc = opensslEncrypt(new TextEncoder().encode(message), 'welcome-home', 2000);
    const decoded = await decryptPayload(enc, 'welcome-home');
    assert.equal(decoded, message);
  });

  test('round-trips a realistic camps JSON payload', async () => {
    const payload = JSON.stringify([
      { id: '1', name: 'Demo', events: [{ id: 'e1', name: 'yoga' }] },
      { id: '2', name: 'Other' },
    ]);
    const enc = opensslEncrypt(
      new TextEncoder().encode(payload), 'pw', 2000,
    );
    const decoded = await decryptPayload(enc, 'pw');
    assert.equal(decoded, payload);
  });

  test('throws on wrong password', async () => {
    const enc = opensslEncrypt(
      new TextEncoder().encode('secret'), 'right', 2000,
    );
    await assert.rejects(decryptPayload(enc, 'wrong'));
  });
});
