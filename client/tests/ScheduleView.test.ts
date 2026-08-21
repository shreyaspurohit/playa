// Source-year geometry gates only coordinate-dependent schedule features.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { ScheduleView } from '../src/components/ScheduleView';
import { installDom, teardownDom } from './_dom';

let mount: HTMLElement;

beforeEach(() => {
  installDom();
  mount = document.createElement('div');
  document.body.appendChild(mount);
});
afterEach(() => { teardownDom(); });

function mountSchedule(source: string) {
  render(h(ScheduleView, {
    camps: [],
    favEventIds: new Set<string>(),
    friendFavEventIds: () => [],
    burnStart: '2027-08-29',
    burnEnd: '2027-09-06',
    isDayHidden: () => false,
    onToggleDayHidden: () => {},
    hiddenCount: 0,
    onClearHidden: () => {},
    onGotoCamp: () => {},
    source,
  }), mount);
}

describe('<ScheduleView> source geometry', () => {
  test('disables only Near me when future geometry is unavailable', () => {
    mountSchedule('api-2027');
    const near = mount.querySelector<HTMLButtonElement>('.sched-filter-btn.near');
    assert.equal(near?.disabled, true);
    assert.ok(mount.querySelector('.schedule-wrap'));
    assert.equal(
      mount.querySelector<HTMLButtonElement>('.sched-filter-btn:not(.near)')?.disabled,
      false,
    );

    mountSchedule('api-2025');
    const historical = mount.querySelector<HTMLButtonElement>('.sched-filter-btn.near');
    assert.equal(historical?.disabled, false);
  });

  test('clears an active Near me filter when switching to a year without geometry', async () => {
    mountSchedule('api-2025');
    const near = mount.querySelector<HTMLButtonElement>('.sched-filter-btn.near');
    near?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      mount.querySelector<HTMLButtonElement>('.sched-filter-btn.near')
        ?.getAttribute('aria-pressed'),
      'true',
    );

    mountSchedule('api-2027');
    const unavailable = mount.querySelector<HTMLButtonElement>('.sched-filter-btn.near');
    assert.equal(unavailable?.disabled, true);
    assert.equal(unavailable?.getAttribute('aria-pressed'), 'false');
    assert.equal(mount.querySelector('.sched-filter-clear'), null);

    // Let the effect clear the internal state, then verify that returning to a
    // mapped historical year does not silently turn the filter back on.
    await new Promise((resolve) => setTimeout(resolve, 0));
    mountSchedule('api-2025');
    assert.equal(
      mount.querySelector<HTMLButtonElement>('.sched-filter-btn.near')
        ?.getAttribute('aria-pressed'),
      'false',
    );
  });
});

describe('<ScheduleView> recurring start date', () => {
  test('does not fan a recurring event backward before its first occurrence', () => {
    const recurring = {
      id: 'blinky', name: 'Blinky dance and light experience',
      description: '', time: '', display_time: '',
      parsed_time: {
        kind: 'recurring' as const,
        days: ['Tue', 'Wed', 'Fri'],
        start_day: 'Tue', start_date: '9/1',
        start_time: '20:00', end_day: 'Fri', end_date: '9/4', end_time: '23:45',
      },
    };
    render(h(ScheduleView, {
      camps: [{
        id: 'camp', name: 'Cats', location: '', description: '', website: '',
        tags: [], events: [recurring],
      }],
      favEventIds: new Set(['blinky']), friendFavEventIds: () => [],
      burnStart: '2026-08-24', burnEnd: '2026-09-07',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2026',
    }), mount);

    // The mobile accordion renders every populated day (content is in the DOM
    // even when collapsed), so it is the stable place to assert placement.
    const populatedDays = Array.from(
      mount.querySelectorAll<HTMLElement>('.schedule-accordion > details'))
      .filter((day) => day.textContent?.includes('Blinky dance and light experience'))
      .map((day) => day.querySelector('summary > .sched-day-label')?.textContent?.trim() ?? '');
    assert.deepEqual(populatedDays, ['Tue 9/1', 'Wed 9/2', 'Fri 9/4']);
  });
});

