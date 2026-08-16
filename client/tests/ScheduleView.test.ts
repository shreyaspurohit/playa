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
      website: '', url: '', tags: [], events: [
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
        website: '', url: '', tags: [], events: [
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
        website: '', url: '', tags: [], events: [pastEvent],
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
        url: '', tags: [], events: [overnight],
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
