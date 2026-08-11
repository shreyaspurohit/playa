import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import { LS } from '../src/types';
import {
  clearMockGps, isMockGps, mockGps, mockGpsLabel, parseMockGps,
} from '../src/utils/mockGps';

describe('simulated GPS', () => {
  beforeEach(() => { installDom(); clearMockGps(); });
  afterEach(() => { clearMockGps(); teardownDom(); });

  test('validates latitude and longitude bounds', () => {
    assert.deepEqual(parseMockGps('40.786958,-119.202994'), {
      lat: 40.786958, lng: -119.202994, accuracyM: 5,
    });
    assert.equal(parseMockGps('91,0'), null);
    assert.equal(parseMockGps('0,-181'), null);
    assert.equal(parseMockGps('not-a-position'), null);
  });

  test('no override uses real GPS', () => {
    assert.equal(mockGps(), null);
    assert.equal(isMockGps(), false);
    assert.equal(mockGpsLabel(), '');
  });

  test('reads query position and persists it', () => {
    location.href = 'http://localhost/?gps=40.786958,-119.202994#food';
    assert.deepEqual(mockGps(), {
      lat: 40.786958, lng: -119.202994, accuracyM: 5,
    });
    assert.equal(localStorage.getItem(LS.mockGps), '40.786958,-119.202994');
    assert.equal(mockGpsLabel(), '40.786958, -119.202994');
  });

  test('reads a persisted position without a query', () => {
    localStorage.setItem(LS.mockGps, '40.78,-119.2');
    assert.equal(mockGps()?.lat, 40.78);
    assert.equal(isMockGps(), true);
  });

  test('malformed query is ignored', () => {
    location.href = 'http://localhost/?gps=200,300#food';
    assert.equal(mockGps(), null);
  });

  test('clear removes query and storage while preserving route and now', () => {
    location.href = 'http://localhost/?now=2026-08-31T13%3A00-07%3A00&gps=40.78,-119.2#food';
    assert.equal(isMockGps(), true);
    clearMockGps();
    assert.equal(isMockGps(), false);
    assert.doesNotMatch(location.href, /[?&]gps=/);
    assert.match(location.href, /[?&]now=/);
    assert.equal(location.hash, '#food');
  });

  test('clear removes a hash-embedded override', () => {
    location.href = 'http://localhost/#food?gps=40.78,-119.2';
    assert.equal(isMockGps(), true);
    clearMockGps();
    assert.equal(isMockGps(), false);
    assert.equal(location.hash, '#food');
  });
});
