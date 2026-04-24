// Unit tests for the nickname → color utility. The hue must be
// deterministic (so the same friend gets the same chip across
// sessions), well-distributed (so common names aren't all in the same
// band), and avoid the warm-orange accent so friend chips don't read
// as "yours".
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { friendHue, friendChipStyle } from '../src/utils/friendColor';

describe('friendHue', () => {
  test('is deterministic: same name → same hue', () => {
    assert.equal(friendHue('Alice'), friendHue('Alice'));
    assert.equal(friendHue('🔥 dusty'), friendHue('🔥 dusty'));
  });

  test('always in [0, 360)', () => {
    for (const n of ['a', 'bob', 'charlie', 'D', '🔥', 'Ålíce', '   ']) {
      const h = friendHue(n);
      assert.ok(h >= 0 && h < 360, `${n} → ${h} out of range`);
    }
  });

  test('never lands inside the orange-accent band (5°–45°)', () => {
    // Try enough names that the raw hash falls into the band for at
    // least some of them — the guard should nudge all of them out.
    for (let i = 0; i < 200; i++) {
      const h = friendHue(`friend-${i}`);
      assert.ok(h < 5 || h >= 45, `friend-${i} landed at ${h} (in band)`);
    }
  });

  test('case-sensitive (Alice vs alice distinct)', () => {
    // They're different string keys in the friends map, so they should
    // read as visually different too.
    assert.notEqual(friendHue('Alice'), friendHue('alice'));
  });
});

describe('friendChipStyle', () => {
  test('returns background + boxShadow as hsla strings', () => {
    const style = friendChipStyle('Alice');
    assert.match(style.background, /^hsla\(\d+(\.\d+)?, 65%, 50%, 0\.2\d*\)$/);
    assert.match(style.boxShadow, /^inset 0 0 0 1px hsla\(\d+(\.\d+)?, 65%, 55%, 0\.5\d*\)$/);
  });

  test('same name → same style (stable across renders)', () => {
    assert.deepEqual(friendChipStyle('Bob'), friendChipStyle('Bob'));
  });

  test('bg + ring share the same hue', () => {
    const s = friendChipStyle('Charlie');
    const h1 = /hsla\((\d+)/.exec(s.background)![1];
    const h2 = /hsla\((\d+)/.exec(s.boxShadow)![1];
    assert.equal(h1, h2);
  });
});
