// Official POIs use the same tap-to-select/detail behavior as legacy map pins.
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { MapView } from '../src/components/MapView';

let mount: HTMLElement;

beforeEach(() => {
  installDom();
  mount = document.createElement('div');
  document.body.appendChild(mount);
  const payload = {
    year: 2026,
    source: 'official fixture',
    points: [
      {
        id: 'center-camp', name: 'Center Camp Plaza',
        kind: 'center-camp', layer: 'base', address: '6:00 & B',
        description: 'The Canopy and Center Camp community hub.',
        lat: 40.777372264, lng: -119.215611561,
      },
      {
        id: 'medical-3', name: 'Medical / ESD — 3:00',
        kind: 'medical', layer: 'base', address: '3:00 & C',
        description: 'Emergency medical, fire, and crisis support.',
        lat: 40.776197815, lng: -119.198981265,
      },
      {
        id: 'ranger-hq', name: 'Ranger HQ', kind: 'ranger', layer: 'base',
        address: '6:35 & Esplanade', description: 'Black Rock Ranger headquarters.',
        lat: 40.7790, lng: -119.2168,
      },
      {
        id: 'temple', name: 'The Temple', kind: 'temple', layer: 'base',
        address: '12:00 open playa', description: 'The Temple.',
        lat: 40.7920, lng: -119.2050,
      },
      {
        id: 'playa-info', name: 'Playa Info', kind: 'playa-info', layer: 'services',
        address: 'Center Camp', description: 'Participant information.',
        lat: 40.7787, lng: -119.2160,
      },
      {
        id: 'ice-center', name: 'Arctica Ice — Center Camp',
        kind: 'ice', layer: 'essentials', address: '6:15 & B',
        description: 'Participant ice sales.',
        lat: 40.778277905, lng: -119.216763038,
      },
      {
        id: 'gate', name: 'Main Gate', kind: 'gate', layer: 'arrival',
        address: 'Gate Road', description: 'Main vehicle entrance.',
        lat: 40.768725267000036, lng: -119.23408814999999,
      },
      {
        id: 'box-office', name: 'Box Office', kind: 'box-office', layer: 'arrival',
        address: 'Outside Main Gate', description: 'Ticket assistance.',
        lat: 40.768226895000055, lng: -119.23567012199999,
      },
      {
        id: 'will-call', name: 'Will Call', kind: 'will-call', layer: 'arrival',
        address: 'Outside Main Gate', description: 'Ticket pickup.',
        lat: 40.768406146000075, lng: -119.23704641499995,
      },
      {
        id: 'bus-depot', name: 'Burner Express Bus Depot',
        kind: 'bus', layer: 'transport', address: '6:00 outer city',
        description: 'Bus arrivals and departures.',
        lat: 40.77335492200007, lng: -119.22271946799998,
      },
      {
        id: 'airport', name: 'Black Rock City Airport',
        kind: 'airport', layer: 'transport', address: '5:00 at the perimeter',
        description: 'BRC Municipal Airport.',
        lat: 40.760545282000066, lng: -119.21010212799996,
      },
    ],
    areas: [{
      id: 'center-camp-plaza', name: 'Center Camp Plaza',
      source_name: 'Center Camp Plaza', kind: 'center-camp', layer: 'base',
      poi_id: 'center-camp',
      polygons: [[[[
        -119.2158, 40.7771,
      ], [
        -119.2152, 40.7771,
      ], [
        -119.2152, 40.7777,
      ], [
        -119.2158, 40.7777,
      ], [
        -119.2158, 40.7771,
      ]]]],
    }],
    toilets: [{
      id: 'toilet-1', name: 'Portable toilets', kind: 'toilet',
      layer: 'toilets', address: 'Official toilet bank',
      description: 'Portable-toilet bank.',
      lat: 40.7799, lng: -119.2143,
      rings: [[
        [-119.2144, 40.7798], [-119.2142, 40.7798],
        [-119.2142, 40.7800], [-119.2144, 40.7798],
      ]],
    }],
  };
  const script = document.createElement('script');
  script.id = 'gis-data-2026';
  script.type = 'application/x-gzip-base64';
  script.textContent = gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64');
  document.body.appendChild(script);
});

