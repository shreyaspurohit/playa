import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { TabBar } from '../src/components/TabBar';
import { installDom, teardownDom } from './_dom';

let mount: HTMLElement;

beforeEach(() => {
  installDom();
  mount = document.createElement('div');
  document.body.appendChild(mount);
});

afterEach(() => {
  try { render(null, mount); } catch { /* ignore */ }
  teardownDom();
});

const badges = () => [...mount.querySelectorAll('.tab-count')].map((el) => el.textContent);

describe('<TabBar> count badges', () => {
  test('shows a badge only for tabs with a positive count', () => {
    render(h(TabBar, {
      view: 'camps',
      onGoto: () => {},
      // DOM order is camps, schedule, food, art, map, journal.
      counts: { camps: 3, schedule: 0, art: 1 },
    }), mount);
    // schedule:0 and the unlisted tabs render no badge.
    assert.deepEqual(badges(), ['3', '1']);
  });

  test('renders no badges when counts are omitted', () => {
    render(h(TabBar, { view: 'camps', onGoto: () => {} }), mount);
    assert.equal(mount.querySelectorAll('.tab-count').length, 0);
  });

  test('caps a large count at 99+', () => {
    render(h(TabBar, {
      view: 'camps',
      onGoto: () => {},
      counts: { camps: 250 },
    }), mount);
    assert.deepEqual(badges(), ['99+']);
  });

  test('adds the count to the tab aria-label for screen readers', () => {
    render(h(TabBar, {
      view: 'camps',
      onGoto: () => {},
      counts: { camps: 3, map: 0 },
    }), mount);
    const btns = [...mount.querySelectorAll('button')];
    const camps = btns.find((b) => b.textContent?.includes('Camps'));
    const map = btns.find((b) => b.textContent?.includes('Map'));
    assert.equal(camps?.getAttribute('aria-label'), 'Camps, 3 saved');
    // A zero/absent count leaves the label as the bare tab name.
    assert.equal(map?.getAttribute('aria-label'), 'Map');
  });
});
