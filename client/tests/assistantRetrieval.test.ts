import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieve, buildContext, timeIntent, type AskCorpus } from '../src/assistant/retrieval';
import type { Art, Camp, Event } from '../src/types';

function camp(over: Partial<Camp>): Camp {
  return { id: '1', name: '', location: '', description: '', website: '', url: '', tags: [], events: [], ...over };
}
function ev(over: Partial<Event>): Event {
  return { id: 'e', name: '', description: '', time: '', display_time: '', parsed_time: null, ...over };
}
function art(over: Partial<Art>): Art {
  return { id: 'a', name: '', location: '', description: '', url: '', artist: '', hometown: '', category: '', program: '', image_url: '', year: 0, tags: [], ...over };
}
const NONE = new Set<string>();
function corpus(over: Partial<AskCorpus>): AskCorpus {
  return { camps: [], art: [], campFavs: NONE, eventFavs: NONE, artFavs: NONE, journal: [], ...over };
}

describe('assistant retrieval (ADR 21 D4)', () => {
  test('keyword match ranks the relevant camp first', () => {
    const r = retrieve('coffee', corpus({
      camps: [
        camp({ id: 'c1', name: 'Coffee Cult', description: 'espresso all day', tags: ['coffee'] }),
        camp({ id: 'c2', name: 'Silent Disco', description: 'dance' }),
      ],
    }));
    assert.equal(r.items[0].id, 'c1');
    assert.ok(!r.items.some((i) => i.id === 'c2')); // c2 scores 0, excluded
  });

  test('favorites-only restricts to starred records', () => {
    const r = retrieve('my saved chai', corpus({
      camps: [camp({ id: 'c1', name: 'Chai Camp', description: 'tea' }), camp({ id: 'c2', name: 'Chai House', description: 'tea' })],
      campFavs: new Set(['c1']),
    }));
    assert.equal(r.favoritesOnly, true);
    assert.ok(r.items.length > 0 && r.items.every((i) => i.id === 'c1'));
  });

  test('food intent boosts a food camp over a same-name non-food match', () => {
    const r = retrieve('food grilled cheese', corpus({
      camps: [
        camp({ id: 'c1', name: 'Grilled Cheese', description: 'sandwiches', food_tags: ['savory'] }),
        camp({ id: 'c2', name: 'Grilled Cheese', description: 'a talk about the sandwich' }),
      ],
    }));
    assert.equal(r.items[0].id, 'c1');
  });

  test('an event matches even when its host camp does not, and keeps the camp id', () => {
    const r = retrieve('sunrise set', corpus({
      camps: [camp({ id: 'c1', name: 'Sound Camp', events: [ev({ id: 'e1', name: 'Sunrise Set', description: 'DJ' })] })],
    }));
    const hit = r.items.find((i) => i.kind === 'event');
    assert.ok(hit, 'event surfaced');
    assert.equal(hit!.campId, 'c1'); // navigates to the host camp
  });

  test('art matches by category/artist', () => {
    const r = retrieve('fire', corpus({ art: [art({ id: 'a1', name: 'Flame Tower', artist: 'Jo', category: 'fire' })] }));
    assert.equal(r.items[0].kind, 'art');
    assert.equal(r.items[0].id, 'a1');
  });

  test('no match yields empty items and a clear fact', () => {
    const r = retrieve('zzzznope', corpus({ camps: [camp({ id: 'c1', name: 'X', description: 'y' })] }));
    assert.equal(r.items.length, 0);
    assert.ok(r.facts.some((f) => /No matches/i.test(f)));
  });

  test('context block lists real records for grounding', () => {
    const r = retrieve('coffee', corpus({ camps: [camp({ id: 'c1', name: 'Coffee Cult', description: 'espresso', tags: ['coffee'] })] }));
    const ctx = buildContext(r.items);
    assert.match(ctx, /Coffee Cult/);
    assert.match(ctx, /\[camp\]/);
  });

  test('time-of-day intent surfaces an event by its start hour with no keyword match', () => {
    const nine = ev({ id: 'e1', name: 'Late Set', description: 'bass', parsed_time: { kind: 'single', days: ['Tue'], start_day: 'Tue', start_date: '8/27', start_time: '21:00', end_day: 'Tue', end_date: '8/27', end_time: '23:00' } });
    const noon = ev({ id: 'e2', name: 'Late Set', description: 'bass', parsed_time: { kind: 'single', days: ['Tue'], start_day: 'Tue', start_date: '8/27', start_time: '12:00', end_day: 'Tue', end_date: '8/27', end_time: '13:00' } });
    const r = retrieve('anything tonight around 9pm', corpus({
      camps: [camp({ id: 'c1', name: 'Sound', events: [nine, noon] })],
    }));
    const hit = r.items.find((i) => i.kind === 'event');
    assert.ok(hit, 'an event surfaced from the time window alone');
    assert.equal(hit!.id, 'e1'); // the 9pm event, not the noon one
    assert.ok(r.facts.some((f) => /at that time/i.test(f)));
  });

  test('timeIntent parses the common shapes', () => {
    assert.deepEqual(timeIntent('what is on at 9pm'), { start: 20, end: 23 });
    assert.deepEqual(timeIntent('sunrise sets'), { start: 5, end: 8 });
    assert.ok(timeIntent('something tonight')); // night wraps midnight
    assert.equal(timeIntent('coffee camps'), null);
  });

  test('journal notes are searchable and cite the private note', () => {
    const r = retrieve('what did I note about the temple', corpus({
      journal: [{ id: 'j1', title: 'Temple burn', text: 'stood at the temple at sunset, felt everything' }],
    }));
    const hit = r.items.find((i) => i.kind === 'journal');
    assert.ok(hit, 'journal note surfaced');
    assert.equal(hit!.id, 'j1');
    assert.equal(hit!.subtitle, 'your journal');
    assert.ok(r.facts.some((f) => /journal note/i.test(f)));
  });
});
