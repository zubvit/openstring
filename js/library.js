// The music that ships with the app.
//
// Every melody here is playable with ONLY the notes its lesson has already
// taught. That is the whole discipline of the file: one out-of-range note and it
// recreates the cliff this course was rebuilt to remove - a piece you cannot play
// is worse than no piece, because it teaches you that the app lies about what you
// are ready for. `test/library.test.mjs` checks every note of every tune against
// its lesson's note set, so this cannot rot.
//
// LICENCE. This project is MIT and public, so nothing copyrighted goes in here.
// Every item is one of three things, and says which in `source`:
//   'trad'                       - a traditional melody, public domain
//   'public-domain: X, d.YEAR'   - a named composer dead well over 70 years
//   'original'                   - written for this app
// The sequence these sit in follows how classical guitar methods have ordered
// things for two centuries, which is a method and not a text; no method book's
// words, arrangements or original exercises are reproduced.
//
// Folk tunes are transposed to whatever key fits the lesson's notes. That is not
// a liberty - it is exactly what method books do, and it is the only way a real
// tune can appear before the whole octave is learned.

/**
 * `melody` is his part; `accomp` is the app's, and has no note-set limit because
 * he never plays it. Durations are quarter-note beats. See js/tune.js.
 */
export const PIECES = [

  // ---------------------------------------------------------------- lesson 1
  // Three open strings, nothing fingered. A tune is impossible on three notes,
  // so these lean entirely on the accompaniment: his part is deliberately plain
  // and the music happens underneath it. That is the oldest trick in the method
  // book and it is why a first lesson can end in something worth hearing.
  {
    id: 'bell-tower',
    title: 'The Bell Tower',
    source: 'original',
    kind: 'duet',
    lesson: 1,
    meter: [4, 4],
    bpm: 60,
    melody: 'E4/4 | B3/4 | G3/4 | B3/4 | E4/2 B3/2 | G3/2 B3/2 | E4/2 G3/2 | E4/4',
    accomp: 'E2/2 B2/2 | E2/2 B2/2 | G2/2 D3/2 | G2/2 D3/2 | E2/2 B2/2 | C3/2 G2/2 | A2/2 E3/2 | E2/4',
    why: 'Whole notes only, so the whole job is finding the string and letting it ring.',
  },
  {
    id: 'evening-round',
    title: 'Evening Round',
    source: 'original',
    kind: 'duet',
    lesson: 1,
    meter: [3, 4],
    bpm: 72,
    melody: 'G3/2 B3/1 | E4/3 | B3/2 G3/1 | B3/3 | E4/2 B3/1 | G3/2 B3/1 | E4/1 B3/1 G3/1 | E4/3',
    accomp: 'E2/3 | E2/3 | G2/3 | G2/3 | A2/3 | C3/3 | B2/3 | E2/3',
    why: 'Three beats in a bar instead of four, so the count changes before the notes do.',
  },

  // ---------------------------------------------------------------- lesson 2
  // A is added on the third string, and three notes become four - which is the
  // exact moment a real tune becomes possible. Hot Cross Buns needs only the top
  // three degrees of a scale and is probably the first tune anybody ever plays.
  {
    id: 'hot-cross-buns',
    title: 'Hot Cross Buns',
    source: 'trad',
    kind: 'duet',
    lesson: 2,
    meter: [4, 4],
    bpm: 76,
    melody: 'B3/1 A3/1 G3/2 | B3/1 A3/1 G3/2 | G3/1 G3/1 A3/1 A3/1 | B3/1 A3/1 G3/2',
    accomp: 'G2/2 D3/2 | G2/2 D3/2 | C3/2 D3/2 | G2/2 D3/2',
    why: 'The first real tune, and it needs exactly the three notes he has plus the new one.',
  },
  {
    id: 'stepping-stones',
    title: 'Stepping Stones',
    source: 'original',
    kind: 'tune',
    lesson: 2,
    meter: [4, 4],
    bpm: 72,
    melody: 'G3/1 A3/1 B3/2 | A3/1 B3/1 G3/2 | B3/1 A3/1 G3/1 A3/1 | B3/4',
    accomp: 'G2/4 | D3/4 | G2/2 D3/2 | G2/4',
    why: 'Steps and skips between the three lowest notes, so the new A is never alone.',
  },

  // ---------------------------------------------------------------- lesson 3
  // C and D arrive on the second string and the set becomes a full hexachord -
  // six notes, which is enough for a surprising amount of the world's folk music.
  {
    id: 'merrily-we-roll-along',
    title: 'Merrily We Roll Along',
    source: 'trad',
    kind: 'duet',
    lesson: 3,
    meter: [4, 4],
    bpm: 84,
    melody: 'B3/1 A3/1 G3/1 A3/1 | B3/1 B3/1 B3/2 | A3/1 A3/1 A3/2 | B3/1 D4/1 D4/2 '
          + '| B3/1 A3/1 G3/1 A3/1 | B3/1 B3/1 B3/1 B3/1 | A3/1 A3/1 B3/1 A3/1 | G3/4',
    accomp: 'G2/2 D3/2 | G2/4 | D3/4 | G2/4 | G2/2 D3/2 | G2/4 | D3/2 D3/2 | G2/4',
    why: 'The same tune as Mary Had a Little Lamb, and the first one he will recognise.',
  },
  {
    id: 'au-clair-de-la-lune',
    title: 'Au clair de la lune',
    source: 'trad',
    kind: 'duet',
    lesson: 3,
    meter: [4, 4],
    bpm: 80,
    melody: 'C4/1 C4/1 C4/1 D4/1 | E4/2 D4/2 | C4/1 E4/1 D4/1 D4/1 | C4/4 '
          + '| D4/1 D4/1 D4/1 D4/1 | A3/2 D4/2 | C4/1 B3/1 A3/1 G3/1 | C4/4 '
          + '| C4/1 C4/1 C4/1 D4/1 | E4/2 D4/2 | C4/1 E4/1 D4/1 D4/1 | C4/4',
    accomp: 'C3/4 | G2/2 C3/2 | C3/2 G2/2 | C3/4 | G2/4 | D3/2 G2/2 | C3/2 G2/2 | C3/4 '
          + '| C3/4 | G2/2 C3/2 | C3/2 G2/2 | C3/4',
    why: 'Twelve bars in three phrases, and the middle one walks down the whole hexachord.',
  },
  {
    id: 'frere-jacques',
    title: 'Frère Jacques',
    source: 'trad',
    kind: 'duet',
    lesson: 3,
    meter: [4, 4],
    bpm: 88,
    // The last line normally drops to a low sol, which lives on a string he has
    // not met. Taking it up an octave instead is what method books do and keeps
    // the whole round inside the lesson.
    melody: 'G3/1 A3/1 B3/1 G3/1 | G3/1 A3/1 B3/1 G3/1 | B3/1 C4/1 D4/2 | B3/1 C4/1 D4/2 '
          + '| D4/0.5 E4/0.5 D4/0.5 C4/0.5 B3/1 G3/1 | D4/0.5 E4/0.5 D4/0.5 C4/0.5 B3/1 G3/1 '
          + '| G3/1 D4/1 G3/2 | G3/1 D4/1 G3/2',
    // It is a round, so the app plays the same tune two bars behind him, an
    // octave down. Nothing else in the course sounds as much like real music for
    // as little as it asks of him.
    accomp: 'r/4 | r/4 | G2/1 A2/1 B2/1 G2/1 | G2/1 A2/1 B2/1 G2/1 | B2/1 C3/1 D3/2 | B2/1 C3/1 D3/2 '
          + '| D3/0.5 E3/0.5 D3/0.5 C3/0.5 B2/1 G2/1 | D3/0.5 E3/0.5 D3/0.5 C3/0.5 B2/1 G2/1',
    why: 'A round: the app comes in two bars behind him and it becomes two parts.',
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    source: 'public-domain: Ludwig van Beethoven, d.1827',
    kind: 'duet',
    lesson: 3,
    meter: [4, 4],
    bpm: 84,
    melody: 'B3/1 B3/1 C4/1 D4/1 | D4/1 C4/1 B3/1 A3/1 | G3/1 G3/1 A3/1 B3/1 | B3/1.5 A3/0.5 A3/2 '
          + '| B3/1 B3/1 C4/1 D4/1 | D4/1 C4/1 B3/1 A3/1 | G3/1 G3/1 A3/1 B3/1 | A3/1.5 G3/0.5 G3/2',
    accomp: 'G2/4 | D3/4 | G2/2 C3/2 | D3/4 | G2/4 | D3/4 | G2/2 C3/2 | G2/4',
    why: 'The most recognisable eight bars in music, and it fits in six notes.',
  },

  // ---------------------------------------------------------------- lesson 4
  // F and G on the first string close the octave: G up to G, nothing missing.
  {
    id: 'lightly-row',
    title: 'Lightly Row',
    source: 'trad',
    kind: 'duet',
    lesson: 4,
    meter: [4, 4],
    bpm: 84,
    melody: 'G4/1 E4/1 E4/2 | F4/1 D4/1 D4/2 | C4/1 D4/1 E4/1 F4/1 | G4/1 G4/1 G4/2 '
          + '| G4/1 E4/1 E4/1 E4/1 | F4/1 D4/1 D4/1 D4/1 | C4/1 E4/1 G4/1 G4/1 | E4/1 C4/1 C4/2',
    accomp: 'C3/2 G2/2 | G2/2 D3/2 | C3/2 G2/2 | C3/2 G2/2 | C3/2 G2/2 | G2/2 D3/2 | C3/2 G2/2 | C3/4',
    why: 'The first tune that uses the whole octave, top to bottom, in one phrase.',
  },
];

const BY_ID = new Map(PIECES.map((p) => [p.id, p]));

export function pieceSpec(id) {
  return BY_ID.get(id) || null;
}

export function piecesForLesson(n) {
  return PIECES.filter((p) => p.lesson === n);
}
