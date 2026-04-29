// Hook tests for useMeetSpots — covers the small CRUD surface +
// the defensive load filter that drops malformed entries (e.g.,
// from a previous app version with a different shape).
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { useMeetSpots, type MeetSpotsApi } from '../src/hooks/useMeetSpots';
import { LS } from '../src/types';

let api: MeetSpotsApi | null = null;
let mountpoint: HTMLElement;

// Tests run with a fixed scoped key — `useMeetSpots` is per-source.
const TEST_KEY = LS.meetSpots + '/directory';

function Harness(): null {
  api = useMeetSpots(TEST_KEY);
  return null;
}

beforeEach(() => {
  installDom();
  try { localStorage.clear(); } catch { /* ignore */ }
  mountpoint = document.createElement('div');
  document.body.appendChild(mountpoint);
  render(h(Harness, {}), mountpoint);
});

afterEach(() => {
  try { render(null, mountpoint); } catch { /* ignore */ }
  api = null;
  teardownDom();
});

function rerender() {
  render(h(Harness, {}), mountpoint);
}

describe('useMeetSpots — basics', () => {
  test('starts with an empty list when no prior data', () => {
    assert.deepEqual(api!.spots, []);
  });

  test('add appends a spot and persists', () => {
    api!.add({ label: 'Coffee', address: '6:00 & C', when: 'Tue 9am' });
    rerender();
    assert.equal(api!.spots.length, 1);
    assert.equal(api!.spots[0].label, 'Coffee');
    assert.equal(api!.spots[0].when, 'Tue 9am');
    const stored = JSON.parse(localStorage.getItem(TEST_KEY) ?? '[]');
    assert.equal(stored.length, 1);
  });

  test('add preserves order across multiple inserts', () => {
    api!.add({ label: 'First', address: '6:00 & A' });
    api!.add({ label: 'Second', address: '7:00 & B' });
    api!.add({ label: 'Third', address: '8:00 & C' });
    rerender();
    assert.deepEqual(api!.spots.map((s) => s.label),
      ['First', 'Second', 'Third']);
  });

  test('removeAt deletes one spot, others stay', () => {
    api!.add({ label: 'A', address: '6:00 & A' });
    api!.add({ label: 'B', address: '7:00 & B' });
    api!.add({ label: 'C', address: '8:00 & C' });
    rerender();
    api!.removeAt(1);   // remove 'B'
    rerender();
    assert.deepEqual(api!.spots.map((s) => s.label), ['A', 'C']);
  });

  test('clear empties the list and persists []', () => {
    api!.add({ label: 'A', address: '6:00 & A' });
    api!.add({ label: 'B', address: '7:00 & B' });
    rerender();
    api!.clear();
    rerender();
    assert.deepEqual(api!.spots, []);
    assert.equal(localStorage.getItem(TEST_KEY), '[]');
  });
});

describe('useMeetSpots — load defensiveness', () => {
  test('legacy garbage in LS results in an empty list, not a crash', () => {
    localStorage.setItem(TEST_KEY, 'not-json{{{');
    const fresh = document.createElement('div');
    document.body.appendChild(fresh);
    render(h(Harness, {}), fresh);
    assert.deepEqual(api!.spots, []);
  });

  test('drops entries missing label or address', () => {
    localStorage.setItem(TEST_KEY, JSON.stringify([
      { label: 'Good', address: '6:00 & C' },
      { label: 'No address' },
      { address: 'No label' },
      'just a string',
      null,
    ]));
    const fresh = document.createElement('div');
    document.body.appendChild(fresh);
    render(h(Harness, {}), fresh);
    assert.equal(api!.spots.length, 1);
    assert.equal(api!.spots[0].label, 'Good');
  });
});

describe('useMeetSpots — multi-tab sync', () => {
  async function flushEffects() {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  test('foreign storage write triggers a re-load', async () => {
    await flushEffects();
    rerender();
    await flushEffects();
    const updated = [
      { label: 'From other tab', address: '9:00 & E', when: 'Wed' },
    ];
    localStorage.setItem(TEST_KEY, JSON.stringify(updated));
    const evt = new (window as unknown as { StorageEvent: typeof StorageEvent }).StorageEvent('storage', {
      key: TEST_KEY,
      newValue: JSON.stringify(updated),
      storageArea: localStorage,
    } as StorageEventInit);
    window.dispatchEvent(evt);
    rerender();
    assert.equal(api!.spots.length, 1);
    assert.equal(api!.spots[0].label, 'From other tab');
  });

  test('unrelated storage events leave state alone', async () => {
    await flushEffects();
    rerender();
    await flushEffects();
    api!.add({ label: 'Local', address: '6:00 & C' });
    rerender();
    const evt = new (window as unknown as { StorageEvent: typeof StorageEvent }).StorageEvent('storage', {
      key: 'some-other-key',
      newValue: 'whatever',
      storageArea: localStorage,
    } as StorageEventInit);
    window.dispatchEvent(evt);
    rerender();
    assert.equal(api!.spots.length, 1);
    assert.equal(api!.spots[0].label, 'Local');
  });
});
