import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { FoodView } from '../src/components/FoodView';
import type { Camp, Event, ParsedTime } from '../src/types';
import { addressToLatLng } from '../src/map/address';
import { brcForSource } from '../src/hooks/useSource';

let mount: HTMLElement;

beforeEach(() => {
  installDom();
  mount = document.createElement('div');
  document.body.appendChild(mount);
});
afterEach(() => {
  // Unmount before teardown so Preact runs FoodView's effect cleanups (the
  // document click-out listener, the geolocation watcher) BEFORE `document`
  // is deleted — avoids the post-teardown "document is not defined" race.
  try { render(null, mount); } catch { /* ignore */ }
  teardownDom();
});

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'e1',
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

function makeCamp(overrides: Partial<Camp> = {}): Camp {
  return {
    id: 'c1',
    name: 'Test Camp',
    location: '4:00 & B',
    description: 'test camp',
    website: 'https://example.com',
    url: 'https://directory.burningman.org/camps/c1/',
    tags: [],
    events: [],
    ...overrides,
  };
}

function mountFood(props: Partial<Parameters<typeof FoodView>[0]> = {}) {
  const full = {
    camps: [],
    isEventFav: () => false,
    onToggleEventFav: () => {},
    friendFavEventIds: () => [],
    onGotoCamp: () => {},
    source: 'directory' as const,
    ...props,
  };
  render(h(FoodView, full), mount);
  return mount;
}