describe('<ScheduleView> past-event filter', () => {
  test('hides ended events, keeps in-progress and untimed events, and advances with the clock', async () => {
    const event = (
      id: string, name: string, start_time: string, end_time: string, parsed = true,
    ) => ({
      id, name, description: '', time: start_time, display_time: start_time,
      parsed_time: parsed ? {
        kind: 'single' as const, days: ['Mon'], start_day: 'Mon', start_date: '8/31',
        start_time, end_day: 'Mon', end_date: '8/31', end_time,
      } : null,
    });
    const camps = [{
      id: 'camp', name: 'Test Camp', location: '4:00 & B', description: '',
      website: '', tags: [], events: [
        event('past', 'Past event', '10:00', '11:00'),
        event('ongoing', 'Ongoing event', '12:00', '14:00'),
        event('future', 'Future event', '14:00', '16:00'),
        event('untimed', 'Untimed event', '', '', false),
      ],
    }];
    const props = {
      camps,
      favEventIds: new Set(['past', 'ongoing', 'future', 'untimed']),
      friendFavEventIds: () => [], youLabel: 'You',
      burnStart: '2026-08-31', burnEnd: '2026-08-31', isDayHidden: () => false,
      onToggleDayHidden: () => {}, hiddenCount: 0, onClearHidden: () => {},
      onGotoCamp: () => {}, source: 'api-2026',
      nowSnapshot: new Date('2026-08-31T13:00:00-07:00'),
    };
    render(h(ScheduleView, props), mount);
    const toggle = mount.querySelector<HTMLButtonElement>('.sched-filter-btn.past');
    assert.ok(toggle);
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mount.textContent?.includes('Past event'), false);
    assert.equal(mount.textContent?.includes('Ongoing event'), true);
    assert.equal(mount.textContent?.includes('Future event'), true);
    assert.equal(mount.textContent?.includes('Untimed event'), true);

    render(h(ScheduleView, {
      ...props, nowSnapshot: new Date('2026-08-31T15:00:00-07:00'),
    }), mount);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mount.textContent?.includes('Ongoing event'), false);
    assert.equal(mount.textContent?.includes('Future event'), true);
  });

  test('eye-hidden past occurrences are dropped by Hide past, not left expandable', async () => {
    const event = (id: string, name: string, start_time: string, end_time: string) => ({
      id, name, description: '', time: start_time, display_time: start_time,
      parsed_time: {
        kind: 'single' as const, days: ['Mon'], start_day: 'Mon', start_date: '8/31',
        start_time, end_day: 'Mon', end_date: '8/31', end_time,
      },
    });
    const props = {
      camps: [{
        id: 'camp', name: 'Test Camp', location: '4:00 & B', description: '',
        website: '', tags: [], events: [
          event('past', 'Past event', '10:00', '11:00'),
          event('ongoing', 'Ongoing event', '12:00', '14:00'),
        ],
      }],
      favEventIds: new Set(['past', 'ongoing']),
      friendFavEventIds: () => [], youLabel: 'You',
      burnStart: '2026-08-31', burnEnd: '2026-08-31',
      // The past event is eye-hidden on its day, so it lands in hiddenByCell.
      isDayHidden: (id: string) => id === 'past',
      onToggleDayHidden: () => {}, hiddenCount: 1, onClearHidden: () => {},
      onGotoCamp: () => {}, source: 'api-2026',
      nowSnapshot: new Date('2026-08-31T13:00:00-07:00'),
    };
    render(h(ScheduleView, props), mount);
    // Before Hide past, the eye-hidden event is present (in its hidden section).
    assert.equal(mount.textContent?.includes('Past event'), true);
    mount.querySelector<HTMLButtonElement>('.sched-filter-btn.past')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Hide past must remove it from the hidden section too, not just the main list.
    assert.equal(mount.textContent?.includes('Past event'), false);
  });

  test('shows a filter-specific empty state when all starred events ended', async () => {
    const pastEvent = {
      id: 'past', name: 'Past event', description: '', time: '', display_time: '',
      parsed_time: {
        kind: 'single' as const, days: ['Mon'], start_day: 'Mon', start_date: '8/31',
        start_time: '10:00', end_day: 'Mon', end_date: '8/31', end_time: '11:00',
      },
    };
    render(h(ScheduleView, {
      camps: [{
        id: 'camp', name: 'Test Camp', location: '4:00 & B', description: '',
        website: '', tags: [], events: [pastEvent],
      }],
      favEventIds: new Set(['past']),
      friendFavEventIds: () => [], youLabel: 'You',
      burnStart: '2026-08-31', burnEnd: '2026-08-31', isDayHidden: () => false,
      onToggleDayHidden: () => {}, hiddenCount: 0, onClearHidden: () => {},
      onGotoCamp: () => {}, source: 'api-2026',
      nowSnapshot: new Date('2026-08-31T13:00:00-07:00'),
    }), mount);
    const toggle = mount.querySelector<HTMLButtonElement>('.sched-filter-btn.past');
    assert.ok(toggle);
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(mount.textContent ?? '', /No events match the active filters/);
    assert.equal(mount.textContent?.includes('No starred events yet'), false);
  });

  test('keeps an overnight event through its next-day end time', async () => {
    const overnight = {
      id: 'overnight', name: 'Noodley night', description: '', time: '', display_time: '',
      parsed_time: {
        kind: 'single' as const, days: ['Sat'], start_day: 'Sat', start_date: '9/5',
        start_time: '23:00', end_day: 'Sun', end_date: '9/6', end_time: '01:00',
      },
    };
    const props = {
      camps: [{
        id: 'camp', name: 'Some Camp!', location: '', description: '', website: '',
        tags: [], events: [overnight],
      }],
      favEventIds: new Set(['overnight']), friendFavEventIds: () => [], youLabel: 'You',
      burnStart: '2026-09-05', burnEnd: '2026-09-06', isDayHidden: () => false,
      onToggleDayHidden: () => {}, hiddenCount: 0, onClearHidden: () => {},
      onGotoCamp: () => {}, source: 'api-2026',
      nowSnapshot: new Date('2026-09-06T00:30:00-07:00'),
    };
    render(h(ScheduleView, props), mount);
    mount.querySelector<HTMLButtonElement>('.sched-filter-btn.past')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mount.textContent?.includes('Noodley night'), true);

    render(h(ScheduleView, {
      ...props, nowSnapshot: new Date('2026-09-06T01:00:00-07:00'),
    }), mount);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mount.textContent?.includes('Noodley night'), false);
  });
});

