// Hook tests. We don't need a full Preact renderer for hook behavior
// since the hook is just state + localStorage side effects. But to
// exercise `useState` + `useCallback` we do need Preact to actually be
// running components — so we mount a tiny test component that calls the
// hook and exposes its return value.
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { useFavorites, type FavoritesApi } from '../src/hooks/useFavorites';
import { readStringSet } from '../src/utils/storage';

let api: FavoritesApi | null = null;
let forceRerender: () => void = () => {};

function Harness(): null {
  api = useFavorites('test-favs');
  // Capture a way to re-render to observe post-toggle state.
  forceRerender = () => render(h(Harness, {}), mountpoint);
  return null;
}

let mountpoint: HTMLElement;

beforeEach(() => {
  installDom();
  mountpoint = document.createElement('div');
  document.body.appendChild(mountpoint);
  render(h(Harness, {}), mountpoint);
});
afterEach(() => {
  // Unmount before tearing down the DOM globals — the new storage-
  // event listener (added for multi-tab sync) needs `window` to be
  // present in its cleanup, otherwise Preact's later effect-cleanup
  // throws "window is not defined" asynchronously.
  try { render(null, mountpoint); } catch { /* ignore */ }
  teardownDom();
  api = null;
});

describe('useFavorites', () => {
  test('starts with an empty set when no prior data', () => {
    assert.equal(api!.size, 0);
    assert.equal(api!.has('1'), false);
  });

  test('toggle adds and removes', () => {
    api!.toggle('42');
    forceRerender();
    assert.equal(api!.has('42'), true);
    assert.equal(api!.size, 1);

    api!.toggle('42');
    forceRerender();
    assert.equal(api!.has('42'), false);
    assert.equal(api!.size, 0);
  });

  test('toggle persists to localStorage', () => {
    api!.toggle('a');
    api!.toggle('b');
    forceRerender();
    const persisted = readStringSet('test-favs');
    assert.deepEqual([...persisted].sort(), ['a', 'b']);
  });

  test('clear empties the set and persists', () => {
    api!.toggle('a');
    api!.toggle('b');
    forceRerender();
    api!.clear();
    forceRerender();
    assert.equal(api!.size, 0);
    assert.equal(readStringSet('test-favs').size, 0);
  });

  test('loads prior favorites from localStorage on mount', () => {
    // Seed storage, then mount a *fresh* tree into a new container so
    // the useState initializer re-runs (a plain re-render into the
    // existing tree reuses the previous state).
    localStorage.setItem('test-favs', JSON.stringify(['x', 'y']));
    const fresh = document.createElement('div');
    document.body.appendChild(fresh);
    render(h(Harness, {}), fresh);
    assert.equal(api!.size, 2);
    assert.equal(api!.has('x'), true);
    assert.equal(api!.has('y'), true);
  });
});
