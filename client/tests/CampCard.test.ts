// Component smoke tests for CampCard. We mount the component into a
// happy-dom container and assert on the rendered DOM.
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { CampCard } from '../src/components/CampCard';
import type { Camp } from '../src/types';

let mount: HTMLElement;

beforeEach(() => {
  installDom();
  mount = document.createElement('div');
  document.body.appendChild(mount);
});
afterEach(() => {
  teardownDom();
});

function baseCamp(over: Partial<Camp> = {}): Camp {
  return {
    id: '779',
    name: 'Zen Tent',
    location: '4:00 & B',
    description: 'a quiet camp',
    website: 'https://example.com',
        tags: ['yoga', 'food'],
    events: [
      { id: 'e1', name: 'Morning Vinyasa', description: 'daily yoga',
        time: 'From 7 to 8', display_time: 'Mon–Fri 8/31–9/4 · 7:00 AM – 8:00 AM', parsed_time: null },
    ],
    ...over,
  };
}

function mountCard(props: Partial<Parameters<typeof CampCard>[0]> = {}) {
  const full = {
    camp: baseCamp(),
    query: '',
    queryLower: '',
    isFav: false,
    isFavEvent: () => false,
    friendsFavingCamp: [] as string[],
    friendsFavingEvent: (_: string) => [] as string[],
    onToggleFav: () => {},
    onToggleFavEvent: () => {},
    onTagClick: () => {},
    onNavigate: () => {},
    isMyCamp: false,
    myCampSet: false,
    onSetMyCamp: () => {},
    onRemoveFriendCampStar: () => {},
    onRemoveFriendEventStar: () => {},
    ...props,
  };
  render(h(CampCard, full), mount);
  return mount;
}

describe('<CampCard>', () => {
  test('renders name, location, tags, and no external record link', () => {
    const el = mountCard();
    assert.match(el.innerHTML, /Zen Tent/);
    assert.match(el.innerHTML, /4:00 &amp; B/);
    assert.match(el.innerHTML, /yoga/);
    assert.match(el.innerHTML, /food/);
    assert.equal(el.querySelector('h3 a'), null);
  });

  test('renders an empty placeholder when description is blank', () => {
    mountCard({ camp: baseCamp({ description: '' }) });
    assert.match(mount.innerHTML, /no description/);
  });

  test('shows the filled star for favorited camps', () => {
    mountCard({ isFav: true });
    const btn = mount.querySelector('.fav-btn')!;
    assert.ok(btn.classList.contains('active'));
    assert.equal(btn.textContent, '★');
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
  });

  test('shows the outline star for un-favorited camps', () => {
    mountCard({ isFav: false });
    const btn = mount.querySelector('.fav-btn')!;
    assert.equal(btn.textContent, '☆');
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
  });

  test('invokes onToggleFav with the camp id when the star is clicked', () => {
    let toggled: string | null = null;
    mountCard({ onToggleFav: (id) => { toggled = id; } });
    const btn = mount.querySelector('.fav-btn') as HTMLButtonElement;
    btn.click();
    assert.equal(toggled, '779');
  });

  test('invokes onTagClick with the tag name when a badge is clicked', () => {
    let clicked: string | null = null;
    mountCard({ onTagClick: (t) => { clicked = t; } });
    const badges = mount.querySelectorAll('.tagbadge');
    (badges[0] as HTMLElement).click();
    assert.equal(clicked, 'yoga');
  });

  test('renders event name without an external record link', () => {
    mountCard();
    const name = mount.querySelector('.evname') as HTMLElement;
    assert.equal(name.tagName, 'SPAN');
    assert.equal(name.closest('a'), null);
  });

  test('auto-opens events section when any event is favorited', () => {
    mountCard({ isFavEvent: (id) => id === 'e1' });
    const details = mount.querySelector('details.events') as HTMLDetailsElement;
    assert.ok(details.open);
  });

  test('does not auto-open events when nothing matches', () => {
    mountCard({ isFavEvent: () => false });
    const details = mount.querySelector('details.events') as HTMLDetailsElement;
    assert.ok(!details.open);
  });

  test('event favorite click invokes onToggleFavEvent with the event id', () => {
    let toggled: string | null = null;
    mountCard({ onToggleFavEvent: (id) => { toggled = id; } });
    const evBtn = mount.querySelector('.ev-fav') as HTMLButtonElement;
    evBtn.click();
    assert.equal(toggled, 'e1');
  });

  test('event time uses display_time when available', () => {
    mountCard();
    assert.match(mount.innerHTML, /Mon–Fri 8\/31–9\/4 · 7:00 AM – 8:00 AM/);
  });

  test('event time falls back to raw time when display_time is empty', () => {
    mountCard({ camp: baseCamp({
      events: [{ id: 'e1', name: 'Raw', description: '', time: 'whenever',
                  display_time: '', parsed_time: null }],
    })});
    assert.match(mount.innerHTML, /whenever/);
  });

  test('fully filtered recurrence renders its exact-date fallback', () => {
    mountCard({ camp: baseCamp({
      events: [{
        id: 'e1', name: 'Before the burn', description: '',
        time: 'Thu, Fri 8/20–8/21 · 8:00 PM – 10:00 PM',
        display_time: '',
        parsed_time: {
          kind: 'recurring', dates: [], days: ['Thu', 'Fri'],
          start_time: '20:00', end_time: '22:00', overnight: false,
        },
      }],
    })});
    assert.match(
      mount.querySelector('.evtime')?.textContent ?? '',
      /^Thu, Fri 8\/20–8\/21 · 8:00 PM – 10:00 PM$/,
    );
  });

  test('shows "set as my camp" when no home camp is chosen', () => {
    mountCard({ isMyCamp: false, myCampSet: false });
    assert.match(mount.innerHTML, /set as my camp/);
  });

  test('hides "set as my camp" on other cards once a home camp is chosen', () => {
    mountCard({ isMyCamp: false, myCampSet: true });
    assert.doesNotMatch(mount.innerHTML, /set as my camp/);
    assert.doesNotMatch(mount.innerHTML, /my camp/);
  });

  test('keeps the pill on the chosen home camp as an unset control', () => {
    mountCard({ isMyCamp: true, myCampSet: true });
    // The tent is rendered as an inline <svg> (TentIcon), not the 🏕
    // emoji — font-fallback was showing raw Unicode hex on some phones.
    assert.match(mount.innerHTML, /class="my-camp-btn active"/);
    assert.match(mount.innerHTML, /<svg class="tent-icon"/);
    assert.match(mount.innerHTML, /> my camp</);
  });
});