const single = (id: string, name: string, date: string, day: string) => ({
  id, name, description: '', time: name, display_time: name,
  parsed_time: {
    kind: 'single' as const, days: [day], start_day: day, start_date: date,
    start_time: '12:00', end_day: day, end_date: date, end_time: '13:00',
  },
});
const campWith = (events: ReturnType<typeof single>[]) => ([{
  id: 'camp', name: 'Camp', location: '4:00 & B', description: '',
  website: '', tags: [], events,
}]);

describe('<ScheduleView> desktop day tabs', () => {
  const selectedTab = (root: HTMLElement) =>
    root.querySelector('.schedule-days [role="tab"][aria-selected="true"] .sched-day-label')
      ?.textContent?.trim() ?? '';
  const agendaText = (root: HTMLElement) =>
    root.querySelector('.schedule-agenda')?.textContent ?? '';
  const clickTab = (root: HTMLElement, label: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('.schedule-days [role="tab"]'))
      .find((t) => t.querySelector('.sched-day-label')?.textContent?.trim() === label)
      ?.click();

  test('selects today by default and shows its agenda', () => {
    render(h(ScheduleView, {
      camps: campWith([
        single('a', 'Mon thing', '8/31', 'Mon'),
        single('b', 'Wed thing', '9/2', 'Wed'),
      ]),
      favEventIds: new Set(['a', 'b']), friendFavEventIds: () => [],
      burnStart: '2026-08-30', burnEnd: '2026-09-05',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2026',
      nowSnapshot: new Date('2026-09-02T13:00:00-07:00'),
    }), mount);
    assert.equal(selectedTab(mount), 'Wed 9/2');
    assert.ok(agendaText(mount).includes('Wed thing'));
    assert.equal(agendaText(mount).includes('Mon thing'), false);
  });

  test('selects the first day before the burn, when today is outside the window', () => {
    render(h(ScheduleView, {
      camps: campWith([single('a', 'Mon thing', '8/31', 'Mon')]),
      favEventIds: new Set(['a']), friendFavEventIds: () => [],
      burnStart: '2027-08-29', burnEnd: '2027-09-06',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2027',
      nowSnapshot: new Date('2026-08-21T12:00:00-07:00'),
    }), mount);
    assert.equal(selectedTab(mount), 'Sun 8/29');
  });

  test('clicking a tab switches the agenda to that day', async () => {
    render(h(ScheduleView, {
      camps: campWith([
        single('a', 'Mon thing', '8/31', 'Mon'),
        single('b', 'Wed thing', '9/2', 'Wed'),
      ]),
      favEventIds: new Set(['a', 'b']), friendFavEventIds: () => [],
      burnStart: '2026-08-30', burnEnd: '2026-09-05',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2026',
      nowSnapshot: new Date('2026-09-02T13:00:00-07:00'),
    }), mount);
    clickTab(mount, 'Mon 8/31');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(selectedTab(mount), 'Mon 8/31');
    assert.ok(agendaText(mount).includes('Mon thing'));
    assert.equal(agendaText(mount).includes('Wed thing'), false);
  });

  test('with a filter active, defaults to a day that still has matches', async () => {
    // Today (Wed) has only a past event; Hide-past empties it, so the default
    // selection must fall to the first day that still has matches (Fri).
    render(h(ScheduleView, {
      camps: campWith([
        single('wed', 'Wed thing', '9/2', 'Wed'),
        single('fri', 'Fri thing', '9/4', 'Fri'),
      ]),
      favEventIds: new Set(['wed', 'fri']), friendFavEventIds: () => [],
      burnStart: '2026-08-30', burnEnd: '2026-09-05',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2026',
      nowSnapshot: new Date('2026-09-02T13:00:00-07:00'),
    }), mount);
    assert.equal(selectedTab(mount), 'Wed 9/2');
    mount.querySelector<HTMLButtonElement>('.sched-filter-btn.past')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(selectedTab(mount), 'Fri 9/4');
  });

  test('a same-month/day date in a different year is not treated as today', () => {
    // 2027 burn window; the clock is 2026-09-02 — same M/D as the second
    // burn day but a year off. Today must read as outside the window (fall
    // to the first day), not match Wed 9/2 by month/day alone.
    render(h(ScheduleView, {
      camps: campWith([
        single('a', 'Wed thing', '9/2', 'Wed'),
        single('b', 'Thu thing', '9/3', 'Thu'),
      ]),
      favEventIds: new Set(['a', 'b']), friendFavEventIds: () => [],
      burnStart: '2027-08-29', burnEnd: '2027-09-06',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2027',
      nowSnapshot: new Date('2026-09-02T13:00:00-07:00'),
    }), mount);
    assert.equal(selectedTab(mount), 'Sun 8/29');
  });

  test('arrow keys move the selected day and carry focus with the roving tabindex', async () => {
    render(h(ScheduleView, {
      camps: campWith([
        single('a', 'Sun thing', '8/30', 'Sun'),
        single('b', 'Mon thing', '8/31', 'Mon'),
      ]),
      favEventIds: new Set(['a', 'b']), friendFavEventIds: () => [],
      burnStart: '2026-08-30', burnEnd: '2026-09-05',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2026',
      nowSnapshot: new Date('2026-08-30T13:00:00-07:00'),
    }), mount);
    assert.equal(selectedTab(mount), 'Sun 8/30');
    mount.querySelector('.schedule-days')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(selectedTab(mount), 'Mon 8/31');
    const monTab = Array.from(mount.querySelectorAll<HTMLButtonElement>('.schedule-days [role="tab"]'))
      .find((t) => t.querySelector('.sched-day-label')?.textContent?.trim() === 'Mon 8/31')!;
    // Roving tabindex moved to the newly selected tab, and focus followed it
    // so the strip never becomes a keyboard trap.
    assert.equal(monTab.getAttribute('tabindex'), '0');
    assert.equal(document.activeElement, monTab);
  });
});

