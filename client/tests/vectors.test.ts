import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { quantizeToInt8, decodeVectors } from '../src/assistant/vectors';

function b64(bytes: Int8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

describe('semantic vector (de)quantization (ADR 21)', () => {
  test('quantize clamps to int8 range', () => {
    // Math.round is half-toward-+∞, so -0.5×127 = -63.5 → -63.
    const q = quantizeToInt8([0, 1, -1, 0.5, -0.5, 2, -2]);
    assert.deepEqual(Array.from(q), [0, 127, -127, 64, -63, 127, -128]);
  });

  test('round-trips a unit vector within quantization error', () => {
    const orig = [0.1, -0.2, 0.9, -0.9, 0];
    const q = quantizeToInt8(orig);
    const [decoded] = decodeVectors(b64(q), orig.length, 1);
    for (let i = 0; i < orig.length; i++) {
      assert.ok(Math.abs(decoded[i] - orig[i]) <= 1 / 127 + 1e-9, `component ${i}`);
    }
  });

  test('decodes multiple concatenated rows in order', () => {
    const a = quantizeToInt8([1, 0]);
    const b = quantizeToInt8([0, -1]);
    const merged = new Int8Array([...a, ...b]);
    const rows = decodeVectors(b64(merged), 2, 2);
    assert.equal(rows.length, 2);
    assert.deepEqual(Array.from(rows[0]), [1, 0]);
    assert.deepEqual(Array.from(rows[1]), [0, -1]);
  });
});
