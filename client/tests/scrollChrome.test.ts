import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceScrollChrome, INITIAL_SCROLL_CHROME, type ScrollChromeState,
} from '../src/utils/scrollChrome';

function step(state: ScrollChromeState, y: number, mobile = true) {
  return advanceScrollChrome(state, y, mobile);
}

describe('advanceScrollChrome', () => {
  test('keeps the chrome visible near the top', () => {
    const state = step({ ...INITIAL_SCROLL_CHROME, collapsed: true, y: 100 }, 20);
    assert.equal(state.collapsed, false);
  });

  test('collapses after sustained downward travel', () => {
    let state = step(INITIAL_SCROLL_CHROME, 100);
    state = step(state, 112);
    state = step(state, 125);
    assert.equal(state.collapsed, true);
  });

  test('reveals quickly when direction reverses', () => {
    let state: ScrollChromeState = {
      y: 200, direction: 1, travel: 0, collapsed: true,
    };
    state = step(state, 194);
    assert.equal(state.collapsed, true);
    state = step(state, 189);
    assert.equal(state.collapsed, false);
  });

  test('never collapses outside the mobile breakpoint', () => {
    const state = step({
      y: 100, direction: 1, travel: 100, collapsed: true,
    }, 200, false);
    assert.equal(state.collapsed, false);
  });
});
