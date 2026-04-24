// Verifies the BRC address grammar + the polar → lat/lng math lands in
// sensible places. None of these numbers are magic — they're the
// expected output given the 2026 constants in src/map/data.ts. When
// the `/update-map` skill refreshes those constants for a new year,
// these tests should be re-baselined (not deleted).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAddress, addressToLatLng, addressToSvgFeet,
  clockToCompass, haversineMeters, bearingDeg, latLngToSvgFeet,
} from '../src/map/address';
import { BRC } from '../src/map/data';

describe('parseAddress', () => {
  test('parses the common "clock & letter" form', () => {
    const p = parseAddress('7:30 & F');
    assert.ok(p);
    assert.equal(p!.clockHour, 7.5);
    assert.equal(p!.clock, '7:30');
    assert.equal(p!.street, 'F');
  });

  test('parses letter first, then clock', () => {
    const p = parseAddress('F & 7:30');
    assert.ok(p);
    assert.equal(p!.clockHour, 7.5);
    assert.equal(p!.street, 'F');
  });

  test('parses Esplanade addresses', () => {
    const p = parseAddress('Esplanade & 6:00');
    assert.ok(p);
    assert.equal(p!.street, 'Esplanade');
    assert.equal(p!.radiusFeet, BRC.streetRadiiFeet[0]);
  });

  test('accepts 2026 themed street names', () => {
    // Ararat == A; Kundalini == K
    const a = parseAddress('Ararat & 3:00');
    assert.equal(a?.street, 'A');
    const k = parseAddress('10:00 & Kundalini');
    assert.equal(k?.street, 'K');
  });

  test('handles &/and and odd whitespace', () => {
    assert.ok(parseAddress('4:30  and  B'));
    assert.ok(parseAddress('4:30 AND B'));
    assert.ok(parseAddress('  5:00  &  C  '));
  });

  test('returns null for missing / placeholder addresses', () => {
    assert.equal(parseAddress(''), null);
    assert.equal(parseAddress('-'), null);
    assert.equal(parseAddress('None Listed'), null);
    assert.equal(parseAddress('none listed'), null);
  });

  test('returns null for nonsense', () => {
    assert.equal(parseAddress('25:99 & Z'), null);
    assert.equal(parseAddress('7:30'), null);
    assert.equal(parseAddress('just words'), null);
  });
});

describe('clockToCompass', () => {
  test('12:00 returns the year-specific base bearing', () => {
    assert.equal(clockToCompass(12), BRC.twelveBearingDeg);
  });

  test('every hour rotates 30° clockwise', () => {
    // 3:00 = 12:00 + 3 * 30°, wrapping mod 360
    const three = clockToCompass(3);
    assert.equal(three, (BRC.twelveBearingDeg + 90) % 360);
    const six = clockToCompass(6);
    assert.equal(six, (BRC.twelveBearingDeg + 180) % 360);
  });

  test('for 2026 specifically: BRC 6:00 points NE (≈45°)', () => {
    // Open side of the city faces northeast. 6:00 = 225 + 180 = 405 mod 360 = 45.
    assert.equal(clockToCompass(6), 45);
  });
});

describe('addressToLatLng', () => {
  test('returns null for unparseable addresses', () => {
    assert.equal(addressToLatLng(''), null);
  });

  test('lands within ~0.5 miles of the Man for inner streets', () => {
    // Esplanade is 2500 ft (~762m) from the Man on any clock.
    const out = addressToLatLng('6:00 & Esplanade')!;
    const meters = haversineMeters(BRC.center, out);
    // ~760m, allow ±50m slack for floating point.
    assert.ok(meters > 700 && meters < 820,
      `esplanade should be ~762m from Man, got ${meters}`);
  });

  test('lands ~1 mile (5400ft=1645m) from the Man at K street', () => {
    const out = addressToLatLng('6:00 & K')!;
    const meters = haversineMeters(BRC.center, out);
    assert.ok(meters > 1600 && meters < 1700,
      `K street should be ~1645m from Man, got ${meters}`);
  });

  test('round-trip: compute bearing from Man to a camp, then back-reverse it', () => {
    const out = addressToLatLng('3:00 & F')!;
    const bearingFromMan = bearingDeg(BRC.center, out);
    // 3:00 bearing = 12:00 bearing + 90° mod 360
    const expected = (BRC.twelveBearingDeg + 90) % 360;
    // Allow ±0.5° due to spherical trig
    assert.ok(Math.abs(((bearingFromMan - expected + 540) % 360) - 180) < 0.5);
  });
});

describe('SVG projection', () => {
  test('addressToSvgFeet puts 12:00 at positive-y (up) coordinates', () => {
    // In SVG coords, negative y = up. Verify via known quadrants.
    // 3:00 → clockwise one-quarter from up → (+x, 0) direction
    const three = addressToSvgFeet('3:00 & Esplanade')!;
    assert.ok(three.x > 0 && Math.abs(three.y) < 100,
      `3:00 should point +x, got ${JSON.stringify(three)}`);
    const six = addressToSvgFeet('6:00 & Esplanade')!;
    assert.ok(Math.abs(six.x) < 100 && six.y > 0,
      `6:00 should point +y, got ${JSON.stringify(six)}`);
  });

  test('latLngToSvgFeet(center) returns origin', () => {
    const p = latLngToSvgFeet(BRC.center);
    assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1);
  });

  test('GPS round-trip: address → latLng → SVG matches direct SVG computation', () => {
    // addressToSvgFeet(addr) and latLngToSvgFeet(addressToLatLng(addr))
    // should agree to within a few feet (spherical trig vs flat polar).
    for (const addr of ['3:00 & F', '7:30 & B', '10:00 & K']) {
      const direct = addressToSvgFeet(addr)!;
      const indirect = latLngToSvgFeet(addressToLatLng(addr)!);
      const dx = direct.x - indirect.x;
      const dy = direct.y - indirect.y;
      const dist = Math.hypot(dx, dy);
      assert.ok(dist < 20,
        `${addr}: direct (${direct.x.toFixed(0)}, ${direct.y.toFixed(0)}) vs indirect (${indirect.x.toFixed(0)}, ${indirect.y.toFixed(0)}) — off by ${dist.toFixed(1)} ft`);
    }
  });
});
