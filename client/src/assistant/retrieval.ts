// Retrieval grounding for the assistant (ADR 21 D4).
//
// Pure, model-free: turns a question into a ranked set of REAL records from the
// data the app already holds (camps, events, art, plus the user's own saved
// favorites), a few deterministic computed facts, and a compact grounding-text
// block. This is both the retrieval-only answer (no model) and the context a
// generative tier is instructed to answer strictly from. No network, no state,
// fully testable.

import type { Art, Camp, Event } from '../types';

export interface AskCorpus {
  camps: Camp[];
  art: Art[];
  campFavs: ReadonlySet<string>;
  eventFavs: ReadonlySet<string>;
  artFavs: ReadonlySet<string>;
}

export interface GroundingItem {
  kind: 'camp' | 'event' | 'art';
  id: string;
  campId?: string;           // for events: the host camp (for navigation)
  title: string;
  subtitle: string;          // location / host / time
  snippet: string;           // trimmed description
  score: number;
  faved: boolean;
}

export interface Retrieval {
  items: GroundingItem[];
  facts: string[];
  contextText: string;       // grounding block for a model prompt
  favoritesOnly: boolean;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'is', 'are',
  'i', 'me', 'my', 'we', 'do', 'does', 'can', 'where', 'what', 'which', 'who',
  'how', 'when', 'any', 'some', 'for', 'with', 'near', 'find', 'show', 'get',
  'that', 'this', 'there', 'have', 'has', 'want', 'looking', 'be', 'been',
]);

const FAV_SIGNALS = ['saved', 'starred', 'favorite', 'favourite', 'faved', 'bookmarked', 'my list'];
const FOOD_SIGNALS = ['food', 'eat', 'coffee', 'drink', 'snack', 'meal', 'breakfast', 'lunch', 'dinner', 'hungry', 'bar'];

const MAX_ITEMS = 12;
const SNIPPET = 160;

function tokenize(q: string): string[] {
  return q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function trim(text: string, n = SNIPPET): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n).trimEnd() + '…' : clean;
}

function scoreText(terms: string[], name: string, tags: string, body: string): number {
  const n = name.toLowerCase();
  const t = tags.toLowerCase();
  const b = body.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (n.includes(term)) score += 4;
    if (t.includes(term)) score += 3;
    if (b.includes(term)) score += 1;
  }
  return score;
}

function eventTimeLabel(e: Event): string {
  return e.display_time || e.time || '';
}

/** Build a grounded retrieval for a question over the corpus. */
export function retrieve(question: string, corpus: AskCorpus): Retrieval {
  const qLower = question.toLowerCase();
  const terms = tokenize(question);
  const favoritesOnly = FAV_SIGNALS.some((s) => qLower.includes(s));
  const foodIntent = FOOD_SIGNALS.some((s) => qLower.includes(s));

  const items: GroundingItem[] = [];

  for (const camp of corpus.camps) {
    const faved = corpus.campFavs.has(camp.id);
    // The camp itself is a candidate only when it's not filtered out and scores.
    if (!favoritesOnly || faved) {
      let score = scoreText(terms, camp.name, camp.tags.join(' '), camp.description);
      if (foodIntent && camp.food_tags && camp.food_tags.length) score += 5;
      if (faved) score += 2;                    // gentle preference for the user's own list
      if (favoritesOnly && terms.length === 0) score += 1; // "show my saved camps"
      if (score > 0) {
        items.push({
          kind: 'camp', id: camp.id, title: camp.name,
          subtitle: camp.location && camp.location !== 'None Listed' ? camp.location : '',
          snippet: trim(camp.description), score, faved,
        });
      }
    }

    // Events are always scanned, independent of the camp's own score — an event
    // can match even when its host camp doesn't.
    for (const e of camp.events || []) {
      const efaved = corpus.eventFavs.has(e.id);
      if (favoritesOnly && !efaved) continue;
      let es = scoreText(terms, e.name, (e.food_tags || []).join(' '), e.description);
      if (foodIntent && e.food_tags && e.food_tags.length) es += 4;
      if (efaved) es += 2;
      if (favoritesOnly && terms.length === 0) es += 1;
      if (es <= 0) continue;
      items.push({
        kind: 'event', id: e.id, campId: camp.id, title: e.name || 'Event',
        subtitle: [eventTimeLabel(e), `at ${camp.name}`].filter(Boolean).join(' · '),
        snippet: trim(e.description), score: es, faved: efaved,
      });
    }
  }

  for (const a of corpus.art) {
    const faved = corpus.artFavs.has(a.id);
    if (favoritesOnly && !faved) continue;
    let score = scoreText(terms, a.name, [a.category, a.program, ...(a.tags || [])].join(' '), a.description);
    if (faved) score += 2;
    if (score <= 0) continue;
    items.push({
      kind: 'art', id: a.id, title: a.name,
      subtitle: [a.artist ? `by ${a.artist}` : '', a.location].filter(Boolean).join(' · '),
      snippet: trim(a.description), score, faved,
    });
  }

  items.sort((x, y) => y.score - x.score || Number(y.faved) - Number(x.faved));
  const top = items.slice(0, MAX_ITEMS);

  const facts: string[] = [];
  const campHits = items.filter((i) => i.kind === 'camp').length;
  const eventHits = items.filter((i) => i.kind === 'event').length;
  const artHits = items.filter((i) => i.kind === 'art').length;
  if (favoritesOnly) facts.push(`Searching only your saved list (${corpus.campFavs.size} camps, ${corpus.eventFavs.size} events, ${corpus.artFavs.size} art starred).`);
  if (campHits) facts.push(`${campHits} matching camp${campHits === 1 ? '' : 's'}${foodIntent ? ' (food prioritized)' : ''}.`);
  if (eventHits) facts.push(`${eventHits} matching event${eventHits === 1 ? '' : 's'}.`);
  if (artHits) facts.push(`${artHits} matching artwork${artHits === 1 ? '' : 's'}.`);
  if (top.length === 0) facts.push('No matches in the current data.');

  const contextText = buildContext(top);
  return { items: top, facts, contextText, favoritesOnly };
}

/** Compact grounding block a generative tier must answer strictly from. */
export function buildContext(items: GroundingItem[]): string {
  if (items.length === 0) return 'No matching records.';
  const lines = items.map((i) => {
    const head = i.subtitle ? `${i.title} (${i.subtitle})` : i.title;
    return `- [${i.kind}] ${head}: ${i.snippet}`;
  });
  return lines.join('\n');
}
