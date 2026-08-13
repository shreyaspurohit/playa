import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import { LS } from '../src/types';
import {
  now, isMockNow, mockNowLabel, clearMockNow,
  formatPlayaDateTime, formatPlayaTime, playaTimeParts,
} from '../src/utils/clock';

describe('clock (simulated now)', () => {
  beforeEach(() => { installDom(); clearMockNow(); });
  afterEach(() => { clearMockNow(); teardownDom(); });

  test('no override → live clock', () => {
    assert.equal(isMockNow(), false);
    assert.equal(mockNowLabel(), '');
    assert.ok(Math.abs(now().getTime() - Date.now()) < 5000);
  });

  test('localStorage override freezes now() to that instant', () => {
    localStorage.setItem(LS.mockNow, '2026-08-31T13:00:00-07:00');
    assert.equal(isMockNow(), true);
    const d = now();
    // 13:00 PDT (-07:00) == 20:00 UTC on 2026-08-31
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 7);   // August
    assert.equal(d.getUTCDate(), 31);
    assert.equal(d.getUTCHours(), 20);
    // Frozen: two reads return the same instant.
    assert.equal(now().getTime(), d.getTime());
  });

  test('clearMockNow removes the override', () => {
    localStorage.setItem(LS.mockNow, '2026-08-31T13:00:00-07:00');
    assert.equal(isMockNow(), true);
    clearMockNow();
    assert.equal(isMockNow(), false);
  });

  test('clearMockNow removes a query-string override before reload', () => {
    location.href = 'http://localhost/?now=2026-08-31T13:00:00-07:00#food';
    assert.equal(isMockNow(), true);
    clearMockNow();
    assert.equal(isMockNow(), false);
    assert.doesNotMatch(location.href, /[?&]now=/);
    assert.equal(location.hash, '#food');
  });

  test('clearMockNow removes a hash-embedded override', () => {
    location.href = 'http://localhost/#food?now=2026-08-31T13:00:00-07:00';
    assert.equal(isMockNow(), true);
    clearMockNow();
    assert.equal(isMockNow(), false);
    assert.equal(location.hash, '#food');
  });

  test('a malformed override is ignored (live clock)', () => {
    localStorage.setItem(LS.mockNow, 'not-a-date');
    assert.equal(isMockNow(), false);
  });

  test('reads now= from the query string', () => {
    location.href = 'http://localhost/?now=2026-08-31T13:00:00-07:00';
    assert.equal(isMockNow(), true);
    assert.equal(now().getUTCHours(), 20); // 13:00 -07:00 == 20:00 UTC
  });

  test('reads now= even when the hash router shuffled it into the fragment', () => {
    // Reproduces the reported malformed URL: ?now= ended up inside the hash.
    location.href = 'http://localhost/#food&food?now=2026-08-31T13:00:00-07:00';
    assert.equal(isMockNow(), true);
    assert.equal(now().getUTCHours(), 20);
  });

  test('playa wall-clock fields do not depend on the runtime timezone', () => {
    const morning = new Date('2026-08-31T08:00:00-07:00');
    assert.deepEqual(playaTimeParts(morning), {
      year: 2026, weekday: 'Mon', month: 8, day: 31, hours: 8, minutes: 0,
    });
    assert.match(formatPlayaTime(morning), /8:00\s*AM/i);
    assert.equal(formatPlayaDateTime(morning), '8:00 AM PDT on Aug 31, 2026');
  });
});
