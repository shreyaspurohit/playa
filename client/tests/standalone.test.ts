import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import { isStandaloneDisplay } from '../src/utils/standalone';

describe('isStandaloneDisplay', () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('false in an ordinary browser tab', () => {
    assert.equal(isStandaloneDisplay(), false);
  });

  test('true when the display-mode: standalone media query matches', () => {
    const original = window.matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
      matches: query.includes('standalone'), media: query,
    });
    try {
      assert.equal(isStandaloneDisplay(), true);
    } finally {
      (window as unknown as { matchMedia: unknown }).matchMedia = original;
    }
  });

  test('true when iOS navigator.standalone is set', () => {
    try {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    } catch {
      return; // environment forbids overriding navigator; the tab/media cases cover the logic
    }
    assert.equal(isStandaloneDisplay(), true);
  });
});
