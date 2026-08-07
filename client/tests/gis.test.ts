// Year-keyed official GIS payload ingestion and presentation metadata.
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { installDom, teardownDom } from './_dom';
import {
  DEFAULT_MAP_LAYERS,
  POI_COLORS,
  isPoiVisible,
  poiColor,
  poiGlyph,
  poiShape,
  readEmbeddedGis,
  validateGis,
} from '../src/map/gis';
import type { BrcPOI, PoiKind } from '../src/map/data';

beforeEach(() => { installDom(); });
afterEach(() => { teardownDom(); });

function point(over: Partial<BrcPOI> = {}): BrcPOI {
  return {
    id: 'medical-3', name: 'Medical / ESD — 3:00',
    kind: 'medical', layer: 'base', lat: 40.78, lng: -119.20,
    ...over,
  };
}

describe('official GIS map metadata', () => {
  test('assigns every POI kind a unique valid color', () => {
    const kinds: PoiKind[] = [
      'center-camp', 'playa-info', 'plaza', 'other', 'medical', 'ranger',
      'ice', 'temple', 'toilet', 'info', 'art-services', 'recycle', 'bike',
      'bus', 'airport', 'dmv', 'media', 'greeters', 'gate', 'box-office',
      'will-call',
    ];
    assert.deepEqual(Object.keys(POI_COLORS).sort(), [...kinds].sort());
    const colors = kinds.map(poiColor);
    assert.equal(new Set(colors).size, kinds.length);
    for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/);
    assert.notEqual(poiColor('ranger'), poiColor('temple'));
  });

  test('base points stay visible while optional points follow toggles', () => {
    assert.equal(isPoiVisible(point(), new Set()), true);
    assert.equal(isPoiVisible(point({ layer: 'essentials' }), new Set()), false);
    assert.equal(
      isPoiVisible(point({ layer: 'essentials' }), DEFAULT_MAP_LAYERS),
      true,
    );
    assert.equal(isPoiVisible(point({ layer: 'toilets' }), DEFAULT_MAP_LAYERS), false);
  });

  test('critical and service kinds use non-color glyph distinctions', () => {
    assert.equal(poiGlyph('medical'), '✚');
    assert.equal(poiGlyph('ranger'), 'R');
    assert.equal(poiGlyph('toilet'), 'WC');
    assert.notEqual(poiColor('medical'), poiColor('ranger'));
    assert.notEqual(poiShape('ranger'), poiShape('temple'));
    assert.notEqual(poiShape('playa-info'), poiShape('ice'));
    assert.notEqual(poiShape('medical'), poiShape('ranger'));
  });

  test('wrong-year and malformed payloads fail closed', () => {
    assert.equal(validateGis({ year: 2025, points: [], toilets: [] }, 2026).year, 2026);
    const value = validateGis({
      year: 2026,
      source: 'official',
      points: [point(), { id: 'bad' }],
      areas: [{
        id: 'center-camp-plaza', name: 'Center Camp Plaza',
        kind: 'center-camp', layer: 'base', poi_id: 'center-camp',
        polygons: [[[
          [-119.216, 40.777], [-119.215, 40.777], [-119.216, 40.778],
        ]]],
      }, { id: 'bad-area' }],
      toilets: [],
    }, 2026);
    assert.deepEqual(value.points.map((item) => item.id), ['medical-3']);
    assert.deepEqual(value.areas.map((item) => item.id), ['center-camp-plaza']);
  });

  test('canonicalizes toilets into their dedicated default-off layer', () => {
    const value = validateGis({
      year: 2026,
      source: 'older normalized cache',
      points: [],
      toilets: [{
        ...point({ id: 'toilet-1', kind: 'toilet', layer: 'essentials' }),
        rings: [[[-119.2, 40.78]]],
      }],
    }, 2026);
    assert.equal(value.toilets[0].layer, 'toilets');
    assert.equal(isPoiVisible(value.toilets[0], DEFAULT_MAP_LAYERS), false);
  });
});

describe('readEmbeddedGis', () => {
  test('reads the matching year gzip payload without a runtime fetch', async () => {
    const payload = {
      year: 2026,
      source: 'official',
      points: [point()],
      areas: [],
      toilets: [],
    };
    const script = document.createElement('script');
    script.id = 'gis-data-2026';
    script.type = 'application/x-gzip-base64';
    script.textContent = gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64');
    document.body.appendChild(script);

    const value = await readEmbeddedGis(2026);
    assert.equal(value.source, 'official');
    assert.equal(value.points[0].name, 'Medical / ESD — 3:00');
  });
});