// Preact flushes state-driven re-renders on a microtask/timer, so DOM
// assertions after a synthetic click must wait a tick.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('<FoodView>', () => {
  test('turning Near me off stops the browser GPS watch', async () => {
    const cleared: number[] = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: () => 77,
        clearWatch: (id: number) => { cleared.push(id); },
      },
    });
    mountFood();

    const button = mount.querySelector('.sched-filter-btn.near') as HTMLButtonElement;
    button.click();
    await tick();
    assert.equal(button.getAttribute('aria-pressed'), 'true');

    button.click();
    await tick();
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(cleared, [77]);
  });

  test('Near me includes Hours not listed and toggles back to the prior list', async () => {
    const brc = brcForSource('directory')!;
    const simulated = addressToLatLng('4:00 & B', brc)!;
    location.href = `http://localhost/?gps=${simulated.lat},${simulated.lng}#food`;
    const near = makeCamp({
      id: 'near', name: 'Nearby Ramen', location: '4:00 & B',
      food_tags: ['noodles'], events: [],
    });
    const far = makeCamp({
      id: 'far', name: 'Faraway Pizza', location: '9:00 & K',
      food_tags: ['pizza'], events: [],
    });
    mountFood({ camps: [near, far] });

    const button = mount.querySelector('.sched-filter-btn.near') as HTMLButtonElement;
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.match(mount.textContent ?? '', /Nearby Ramen/);
    assert.match(mount.textContent ?? '', /Faraway Pizza/);

    button.click();
    await tick();
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.match(mount.textContent ?? '', /Hours not listed/);
    assert.match(mount.textContent ?? '', /Nearby Ramen/);
    assert.doesNotMatch(mount.textContent ?? '', /Faraway Pizza/);

    button.click();
    await tick();
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.match(mount.textContent ?? '', /Nearby Ramen/);
    assert.match(mount.textContent ?? '', /Faraway Pizza/);
  });

  test('renders a section header and food-typechips for food events', () => {
    const foodEvent = makeEvent({
      id: 'food-later',
      name: 'Pizza Station',
      food_tags: ['pizza'],
      parsed_time: makeParsedTime({
        kind: 'recurring',
        days: ['Mon'],
        start_time: '10:00',
        end_time: '11:00',
      }),
    });
    const camp = makeCamp({
      events: [foodEvent],
    });

    mountFood({ camps: [camp] });
    // Verify a section renders
    assert.match(mount.innerHTML, /Upcoming/);
    // Verify food type chip appears
    assert.match(mount.innerHTML, /food-typechip/);
    assert.match(mount.innerHTML, /pizza/);
  });

  test('uses a prominent plus/minus indicator for availability sections', async () => {
    const camp = makeCamp({
      events: [makeEvent({
        id: 'food-later', name: 'Pizza Station', food_tags: ['pizza'],
        parsed_time: makeParsedTime(),
      })],
    });
    mountFood({ camps: [camp] });

    const toggle = mount.querySelector('.food-section-toggle') as HTMLButtonElement;
    const indicator = toggle.querySelector('.food-section-indicator') as HTMLElement;
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(indicator.textContent?.trim(), '+');

    toggle.click();
    await tick();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(indicator.textContent?.trim(), '−');
  });

  test('renders food-typechips for multiple food types', () => {
    const camp = makeCamp({
      events: [
        makeEvent({
          id: 'e-pizza',
          name: 'Pizza',
          food_tags: ['pizza'],
          parsed_time: makeParsedTime({
            kind: 'recurring',
            days: ['Mon'],
          }),
        }),
        makeEvent({
          id: 'e-veggie',
          name: 'Vegetarian',
          food_tags: ['vegan'],
          parsed_time: makeParsedTime({
            kind: 'recurring',
            days: ['Mon'],
          }),
        }),
      ],
    });

    mountFood({ camps: [camp] });
    // Both entries and both type chips should render
    assert.match(mount.innerHTML, /Pizza/);
    assert.match(mount.innerHTML, /Vegetarian/);
    const chips = mount.querySelectorAll('.food-typechip');
    assert.ok(chips.length >= 2);
  });

  test('clicking .food-star calls onToggleEventFav', () => {
    let toggled: string | null = null;
    const foodEvent = makeEvent({
      id: 'e-test',
      name: 'Test Food',
      food_tags: ['test'],
      parsed_time: makeParsedTime({
        kind: 'recurring',
        days: ['Mon'],
      }),
    });
    const camp = makeCamp({ events: [foodEvent] });

    mountFood({
      camps: [camp],
      onToggleEventFav: (id) => { toggled = id; },
    });

    const starBtn = mount.querySelector('.food-star') as HTMLButtonElement;
    assert.ok(starBtn);
    starBtn.click();
    assert.equal(toggled, 'e-test');
  });

  test('renders the real camp address on each row (nothing when absent)', () => {
    const withLoc = makeCamp({
      id: 'c-loc', name: 'Located Camp', location: '5:30 & G',
      events: [makeEvent({ id: 'e-loc', name: 'Located Food', food_tags: ['pizza'], parsed_time: makeParsedTime() })],
    });
    mountFood({ camps: [withLoc] });
    const loc = mount.querySelector('.food-loc');
    assert.ok(loc, 'location span present');
    assert.match(loc!.textContent ?? '', /5:30 & G/);

    // Empty / "None Listed" → no location span, and definitely no invented text.
    render(null, mount); teardownDom(); installDom();
    mount = document.createElement('div'); document.body.appendChild(mount);
    const noLoc = makeCamp({
      id: 'c-noloc', name: 'Hidden Camp', location: '',
      events: [makeEvent({ id: 'e-noloc', name: 'Hidden Food', food_tags: ['pizza'], parsed_time: makeParsedTime() })],
    });
    mountFood({ camps: [noLoc] });
    assert.equal(mount.querySelector('.food-loc'), null);
    assert.doesNotMatch(mount.innerHTML, /location on directory/);
  });

  test('clicking a food row expands it inline (and toggles closed)', async () => {
    let gotoId: string | null = null;
    const camp = makeCamp({
      id: 'c-open', name: 'Open Me', description: 'A friendly camp.',
      events: [makeEvent({ id: 'e-open', name: 'Some Food', description: 'Tasty stuff.', food_tags: ['pizza'], parsed_time: makeParsedTime() })],
    });
    mountFood({ camps: [camp], onGotoCamp: (id) => { gotoId = id; } });
    const row = mount.querySelector('.food-row.clickable') as HTMLElement;
    const toggle = row.querySelector('.food-row-toggle') as HTMLButtonElement;
    assert.ok(toggle, 'detail toggle present');
    assert.equal(mount.querySelector('.food-detail'), null, 'starts collapsed');
    toggle.click();
    await tick();
    assert.ok(mount.querySelector('.food-detail'), 'expands inline on click');
    assert.match(mount.innerHTML, /Tasty stuff\./);
    assert.equal(gotoId, null, 'row click does NOT navigate to Camps anymore');
    toggle.click();
    await tick();
    assert.equal(mount.querySelector('.food-detail'), null, 'toggles closed on second click');
  });

  test('opening another row collapses the first (one open at a time)', async () => {
    const camp = makeCamp({
      id: 'c-multi',
      events: [
        makeEvent({ id: 'e-a', name: 'Alpha', food_tags: ['pizza'], parsed_time: makeParsedTime() }),
        makeEvent({ id: 'e-b', name: 'Beta', food_tags: ['tacos'], parsed_time: makeParsedTime() }),
      ],
    });
    mountFood({ camps: [camp] });
    const toggles = mount.querySelectorAll('.food-row-toggle');
    (toggles[0] as HTMLButtonElement).click();
    await tick();
    (toggles[1] as HTMLButtonElement).click();
    await tick();
    assert.equal(mount.querySelectorAll('.food-detail').length, 1, 'only one expanded');
  });

  test('the star toggles the fav without expanding or navigating', async () => {
    let gotoId: string | null = null;
    let toggled: string | null = null;
    const camp = makeCamp({
      id: 'c-star',
      events: [makeEvent({ id: 'e-star', name: 'Star Food', food_tags: ['pizza'], parsed_time: makeParsedTime() })],
    });
    mountFood({
      camps: [camp],
      onGotoCamp: (id) => { gotoId = id; },
      onToggleEventFav: (id) => { toggled = id; },
    });
    (mount.querySelector('.food-star') as HTMLButtonElement).click();
    await tick();
    assert.equal(toggled, 'e-star');
    assert.equal(gotoId, null, 'star does not navigate');
    assert.equal(mount.querySelector('.food-detail'), null, 'star does not expand the row');
  });

  test('the expanded "View camp details" action navigates to Camps', async () => {
    let gotoId: string | null = null;
    const camp = makeCamp({
      id: 'c-openpage', name: 'Deep Camp',
      events: [makeEvent({ id: 'e-op', name: 'Late Food', food_tags: ['pizza'], parsed_time: makeParsedTime() })],
    });
    mountFood({ camps: [camp], onGotoCamp: (id) => { gotoId = id; } });
    (mount.querySelector('.food-row-toggle') as HTMLButtonElement).click();
    await tick();
    const openBtn = mount.querySelector('.food-open-camp') as HTMLButtonElement;
    assert.ok(openBtn, 'View camp details button present when expanded');
    openBtn.click();
    assert.equal(gotoId, 'c-openpage');
  });

  test('renders a section for anytime food events (no parsed_time)', () => {
    const foodEvent = makeEvent({
      id: 'e-anytime',
      name: 'Coffee Bar',
      food_tags: ['coffee'],
      parsed_time: null, // no time listed
    });
    const camp = makeCamp({ events: [foodEvent] });

    mountFood({ camps: [camp] });
    assert.match(mount.innerHTML, /Hours not listed/);
    assert.match(mount.innerHTML, /🍽/);
    assert.match(mount.innerHTML, /Coffee Bar/);
  });

  test('camp-level anytime uses precise food_tags, not the coarse food tag', () => {
    // Coarse `food` tag but no precise food_tags (e.g. an event merely says
    // "snacks") → the camp must NOT appear in Food.
    const noisy = makeCamp({ id: 'c-noisy', name: 'Acorn Oasis', tags: ['food'], food_tags: [], events: [] });
    mountFood({ camps: [noisy] });
    assert.doesNotMatch(mount.innerHTML, /Acorn Oasis/);

    render(null, mount); teardownDom(); installDom();
    mount = document.createElement('div'); document.body.appendChild(mount);
    // Precise food_tags (from the camp's own name/desc) + no events → an
    // Anytime row with the type chip.
    const real = makeCamp({ id: 'c-real', name: '42 Ramen', tags: ['food'], food_tags: ['noodles'], events: [] });
    mountFood({ camps: [real] });
    assert.match(mount.innerHTML, /42 Ramen/);
    assert.match(mount.innerHTML, /noodles/);
  });

  test('renders an empty state when no food events present', () => {
    const camp = makeCamp({
      events: [
        makeEvent({
          id: 'e-non-food',
          name: 'Regular Event',
          food_tags: undefined, // not a food event
        }),
      ],
    });

    mountFood({ camps: [camp] });
    assert.match(mount.innerHTML, /No food listings are available/i);
  });

  test('renders a concise introduction to the food view', () => {
    const camp = makeCamp({
      events: [
        makeEvent({
          id: 'e-food',
          name: 'Food Event',
          food_tags: ['food'],
          parsed_time: makeParsedTime({
            kind: 'recurring',
            days: ['Mon'],
          }),
        }),
      ],
    });

    mountFood({ camps: [camp] });
    assert.match(mount.innerHTML, /meals and snacks being served now or coming up/);
    assert.match(mount.innerHTML, /plan your next stop/);
  });

  test('shows friend stars when friendFavEventIds returns names', () => {
    const foodEvent = makeEvent({
      id: 'e-fav',
      name: 'Faved Event',
      food_tags: ['food'],
      parsed_time: makeParsedTime({
        kind: 'recurring',
        days: ['Mon'],
      }),
    });
    const camp = makeCamp({ events: [foodEvent] });

    mountFood({
      camps: [camp],
      friendFavEventIds: () => ['alice', 'bob'],
    });

    assert.match(mount.innerHTML, /Starred by/);
    assert.match(mount.innerHTML, /alice/);
    assert.match(mount.innerHTML, /bob/);
  });

  test('the search box filters entries by name/type', async () => {
    const camp = makeCamp({
      id: 'c-search',
      events: [
        makeEvent({ id: 'e-pizza', name: 'Pizza Party', food_tags: ['pizza'], parsed_time: makeParsedTime() }),
        makeEvent({ id: 'e-ramen', name: 'Midnight Ramen', food_tags: ['noodles'], parsed_time: makeParsedTime() }),
      ],
    });
    mountFood({ camps: [camp] });
    assert.match(mount.innerHTML, /Pizza Party/);
    assert.match(mount.innerHTML, /Midnight Ramen/);
    const search = mount.querySelector('.food-search') as HTMLInputElement;
    search.value = 'ramen';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    assert.doesNotMatch(mount.innerHTML, /Pizza Party/);
    assert.match(mount.innerHTML, /Midnight Ramen/);
  });

  test('source changes clear food-type filters', async () => {
    const directoryCamp = makeCamp({
      id: 'directory-camp',
      events: [makeEvent({
        id: 'pizza-event', name: 'Pizza', food_tags: ['pizza'],
        parsed_time: makeParsedTime(),
      })],
    });
    mountFood({ camps: [directoryCamp], source: 'directory' });
    (mount.querySelector('.food-typechip') as HTMLButtonElement).click();
    await tick();

    const apiCamp = makeCamp({
      id: 'api-camp',
      events: [makeEvent({
        id: 'taco-event', name: 'Tacos', food_tags: ['tacos'],
        parsed_time: makeParsedTime(),
      })],
    });
    mountFood({ camps: [apiCamp], source: 'api-2026' });
    await tick();

    assert.match(mount.innerHTML, /Tacos/);
    assert.doesNotMatch(mount.innerHTML, /No food matches/);
  });

  test('uses a real disclosure button without nested interactive controls', () => {
    const camp = makeCamp({
      events: [makeEvent({
        id: 'accessible-event', name: 'Accessible Food', food_tags: ['pizza'],
        parsed_time: makeParsedTime(),
      })],
    });
    mountFood({ camps: [camp] });

    const row = mount.querySelector('.food-row') as HTMLElement;
    const toggle = row.querySelector('.food-row-toggle') as HTMLButtonElement;
    const star = row.querySelector('.food-star') as HTMLButtonElement;
    assert.equal(row.getAttribute('role'), null);
    assert.ok(toggle);
    assert.ok(star);
    assert.equal(toggle.contains(star), false);
  });

  test('shows starred upcoming food in a collapsed, expandable picks section', async () => {
    const camp = makeCamp({
      id: 'c-pick',
      events: [makeEvent({ id: 'e-pick', name: 'Starred Ramen', food_tags: ['noodles'], parsed_time: makeParsedTime() })],
    });
    // No picks when nothing starred…
    mountFood({ camps: [camp], isEventFav: () => false });
    assert.equal(mount.querySelector('.food-picks'), null);
    // …picks appear when the event is starred.
    render(null, mount); teardownDom(); installDom();
    mount = document.createElement('div'); document.body.appendChild(mount);
    mountFood({ camps: [camp], isEventFav: (id) => id === 'e-pick' });
    const picks = mount.querySelector('.food-picks');
    assert.ok(picks, 'Your picks section present');
    assert.match(picks!.textContent ?? '', /Starred Ramen/);
    const toggle = picks!.querySelector<HTMLButtonElement>('.food-section-toggle');
    const list = picks!.querySelector('.food-list');
    assert.equal(toggle?.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle?.querySelector('.food-section-indicator')?.textContent?.trim(), '+');
    assert.equal(list?.classList.contains('collapsed'), true);

    toggle?.click();
    await tick();
    assert.equal(toggle?.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle?.querySelector('.food-section-indicator')?.textContent?.trim(), '−');
    assert.equal(list?.classList.contains('collapsed'), false);
  });

  test('Refresh re-snapshots the clock (Upcoming → Serving now)', async () => {
    const camp = makeCamp({
      id: 'c-daily',
      events: [makeEvent({
        id: 'e-daily', name: 'Daily Lunch', food_tags: ['meal'],
        parsed_time: makeParsedTime({
          kind: 'recurring',
          days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
          start_day: null, end_day: null, start_date: null,
          start_time: '12:00', end_time: '17:00',
        }),
      })],
    });
    // Freeze the clock at 8am (before service) via the mock-clock LS key.
    localStorage.setItem('bm-mock-now', '2026-08-31T08:00:00-07:00');
    mountFood({ camps: [camp], burnStart: '2026-08-25', burnEnd: '2026-09-07' });
    assert.doesNotMatch(mount.innerHTML, /Serving now/, 'not serving at 8am');
    assert.match(
      mount.textContent ?? '',
      /Updated at 8:00\s*AM PDT on Aug 31, 2026/i,
    );
    // Advance the clock to mid-service and Refresh — availability re-evaluates.
    localStorage.setItem('bm-mock-now', '2026-08-31T13:00:00-07:00');
    (mount.querySelector('.food-refresh') as HTMLButtonElement).click();
    await tick();
    assert.match(mount.innerHTML, /Serving now/, 'serving now after refresh');
    localStorage.removeItem('bm-mock-now');
  });

  test('Upcoming sorts by date, not just time/name (8/31 before 9/3)', () => {
    const camp = makeCamp({
      id: 'c-order',
      events: [
        // Names are reverse-ordered vs dates: if it fell back to name-sort
        // (the old bug), "AAA" (9/3) would wrongly precede "ZZZ" (8/31).
        makeEvent({
          id: 'e-late', name: 'AAA Ramen', food_tags: ['noodles'],
          parsed_time: makeParsedTime({ kind: 'single', start_day: null, start_date: '9/3', start_time: '00:00', end_time: '02:00' }),
        }),
        makeEvent({
          id: 'e-early', name: 'ZZZ Tacos', food_tags: ['tacos'],
          parsed_time: makeParsedTime({ kind: 'single', start_day: null, start_date: '8/31', start_time: '00:00', end_time: '00:30' }),
        }),
      ],
    });
    mountFood({ camps: [camp], burnStart: '2026-08-25', burnEnd: '2026-09-07' });
    const titles = [...mount.querySelectorAll('.food-row-title')].map((n) => n.textContent || '');
    const iEarly = titles.findIndex((t) => /ZZZ Tacos/.test(t));
    const iLate = titles.findIndex((t) => /AAA Ramen/.test(t));
    assert.ok(iEarly >= 0 && iLate >= 0, 'both rows present');
    assert.ok(iEarly < iLate, `8/31 should sort before 9/3 (got ${iEarly} vs ${iLate})`);
  });

  test('past single events drop out of "Your picks"', () => {
    // A single-occurrence event dated Jan 1 is in the past relative to today.
    const camp = makeCamp({
      id: 'c-past',
      events: [makeEvent({
        id: 'e-past', name: 'Old Feast', food_tags: ['meal'],
        parsed_time: makeParsedTime({ kind: 'single', start_day: null, start_date: '1/1' }),
      })],
    });
    mountFood({ camps: [camp], isEventFav: (id) => id === 'e-past' });
    assert.equal(mount.querySelector('.food-picks'), null, 'past single not in picks');
    assert.doesNotMatch(mount.innerHTML, /Old Feast/, 'past single not in Upcoming either');
  });
});
