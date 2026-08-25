// A small, credited set of quotes shown on the Journal page. Rotates daily so
// it feels like a "quote of the day" — deterministic by date so every open in
// the same day agrees, and it moves on the next day.
//
// Attribution is required (D18 personality layer, ToS attribution habit). Where
// a line is genuine playa/community wisdom with no single author, it is credited
// to the community rather than a fabricated name. Literary lines are credited to
// their authors. Keep lines short — this renders as one quiet caption.

export interface Quote {
  text: string;
  by: string;
}

export const JOURNAL_QUOTES: readonly Quote[] = [
  // Playa / Burning Man ethos (credited to the community, not invented authors).
  { text: 'No spectators.', by: 'Burning Man' },
  { text: 'The playa provides.', by: 'Playa proverb' },
  { text: 'Welcome home.', by: 'Black Rock City greeters' },
  { text: 'Leave no trace.', by: 'Burning Man' },
  // Literary lines that carry the same spirit — each traceable to a published
  // source under its author's name.
  { text: 'Not all those who wander are lost.', by: 'J.R.R. Tolkien' },              // The Fellowship of the Ring
  { text: 'We are the music makers, and we are the dreamers of dreams.', by: "Arthur O'Shaughnessy" }, // "Ode", 1873
  { text: 'In the midst of winter, I found there was, within me, an invincible summer.', by: 'Albert Camus' }, // "Return to Tipasa"
  { text: 'Creativity takes courage.', by: 'Henri Matisse' },
  { text: 'What is essential is invisible to the eye.', by: 'Antoine de Saint-Exupéry' }, // The Little Prince
  { text: 'Tell me, what is it you plan to do with your one wild and precious life?', by: 'Mary Oliver' }, // "The Summer Day"
  { text: 'Art is not what you see, but what you make others see.', by: 'Edgar Degas' },
  { text: 'Live in the sunshine, swim the sea, drink the wild air.', by: 'Ralph Waldo Emerson' }, // "Merlin's Song"
  { text: 'Wherever you are, be all there.', by: 'Jim Elliot' },                     // The Journals of Jim Elliot
  { text: 'There is a crack in everything. That’s how the light gets in.', by: 'Leonard Cohen' }, // "Anthem"
  { text: 'May your trails be crooked, winding, lonesome, dangerous, leading to the most amazing view.', by: 'Edward Abbey' }, // Desert Solitaire
  { text: 'The mountains are calling and I must go.', by: 'John Muir' },              // letter, 1873
  { text: 'I dwell in possibility.', by: 'Emily Dickinson' },                        // poem 466
  { text: 'Hope is the thing with feathers.', by: 'Emily Dickinson' },              // poem 314
  { text: 'I celebrate myself, and sing myself.', by: 'Walt Whitman' },             // "Song of Myself"
  { text: 'We are all in the gutter, but some of us are looking at the stars.', by: 'Oscar Wilde' }, // Lady Windermere's Fan
  { text: 'I took the one less traveled by, and that has made all the difference.', by: 'Robert Frost' }, // "The Road Not Taken"
  { text: 'The world breaks everyone, and afterward many are strong at the broken places.', by: 'Ernest Hemingway' }, // A Farewell to Arms
  { text: 'Do I dare disturb the universe?', by: 'T.S. Eliot' },                     // "The Love Song of J. Alfred Prufrock"
  { text: 'Adventure is worthwhile in itself.', by: 'Amelia Earhart' },
  { text: 'All that is gold does not glitter.', by: 'J.R.R. Tolkien' },              // The Fellowship of the Ring
];

const MS_PER_DAY = 86_400_000;

/** The quote for an explicit Playa calendar day — stable within that day and
 * independent of the browser/device timezone. */
export function quoteForDay(dayKey: string): Quote {
  const parsed = Date.parse(`${dayKey}T00:00:00Z`);
  const dayIndex = Number.isNaN(parsed) ? 0 : Math.floor(parsed / MS_PER_DAY);
  return JOURNAL_QUOTES[((dayIndex % JOURNAL_QUOTES.length) + JOURNAL_QUOTES.length) % JOURNAL_QUOTES.length];
}
