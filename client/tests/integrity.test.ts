import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, matchesSha256 } from '../src/assistant/integrity';

// Known-answer: SHA-256 of the ASCII bytes "abc".
const ABC = new TextEncoder().encode('abc').buffer;
const ABC_SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('asset integrity pins (ADR 21 D6)', () => {
  test('sha256Hex matches a known vector', async () => {
    assert.equal(await sha256Hex(ABC), ABC_SHA);
  });

  test('matchesSha256 accepts the pinned hash (case-insensitive)', async () => {
    assert.equal(await matchesSha256(ABC, ABC_SHA), true);
    assert.equal(await matchesSha256(ABC, ABC_SHA.toUpperCase()), true);
  });

  test('matchesSha256 rejects tampered bytes (fail closed)', async () => {
    const tampered = new TextEncoder().encode('abd').buffer;
    assert.equal(await matchesSha256(tampered, ABC_SHA), false);
  });
});
