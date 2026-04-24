// Toolbar state transitions that matter most:
//   * typing fires onQueryChange
//   * Clear button fires onClear
//   * Favorites pill reflects active state + count
//   * Unfavorite-all only shows when the filter is engaged AND there's
//     something starred
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { Toolbar } from '../src/components/Toolbar';

let mount: HTMLElement;

beforeEach(() => {
  installDom();
  mount = document.createElement('div');
  document.body.appendChild(mount);
});
afterEach(() => { teardownDom(); });

function mountToolbar(over: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const props = {
    query: '',
    onQueryChange: () => {},
    onClear: () => {},
    favOnly: false,
    favCount: 0,
    favCampN: 0,
    favEventN: 0,
    onToggleFavFilter: () => {},
    webOnly: false,
    webCount: 0,
    onToggleWebFilter: () => {},
    onUnfavoriteAll: () => {},
    onShare: () => {},
    focusKey: 0,
    ...over,
  };
  render(h(Toolbar, props), mount);
  return mount;
}

describe('<Toolbar>', () => {
  test('shows the empty-star filter and (0) count when nothing favorited', () => {
    const el = mountToolbar();
    const pill = el.querySelector('#fav-filter')!;
    assert.match(pill.textContent ?? '', /☆ Favorites/);
    assert.match(pill.innerHTML, /\(0\)/);
    assert.equal(pill.getAttribute('aria-pressed'), 'false');
  });

  test('reflects the filled-star state when favOnly=true', () => {
    const el = mountToolbar({ favOnly: true, favCampN: 3, favCount: 3 });
    const pill = el.querySelector('#fav-filter')!;
    assert.match(pill.textContent ?? '', /★ Favorites/);
    assert.equal(pill.getAttribute('aria-pressed'), 'true');
    assert.match(pill.innerHTML, /\(3\)/);
  });

  test('hides Unfavorite-all when filter is off', () => {
    const el = mountToolbar({ favOnly: false, favCampN: 3 });
    const unfav = el.querySelector('.fav-clear')!;
    assert.ok(unfav.classList.contains('hidden'));
  });

  test('hides Unfavorite-all when filter is on but nothing is starred', () => {
    const el = mountToolbar({ favOnly: true, favCampN: 0, favEventN: 0 });
    const unfav = el.querySelector('.fav-clear')!;
    assert.ok(unfav.classList.contains('hidden'));
  });

  test('shows Unfavorite-all when filter is on and something is starred', () => {
    const el = mountToolbar({ favOnly: true, favCampN: 1, favEventN: 0 });
    const unfav = el.querySelector('.fav-clear')!;
    assert.ok(!unfav.classList.contains('hidden'));
  });

  test('calls onClear when the Clear button is clicked', () => {
    let fired = false;
    const el = mountToolbar({ onClear: () => { fired = true; } });
    const buttons = Array.from(el.querySelectorAll('button'));
    const clearBtn = buttons.find((b) => b.textContent === 'Clear')!;
    clearBtn.click();
    assert.ok(fired);
  });

  test('calls onToggleFavFilter when there are favorites to show', () => {
    let fired = false;
    const el = mountToolbar({
      favCampN: 2, favCount: 2,
      onToggleFavFilter: () => { fired = true; },
    });
    (el.querySelector('#fav-filter') as HTMLButtonElement).click();
    assert.ok(fired);
  });

  test('does NOT toggle filter when nothing is starred (just nudges)', () => {
    let fired = false;
    const el = mountToolbar({
      favCampN: 0, favEventN: 0,
      onToggleFavFilter: () => { fired = true; },
    });
    (el.querySelector('#fav-filter') as HTMLButtonElement).click();
    assert.equal(fired, false);
  });

  test('renders the "With website" filter with its count', () => {
    const el = mountToolbar({ webCount: 583 });
    assert.match(el.innerHTML, /With website ↗ <span class="count">\(583\)<\/span>/);
  });

  test('"With website" toggle reflects active state via aria-pressed', () => {
    const inactive = mountToolbar({ webOnly: false });
    assert.match(inactive.innerHTML, /aria-pressed="false"[^>]*>With website/);
    const active = mountToolbar({ webOnly: true });
    assert.match(active.innerHTML, /aria-pressed="true"[^>]*>With website/);
  });

  test('clicking "With website" calls onToggleWebFilter', () => {
    let fired = false;
    const el = mountToolbar({ onToggleWebFilter: () => { fired = true; } });
    const btns = el.querySelectorAll('.fav-filter');
    // Second `.fav-filter` is the Has-site button (Favorites is first).
    (btns[1] as HTMLButtonElement).click();
    assert.ok(fired);
  });
});
