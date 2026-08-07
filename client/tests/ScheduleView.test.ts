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