afterEach(() => {
  // Unmount BEFORE tearing down the DOM so Preact runs the component's effect
  // cleanups synchronously and trip the readEmbeddedGis `cancelled` guard.
  // Without this,
  // that async activity can resolve/fire after the test ends — once
  // `teardownDom()` has deleted `document` — and throw "document is not
  // defined" as an unhandledRejection (the CI failure this fixes).
  try { render(null, mount); } catch { /* ignore */ }
  teardownDom();
});

function mountMap(
  source = 'directory',
  overrides: Partial<Parameters<typeof MapView>[0]> = {},
) {
  render(h(MapView, {
    camps: [], favCampIds: new Set<string>(), friendFavCampIds: () => [],
    favEventIds: new Set<string>(), friendFavEventIds: () => [],
    art: [], favArtIds: new Set<string>(), friendFavArtIds: () => [],
    myCampId: '', meetSpots: [], onAddMeetSpot: () => {},
    onRemoveMeetSpot: () => {}, friendsRendezvous: [],
    onGotoCamp: () => {}, onGotoArt: () => {},
    onRemoveFriendStar: () => {}, onRemoveFriendMeetSpot: () => {},
    source,
    ...overrides,
  }), mount);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
// Generous budget (~3s): MapView's async GIS load (gzip DecompressionStream +
// render) can run slowly under full-suite CPU contention or on a loaded CI
// runner. A tight budget here was the source of intermittent failures.
async function waitFor<T extends Element>(selector: string): Promise<T | null> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = mount.querySelector<T>(selector);
    if (found) return found;
    await settle();
  }
  return null;
}