describe('<ScheduleView> mobile accordion', () => {
  const openDays = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>('.schedule-accordion > details[open]'))
      .map((d) => d.querySelector(':scope > summary > .sched-day-label')?.textContent?.trim() ?? '')
      .filter(Boolean);

  test('opens only today by default when today is in the burn window', () => {
    render(h(ScheduleView, {
      camps: campWith([
        single('a', 'Mon thing', '8/31', 'Mon'),
        single('b', 'Wed thing', '9/2', 'Wed'),
        single('c', 'Fri thing', '9/4', 'Fri'),
      ]),
      favEventIds: new Set(['a', 'b', 'c']), friendFavEventIds: () => [],
      burnStart: '2026-08-30', burnEnd: '2026-09-05',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2026',
      nowSnapshot: new Date('2026-09-02T13:00:00-07:00'),
    }), mount);
    assert.deepEqual(openDays(mount), ['Wed 9/2']);
  });

  test('toggling a filter on then off does not leave non-today days pinned open', async () => {
    const ongoing = single('today', 'Today thing', '9/2', 'Wed');
    ongoing.parsed_time.end_time = '14:00'; // still in progress at 13:00
    render(h(ScheduleView, {
      camps: campWith([
        single('past', 'Past thing', '9/1', 'Tue'),
        ongoing,
        single('future', 'Future thing', '9/4', 'Fri'),
      ]),
      favEventIds: new Set(['past', 'today', 'future']), friendFavEventIds: () => [],
      burnStart: '2026-08-30', burnEnd: '2026-09-05',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2026',
      nowSnapshot: new Date('2026-09-02T13:00:00-07:00'),
    }), mount);
    assert.deepEqual(openDays(mount), ['Wed 9/2']);
    // Hide-past drops the past day and expands the days that still have
    // matches — today (in progress) and Fri (future). Clearing must return
    // to today-only, not pin Fri open just because a filter briefly opened it.
    mount.querySelector<HTMLButtonElement>('.sched-filter-btn.past')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(openDays(mount).sort(), ['Fri 9/4', 'Wed 9/2']);
    mount.querySelector<HTMLButtonElement>('.sched-filter-clear')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(openDays(mount), ['Wed 9/2']);
  });

  test('a user opening a collapsed day sticks', async () => {
    render(h(ScheduleView, {
      camps: campWith([
        single('a', 'Mon thing', '8/31', 'Mon'),
        single('b', 'Wed thing', '9/2', 'Wed'),
      ]),
      favEventIds: new Set(['a', 'b']), friendFavEventIds: () => [],
      burnStart: '2026-08-30', burnEnd: '2026-09-05',
      isDayHidden: () => false, onToggleDayHidden: () => {},
      hiddenCount: 0, onClearHidden: () => {}, onGotoCamp: () => {},
      source: 'api-2026',
      nowSnapshot: new Date('2026-09-02T13:00:00-07:00'),
    }), mount);
    assert.deepEqual(openDays(mount), ['Wed 9/2']);
    // Simulate the native <details> toggle from a user tap on the Mon day.
    const mon = Array.from(mount.querySelectorAll<HTMLDetailsElement>('.schedule-accordion > details'))
      .find((d) => d.querySelector('summary > .sched-day-label')?.textContent?.trim() === 'Mon 8/31');
    assert.ok(mon);
    mon.open = true;
    mon.dispatchEvent(new Event('toggle'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(openDays(mount).sort(), ['Mon 8/31', 'Wed 9/2']);
  });
});
