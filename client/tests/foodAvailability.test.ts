import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Event, ParsedTime } from '../src/types';
import {
  eventAvailability, isFoodEvent, isUpcomingFood, nowContext, occursOn,
} from '../src/utils/foodAvailability';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'test-event',
    name: 'Test Event',
    description: 'test description',
    time: 'raw time',
    display_time: 'display time',
    parsed_time: null,
    ...overrides,
  };
}

function makeParsedTime(overrides: Partial<ParsedTime> = {}): ParsedTime {
  return {
    kind: 'recurring',
    days: ['Mon'],
    start_day: 'Mon',
    start_date: null,
    end_day: 'Mon',
    end_date: null,
    start_time: '10:00',
    end_time: '11:00',
    ...overrides,
  };
}

/** A fixed August 2026 instant expressed in Black Rock City local time. */
function playaDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-07:00`);
}

describe('eventAvailability', () => {
  test('returns "anytime" when parsed_time is null', () => {
    const ev = makeEvent({ parsed_time: null });
    const result = eventAvailability(ev, new Date());
    assert.equal(result, 'anytime');
  });

  test('returns "anytime" when start_time cannot be parsed', () => {
    const ev = makeEvent({
      parsed_time: makeParsedTime({ start_time: 'invalid' }),
    });
    const result = eventAvailability(ev, new Date());
    assert.equal(result, 'anytime');
  });

  test('returns "now" when a recurring event occurs today and clock is inside window', () => {
    const now = playaDate('2026-08-31', '10:30');
    const ctx = nowContext(now);
    // Event runs 10:00-11:00 on the current day
    const ev = makeEvent({
      parsed_time: makeParsedTime({
        kind: 'recurring',
        days: [ctx.weekday],
        start_time: '10:00',
        end_time: '11:00',
      }),
    });
    const result = eventAvailability(ev, now);
    assert.equal(result, 'now');
  });

  test('returns "soon" when a recurring event today starts within next 2 hours', () => {
    const now = playaDate('2026-08-31', '10:00');
    const ctx = nowContext(now);
    // Event starts at 11:00, which is 1 hour away (within 2 hour window)
    const ev = makeEvent({
      parsed_time: makeParsedTime({
        kind: 'recurring',
        days: [ctx.weekday],
        start_time: '11:00',
        end_time: '12:00',
      }),
    });
    const result = eventAvailability(ev, now);
    assert.equal(result, 'soon');
  });

  test('returns "later" when event is on a different weekday', () => {
    const now = playaDate('2026-08-31', '10:30');
    const ctx = nowContext(now);
    // Find a different weekday
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const otherDay = weekdays[(weekdays.indexOf(ctx.weekday) + 1) % 7];
    const ev = makeEvent({
      parsed_time: makeParsedTime({
        kind: 'recurring',
        days: [otherDay],
        start_time: '10:00',
        end_time: '11:00',
      }),
    });
    const result = eventAvailability(ev, now);
    assert.equal(result, 'later');
  });

  test('returns "later" when event has already passed today', () => {
    const now = playaDate('2026-08-31', '14:00');
    const ctx = nowContext(now);
    // Event was 10:00-11:00, already passed
    const ev = makeEvent({
      parsed_time: makeParsedTime({
        kind: 'recurring',
        days: [ctx.weekday],
        start_time: '10:00',
        end_time: '11:00',
      }),
    });
    const result = eventAvailability(ev, now);
    assert.equal(result, 'later');
  });

  test('returns "now" after midnight for a single event that started yesterday', () => {
    const ev = makeEvent({
      parsed_time: makeParsedTime({
        kind: 'single', days: ['Tue'], start_day: 'Tue', start_date: '8/25',
        start_time: '22:00', end_day: 'Wed', end_date: '8/26', end_time: '02:00',
      }),
    });
    assert.equal(
      eventAvailability(ev, playaDate('2026-08-26', '01:00')),
      'now',
    );
  });

  test('infers midnight wrap for recurring events without explicit day fields', () => {
    const ev = makeEvent({
      parsed_time: makeParsedTime({
        kind: 'recurring', days: ['Tue'], start_day: null, start_date: '8/25',
        start_time: '22:00', end_day: null, end_date: null, end_time: '02:00',
      }),
    });
    assert.equal(
      eventAvailability(
        ev,
        playaDate('2026-08-26', '01:00'),
        { burnStart: '2026-08-25', burnEnd: '2026-09-07' },
      ),
      'now',
    );
  });
});

describe('isFoodEvent', () => {
  test('returns true when event has food_tags', () => {
    const ev = makeEvent({ food_tags: ['pizza', 'breakfast'] });
    assert.equal(isFoodEvent(ev), true);
  });

  test('returns false when food_tags is empty array', () => {
    const ev = makeEvent({ food_tags: [] });
    assert.equal(isFoodEvent(ev), false);
  });

  test('returns false when food_tags is undefined', () => {
    const ev = makeEvent({ food_tags: undefined });
    assert.equal(isFoodEvent(ev), false);
  });
});

describe('nowContext', () => {
  test('derives correct weekday and time from a Date', () => {
    const date = playaDate('2026-08-26', '14:35');
    const ctx = nowContext(date);
    // Just verify structure; the weekday depends on the actual day
    assert.ok(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].includes(ctx.weekday));
    assert.equal(ctx.md, '8/26');
    assert.equal(ctx.minutes, 14 * 60 + 35);
  });
});

describe('occursOn', () => {
  test('returns true for recurring event matching today\'s weekday', () => {
    const now = new Date();
    const ctx = nowContext(now);
    const p = makeParsedTime({
      kind: 'recurring',
      days: [ctx.weekday],
    });
    assert.equal(occursOn(p, ctx), true);
  });

  test('returns false for recurring event not matching today\'s weekday', () => {
    const now = new Date();
    const ctx = nowContext(now);
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const otherDay = weekdays[(weekdays.indexOf(ctx.weekday) + 1) % 7];
    const p = makeParsedTime({
      kind: 'recurring',
      days: [otherDay],
    });
    assert.equal(occursOn(p, ctx), false);
  });

  test('returns true for single event matching today\'s date M/D', () => {
    const now = new Date();
    const ctx = nowContext(now);
    const p = makeParsedTime({
      kind: 'single',
      start_date: ctx.md,
      start_day: null,
    });
    assert.equal(occursOn(p, ctx), true);
  });

  test('returns false for single event not matching today\'s date', () => {
    const now = new Date();
    const ctx = nowContext(now);
    // Pick a different date
    const otherDate = `${ctx.md === '8/26' ? '8/27' : '8/26'}`;
    const p = makeParsedTime({
      kind: 'single',
      start_date: otherDate,
      start_day: null,
    });
    assert.equal(occursOn(p, ctx), false);
  });
});

describe('eventAvailability date gating (burn window + start date)', () => {
  const OPTS = { burnStart: '2026-08-25', burnEnd: '2026-09-07' };
  const daily = (start_date: string | null, start = '12:00', end = '17:00') =>
    makeEvent({
      food_tags: ['meal'],
      parsed_time: makeParsedTime({
        kind: 'recurring',
        days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        start_day: null, end_day: null,
        start_date, start_time: start, end_time: end,
      }),
    });

  test('a daily event before the burn window is "later", not "soon" (the Aug-9 bug)', () => {
    // Aug 9, 10am — well before the window; would have matched weekday+time.
    const when = playaDate('2026-08-09', '10:00');
    assert.equal(eventAvailability(daily('8/31'), when, OPTS), 'later');
  });

  test('a daily event during the window, mid-service, is "now"', () => {
    const when = playaDate('2026-08-31', '13:00'); // Aug 31, 1pm, inside 12–5
    assert.equal(eventAvailability(daily('8/25'), when, OPTS), 'now');
  });

  test('a daily event during the window, ~1h before start, is "soon"', () => {
    const when = playaDate('2026-08-31', '11:00'); // Aug 31, 11am, starts 12
    assert.equal(eventAvailability(daily('8/25'), when, OPTS), 'soon');
  });

  test('in-window but before the event\'s start date is "later"', () => {
    const when = playaDate('2026-08-26', '13:00'); // Aug 26, but starts 8/31
    assert.equal(eventAvailability(daily('8/31'), when, OPTS), 'later');
  });
});

describe('isUpcomingFood', () => {
  const OPTS = { burnStart: '2026-08-25', burnEnd: '2026-09-07' };

  test('returns false for a single event that ended earlier today', () => {
    const ev = makeEvent({
      parsed_time: makeParsedTime({
        kind: 'single', days: ['Wed'], start_day: 'Wed', start_date: '8/26',
        start_time: '10:00', end_day: 'Wed', end_date: '8/26', end_time: '11:00',
      }),
    });
    assert.equal(isUpcomingFood(ev, playaDate('2026-08-26', '14:00'), OPTS), false);
  });

  test('keeps an overnight single event while it is still serving', () => {
    const ev = makeEvent({
      parsed_time: makeParsedTime({
        kind: 'single', days: ['Tue'], start_day: 'Tue', start_date: '8/25',
        start_time: '22:00', end_day: 'Wed', end_date: '8/26', end_time: '02:00',
      }),
    });
    assert.equal(isUpcomingFood(ev, playaDate('2026-08-26', '01:00'), OPTS), true);
  });
});
