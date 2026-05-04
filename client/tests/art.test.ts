// Tests for the art client surface: ingest (plain mode), search
// haystack indexing, and embargo masking.
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { installDom, teardownDom } from './_dom';
import {
  readEmbeddedArt, indexArtHaystacks, artHaystackOf,
} from '../src/data';
import { applyArtLocationEmbargo } from '../src/utils/embargo';
import type { Art } from '../src/types';

beforeEach(() => { installDom(); });
afterEach(() => { teardownDom(); });

function mkArt(over: Partial<Art> = {}): Art {
  return {
    id: 'a1', name: 'Sky Portal', location: '1:44 6400\', Open Playa',
    description: 'A meditative dome.', url: '',
    artist: 'Jane Doe', hometown: 'Reno, NV',
    category: 'Sculpture', program: 'Honorarium',
    image_url: '', year: 2026, tags: ['interactive_art'],
    ...over,
  };
}

function gzipBase64(payload: unknown): string {
  return gzipSync(Buffer.from(JSON.stringify(payload), 'utf-8'))
    .toString('base64');
}

describe('readEmbeddedArt', () => {
  test('reads plain gzip+base64 from art-data-<source>', async () => {
    const s = document.createElement('script');
    s.id = 'art-data-directory';
    s.setAttribute('type', 'application/x-gzip-base64');
    s.textContent = gzipBase64([mkArt()]);
    document.body.appendChild(s);

    const p = await readEmbeddedArt('directory');
    assert.equal(p.kind, 'plain');
    if (p.kind === 'plain') {
      assert.equal(p.art.length, 1);
      assert.equal(p.art[0].name, 'Sky Portal');
    }
  });

  test('returns empty plain when no art script is present', async () => {
    // No tier-wrappers manifest, no art-data script — fallback path.
    const p = await readEmbeddedArt('directory');
    assert.equal(p.kind, 'plain');
    if (p.kind === 'plain') assert.equal(p.art.length, 0);
  });

  test('signals envelope mode when bm-tier-wrappers is present', async () => {
    const m = document.createElement('meta');
    m.setAttribute('name', 'bm-tier-wrappers');
    m.setAttribute('content', 'directory:0');
    document.head.appendChild(m);
    const p = await readEmbeddedArt('directory');
    assert.equal(p.kind, 'envelope');
  });
});

describe('indexArtHaystacks', () => {
  test('haystack includes name + artist + category + program + tags', () => {
    const art = [mkArt({
      name: 'Burning Bird',
      artist: 'Jane Doe',
      category: 'Sculpture',
      program: 'Honorarium',
      description: 'A flame piece',
      tags: ['fire', 'interactive_art'],
    })];
    indexArtHaystacks(art);
    const hay = artHaystackOf(art[0]);
    for (const w of [
      'burning bird', 'jane doe', 'sculpture', 'honorarium',
      'a flame piece', 'fire', 'interactive_art',
    ]) {
      assert.ok(hay.includes(w), `expected haystack to contain "${w}"`);
    }
  });
});

describe('applyArtLocationEmbargo', () => {
  const BURN = '2026-08-30';
  test('clears location pre-burn for current-year API source', () => {
    const art = [mkArt({ id: '1', location: '6:00 & A' })];
    const out = applyArtLocationEmbargo(
      art, 'api-2026', BURN, new Date('2026-04-30T00:00:00Z'),
    );
    assert.equal(out[0].location, '');
    // Other fields preserved.
    assert.equal(out[0].name, 'Sky Portal');
  });

  test('passes through after burn-start', () => {
    const art = [mkArt({ location: '6:00 & A' })];
    const out = applyArtLocationEmbargo(
      art, 'api-2026', BURN, new Date('2026-09-01T00:00:00Z'),
    );
    assert.equal(out[0].location, '6:00 & A');
    // Same array reference returned (no clone) when embargo inactive.
    assert.equal(out, art);
  });

  test('trusted=true bypasses even pre-burn for current year', () => {
    const art = [mkArt({ location: '6:00 & A' })];
    const out = applyArtLocationEmbargo(
      art, 'api-2026', BURN, new Date('2026-04-30T00:00:00Z'), true,
    );
    assert.equal(out[0].location, '6:00 & A');
    assert.equal(out, art);
  });

  test('directory source: never embargoed', () => {
    const art = [mkArt({ location: '6:00 & A' })];
    const out = applyArtLocationEmbargo(
      art, 'directory', BURN, new Date('2026-04-30T00:00:00Z'),
    );
    assert.equal(out[0].location, '6:00 & A');
  });
});
