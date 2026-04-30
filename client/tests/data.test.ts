// Reading the embedded payload. Covers both shapes (plaintext +
// encrypted envelope) and the haystack index for fast substring search.
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { installDom, teardownDom } from './_dom';
import { readEmbeddedPayload, indexHaystacks, haystackOf } from '../src/data';
import type { Camp } from '../src/types';

beforeEach(() => { installDom(); });
afterEach(() => { teardownDom(); });

function mkCamp(over: Partial<Camp> = {}): Camp {
  return {
    id: '1', name: 'Demo Camp', location: '4:00 & B',
    description: 'free pancakes and yoga',
    website: 'https://example.com', url: 'https://d/c/1/',
    tags: ['food', 'yoga'], events: [],
    ...over,
  };
}

/** Mirrors the Python builder's plaintext path: gzip + base64 inside
 *  `<script type="application/x-gzip-base64">`. ADR D12. */
function gzipBase64(payload: unknown): string {
  return gzipSync(Buffer.from(JSON.stringify(payload), 'utf-8'))
    .toString('base64');
}

describe('readEmbeddedPayload', () => {
  test('reads plaintext gzip+base64 when #camps-data is present', async () => {
    const s = document.createElement('script');
    s.id = 'camps-data';
    s.setAttribute('type', 'application/x-gzip-base64');
    s.textContent = gzipBase64([mkCamp()]);
    document.body.appendChild(s);

    const p = await readEmbeddedPayload();
    assert.equal(p.kind, 'plain');
    if (p.kind === 'plain') {
      assert.equal(p.camps.length, 1);
      assert.equal(p.camps[0].name, 'Demo Camp');
    }
  });

  test('back-compat: legacy raw-JSON #camps-data still parses', async () => {
    // Pre-D12 plaintext builds embedded JSON directly. A cached SW
    // serving an older bundle against a newer page (or vice-versa)
    // would trip the new code path; the type-attribute fallback
    // keeps that working.
    const s = document.createElement('script');
    s.id = 'camps-data';
    s.type = 'application/json';
    s.textContent = JSON.stringify([mkCamp({ name: 'Legacy' })]);
    document.body.appendChild(s);

    const p = await readEmbeddedPayload();
    assert.equal(p.kind, 'plain');
    if (p.kind === 'plain') {
      assert.equal(p.camps[0].name, 'Legacy');
    }
  });

  test('reads encrypted envelope when #camps-data-encrypted is present', async () => {
    const s = document.createElement('script');
    s.id = 'camps-data-encrypted';
    s.type = 'application/json';
    s.textContent = JSON.stringify({ salt: 'AAAA', iter: 1000, ct: 'BBBB' });
    document.body.appendChild(s);

    const p = await readEmbeddedPayload();
    assert.equal(p.kind, 'encrypted');
    if (p.kind === 'encrypted') {
      assert.equal(p.enc.iter, 1000);
      assert.equal(p.enc.salt, 'AAAA');
    }
  });

  test('throws when neither script is in the page', async () => {
    await assert.rejects(readEmbeddedPayload(), /No camps data/);
  });
});

describe('indexHaystacks', () => {
  test('includes name, location, description, tags, and events in the haystack', () => {
    const camps = [mkCamp({
      name: 'Zen Tent',
      description: 'breathwork sessions',
      tags: ['yoga'],
      events: [{ id: 'e1', name: 'Vinyasa', description: 'daily',
                  time: '', display_time: '', parsed_time: null }],
    })];
    indexHaystacks(camps);
    const hay = haystackOf(camps[0]);
    for (const w of ['zen tent', 'breathwork', 'yoga', 'vinyasa', 'daily']) {
      assert.ok(hay.includes(w), `expected haystack to contain "${w}"`);
    }
  });

  test('handles camps with no events without crashing', () => {
    const camps = [mkCamp({ events: [] })];
    indexHaystacks(camps);
    assert.ok(haystackOf(camps[0]).includes('demo camp'));
  });
});