describe('<MapView> official POIs', () => {
  test('groups map actions and layers in one control panel', async () => {
    mountMap();
    const panel = await waitFor<HTMLElement>('.map-control-panel');
    assert.ok(panel);
    assert.ok(panel.querySelector('.map-actions'));
    assert.ok(panel.querySelector('.map-layer-bar'));
  });

  test('renders official quarter-hour radials only from the outer city', async () => {
    mountMap();
    const quarter = await waitFor<SVGLineElement>('.radial[data-clock="6:15"]');
    const half = mount.querySelector<SVGLineElement>('.radial[data-clock="6:30"]');
    assert.ok(quarter);
    assert.ok(half);
    assert.equal(quarter.dataset.innerRadius, '4545');
    assert.equal(half.dataset.innerRadius, '2500');
    assert.equal(mount.querySelectorAll('.brc-street.radial').length, 33);
  });

  test('keeps cardinal hour labels inside the compact mobile viewBox', async () => {
    mountMap();
    const svg = await waitFor<SVGSVGElement>('.brc-svg');
    assert.ok(svg);
    const [vbX, vbY, vbWidth, vbHeight] = (svg.getAttribute('viewBox') ?? '')
      .split(' ').map(Number);
    for (const hour of [3, 6, 9]) {
      const label = mount.querySelector<SVGTextElement>(`[data-hour-label="${hour}"]`);
      assert.ok(label);
      const x = Number(label.getAttribute('x'));
      const y = Number(label.getAttribute('y'));
      assert.ok(x > vbX && x < vbX + vbWidth, `${hour}:00 x=${x} outside viewBox`);
      assert.ok(y > vbY && y < vbY + vbHeight, `${hour}:00 y=${y} outside viewBox`);
    }
  });

  test('renders The Man as an effigy centered on the Golden Spike', async () => {
    mountMap();
    const effigy = await waitFor<SVGGElement>('.brc-man[data-map-anchor="golden-spike"]');
    assert.ok(effigy);
    assert.ok(effigy.querySelector('.brc-man-head'));
    assert.ok(effigy.querySelector('.brc-man-body'));
    assert.ok(effigy.querySelector('.brc-man-limbs'));
    assert.ok(effigy.querySelector('.brc-man-limbs-outline'));
    assert.equal(effigy.getAttribute('transform'), null);
    assert.match(effigy.textContent ?? '', /Golden Spike map origin/);
  });

  test('projects Center Camp and its Arctica onto the 6:00 side', async () => {
    mountMap();
    const center = await waitFor<SVGGElement>('.brc-poi-center-camp');
    const ice = await waitFor<SVGGElement>('[aria-label^="Arctica Ice — Center Camp"]');
    assert.ok(center);
    assert.ok(ice);
    const yOf = (node: Element) => Number(
      node.getAttribute('transform')?.match(/translate\([^ ]+ ([-\d.]+)\)/)?.[1],
    );
    assert.ok(yOf(center) > 0, 'Center Camp Plaza must render below the Man');
    assert.ok(yOf(ice) > 0, 'Center Camp Arctica must render below the Man');
    assert.equal(mount.querySelectorAll('.brc-poi-center-camp').length, 1);
    // Critical POIs must retain independent shape cues at overview zoom.
    // This stays in the already-settled GIS test so async payload loading
    // cannot leave a standalone marker test waiting on an unref'd DOM timer.
    const ranger = mount.querySelector<SVGGElement>('.brc-poi-ranger');
    const temple = mount.querySelector<SVGGElement>('.brc-poi-temple');
    const info = mount.querySelector<SVGGElement>('.brc-poi-playa-info');
    assert.equal(ranger?.dataset.markerShape, 'shield');
    assert.equal(ranger?.querySelector('.brc-poi-glyph')?.textContent, 'R');
    assert.equal(temple?.dataset.markerShape, 'diamond');
    assert.equal(ice?.dataset.markerShape, 'hexagon');
    assert.equal(info?.dataset.markerShape, 'square');
    assert.notEqual(
      ranger?.querySelector('.brc-poi-dot')?.getAttribute('d'),
      temple?.querySelector('.brc-poi-dot')?.getAttribute('d'),
    );
  });

  test('uses distinct silhouettes for favorites, home, art, and rendezvous', async () => {
    const camp = {
      id: 'camp-favorite', name: 'Favorite Camp', location: '7:30 & E',
      description: '', website: '', url: '', tags: [], events: [],
    };
    const home = { ...camp, id: 'home', name: 'Home Camp', location: '6:00 & G' };
    const art = {
      id: 'art-1', name: 'Favorite Art', location: "8:00 4000', Open Playa",
      description: '', url: '', artist: '', hometown: '', category: '',
      program: '', image_url: '', year: 2026, tags: [],
    };
    mountMap('directory', {
      camps: [camp, home],
      favCampIds: new Set([camp.id, home.id]),
      myCampId: home.id,
      meetSpots: [{ label: 'Rendezvous', address: '5:30 & C' }],
      art: [art],
      favArtIds: new Set([art.id]),
    });
    assert.ok(await waitFor('.brc-pin .brc-pin-inner'));
    assert.ok(mount.querySelector('.brc-pin .brc-pin-glyph'));
    assert.ok(mount.querySelector('.brc-my-camp .brc-my-camp-body'));
    assert.ok(mount.querySelector('.brc-my-camp .brc-tent-detail'));
    assert.ok(mount.querySelector('.brc-art-pin .brc-art-pin-body'));
    assert.ok(mount.querySelector('.brc-meet .brc-meet-dot'));
    assert.ok(mount.querySelector('.brc-meet .brc-meet-center'));
    // The starred home camp remains in the list but only the tent is drawn.
    assert.equal(mount.querySelectorAll('.brc-pin').length, 1);
  });

  test('renders the official Center Camp footprint and delegates taps to its POI', async () => {
    mountMap();
    const area = await waitFor<SVGPathElement>('.brc-map-area-center-camp');
    assert.ok(area);
    assert.match(area.getAttribute('d') ?? '', /^M[-\d.]+,[-\d.]+/);
    area.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    assert.match(
      mount.querySelector('.map-meet-row.active')?.textContent ?? '',
      /Center Camp Plaza/,
    );
    assert.ok(area.classList.contains('active'));
  });

  test('tap shows the POI label, details, and external navigation link', async () => {
    mountMap();
    const marker = await waitFor<SVGGElement>('.brc-poi-medical');
    assert.ok(marker);
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    const activeRow = mount.querySelector('.map-meet-row.active');
    assert.match(activeRow?.textContent ?? '', /Medical \/ ESD — 3:00/);
    assert.match(activeRow?.textContent ?? '', /Emergency medical/);
    assert.ok(activeRow?.querySelector('a[href^="https://www.google.com/maps?q="]'));
    assert.match(
      mount.querySelector('.brc-address-title')?.textContent ?? '',
      /Medical \/ ESD — 3:00/,
    );
  });

  test('GPS navigation uses an arrowed guide with an explained endpoint', async () => {
    location.href = 'http://localhost/?gps=40.794905,-119.210158#map';
    mountMap();
    const marker = await waitFor<SVGGElement>('.brc-poi-ranger');
    assert.ok(marker);
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    const guide = mount.querySelector<SVGGElement>('.brc-bearing-guide');
    assert.ok(guide);
    assert.ok(guide.querySelector('.brc-bearing'));
    assert.ok(guide.querySelector('.brc-bearing-arrow'));
    assert.match(guide.textContent ?? '', /Your GPS position to Ranger HQ/);
    assert.match(
      mount.querySelector('.map-meet-row.active')?.textContent ?? '',
      /dashed map arrow points from your GPS position to this location/,
    );
  });

  test('toilets have a dedicated default-off persisted layer', async () => {
    mountMap();
    await waitFor('.map-layer-toggle');
    assert.equal(mount.querySelector('[aria-label^="Portable toilets"]'), null);
    const toilets = [...mount.querySelectorAll<HTMLButtonElement>('.map-layer-toggle')]
      .find((button) => button.textContent?.includes('Toilets'));
    assert.ok(toilets);
    assert.equal(toilets.getAttribute('aria-pressed'), 'false');
    toilets.click();
    // Wait for the toilet markers to actually render (async GIS load) rather
    // than a fixed settle, which races under load.
    assert.ok(await waitFor('[aria-label^="Portable toilets"]'), 'toilet markers render');
    const updated = [...mount.querySelectorAll<HTMLButtonElement>('.map-layer-toggle')]
      .find((button) => button.textContent?.includes('Toilets'));
    assert.equal(updated?.getAttribute('aria-pressed'), 'true');
    assert.equal(localStorage.getItem('bm-map-layers/v1'), '["essentials","toilets"]');
  });

  test('keeps the boundary default-off and expands only while enabled', async () => {
    mountMap();
    const svg = await waitFor<SVGSVGElement>('.brc-svg');
    assert.ok(svg);
    const compact = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    assert.equal(compact.length, 4);
    assert.ok(compact[2] < 16000, `unexpectedly wide default viewBox: ${compact[2]}`);
    assert.equal(mount.querySelector('.brc-trash-fence'), null);

    const boundary = [...mount.querySelectorAll<HTMLButtonElement>('.map-layer-toggle')]
      .find((button) => button.textContent?.includes('Boundary'));
    assert.ok(boundary);
    assert.equal(boundary.getAttribute('aria-pressed'), 'false');
    boundary.click();
    await settle();

    const expanded = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    assert.ok(expanded[2] > 16000, `boundary did not expand viewBox: ${expanded[2]}`);
    assert.ok(mount.querySelector('.brc-trash-fence'));
    assert.match(svg.getAttribute('style') ?? '', /aspect-ratio:/);
  });

  test('fits arrival POIs only while their layer is enabled', async () => {
    mountMap();
    const svg = await waitFor<SVGSVGElement>('.brc-svg');
    assert.ok(svg);
    // Wait for the GIS payload to render (a base medical marker) so the
    // baseline viewBox is stable before toggling — the async load must not
    // race the assertion under full-suite load.
    assert.ok(await waitFor('.brc-poi-medical'), 'gis loaded');
    const arrival = [...mount.querySelectorAll<HTMLButtonElement>('.map-layer-toggle')]
      .find((button) => button.textContent?.includes('Arrival'));
    assert.ok(arrival);
    const compact = Number((svg.getAttribute('viewBox') ?? '').split(' ')[2]);
    arrival.click();
    assert.ok(await waitFor('.brc-poi-gate'), 'gate marker rendered');
    const fitted = Number((svg.getAttribute('viewBox') ?? '').split(' ')[2]);
    assert.ok(fitted > compact, `arrival layer did not fit: ${compact} → ${fitted}`);
    assert.ok(mount.querySelector('.brc-poi-box-office'));

    arrival.click();
    await settle();
    const restored = Number((svg.getAttribute('viewBox') ?? '').split(' ')[2]);
    assert.equal(restored, compact);
    assert.equal(mount.querySelector('.brc-poi-gate'), null);
  });

  test('fits transport POIs while enabled', async () => {
    mountMap();
    const svg = await waitFor<SVGSVGElement>('.brc-svg');
    assert.ok(svg);
    assert.ok(await waitFor('.brc-poi-medical'), 'gis loaded');
    const transport = [...mount.querySelectorAll<HTMLButtonElement>('.map-layer-toggle')]
      .find((button) => button.textContent?.includes('Transport'));
    assert.ok(transport);
    const compact = Number((svg.getAttribute('viewBox') ?? '').split(' ')[2]);
    transport.click();
    assert.ok(await waitFor('.brc-poi-bus'), 'bus marker rendered');
    const fitted = Number((svg.getAttribute('viewBox') ?? '').split(' ')[2]);
    assert.ok(fitted > compact, `transport layer did not fit: ${compact} → ${fitted}`);
    assert.ok(mount.querySelector('.brc-poi-airport'));
  });

  test('overlapping POI hit areas select the visible nearest marker', async () => {
    mountMap();
    const svg = await waitFor<SVGSVGElement>('.brc-svg');
    assert.ok(svg);
    const arrival = [...mount.querySelectorAll<HTMLButtonElement>('.map-layer-toggle')]
      .find((button) => button.textContent?.includes('Arrival'));
    arrival?.click();
    await settle();

    const gate = mount.querySelector<SVGGElement>('.brc-poi-gate');
    const boxOffice = mount.querySelector<SVGGElement>('.brc-poi-box-office');
    assert.ok(gate);
    assert.ok(boxOffice);
    const viewBox = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    const gatePoint = (gate.getAttribute('transform')?.match(
      /translate\(([-\d.]+) ([-\d.]+)\)/,
    ) ?? []).slice(1).map(Number);
    assert.equal(gatePoint.length, 2);
    const width = 1000;
    const scale = width / viewBox[2];
    const height = viewBox[3] * scale;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0, y: 0, left: 0, top: 0, right: width, bottom: height,
        width, height, toJSON: () => ({}),
      }),
    });
    const clientX = (gatePoint[0] - viewBox[0]) * scale;
    const clientY = (gatePoint[1] - viewBox[1]) * scale;

    // Simulate Box Office's later-rendered transparent hit target receiving a
    // tap whose actual screen position is centered on the orange Gate marker.
    boxOffice.dispatchEvent(new MouseEvent('click', {
      bubbles: true, clientX, clientY,
    }));
    await settle();
    assert.match(mount.querySelector('.map-meet-row.active')?.textContent ?? '', /Main Gate/);
  });

  test('renders exact current and previous-year geometry independently', async () => {
    mountMap('api-2025');
    assert.match(mount.querySelector('.map-title')?.textContent ?? '', /2025/);
    assert.ok(await waitFor('.brc-svg'));

    mountMap('api-2026');
    await settle();
    assert.match(mount.querySelector('.map-title')?.textContent ?? '', /2026/);
    assert.ok(mount.querySelector('.brc-svg'));
  });

  test('renders a released api-2026 camp location on 2026 geometry', async () => {
    const releasedCamp = {
      id: 'released-2026-camp', name: 'Future Location Camp',
      location: '6:00 & E', description: '', website: '', url: '', tags: [], events: [],
    };
    mountMap('api-2026', {
      camps: [releasedCamp],
      favCampIds: new Set([releasedCamp.id]),
    });
    const marker = await waitFor<SVGGElement>('.brc-pin.mine');
    assert.ok(marker, 'a newly released API location should create a map marker');
    assert.match(marker.textContent ?? '', /Future Location Camp/);
    assert.match(marker.textContent ?? '', /6:00 & E/);
    assert.match(mount.querySelector('.map-title')?.textContent ?? '', /2026/);
  });

  test('keeps the app usable but does not render borrowed future geometry', async () => {
    mountMap('api-2027');
    await settle();
    assert.match(
      mount.querySelector('.map-geometry-unavailable')?.textContent ?? '',
      /Map not available for 2027 yet/,
    );
    assert.match(
      mount.querySelector('.map-geometry-unavailable')?.textContent ?? '',
      /Camps, events, art, favorites, and schedules still work/,
    );
    assert.equal(mount.querySelector('.brc-svg'), null);
    assert.equal(mount.querySelector('.map-layer-toggle'), null);

    // Switching back to a historical exact year in the same mounted component
    // must recover normally (and, importantly, preserve hook ordering).
    mountMap('api-2025');
    await settle();
    assert.ok(mount.querySelector('.brc-svg'));
    assert.match(mount.querySelector('.map-title')?.textContent ?? '', /2025/);
  });
});
