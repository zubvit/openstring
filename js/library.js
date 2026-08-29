// The music that ships with the app.
//
// Every melody here is playable with ONLY the notes its lesson has already
// taught - not its stage, its LESSON, which is narrower. That is the whole
// discipline of the file: one out-of-range note recreates the cliff this course
// was rebuilt to remove, because a piece he cannot play teaches him that the app
// lies about what he is ready for. test/library.test.mjs checks every note of
// every tune against its lesson's cumulative set, so this cannot rot.
//
// LICENCE. This project is MIT and public, so nothing copyrighted goes in here.
// Every item is one of three things, and says which in `source`:
//   'trad'                        - a traditional melody, public domain
//   'public-domain: X, d. YEAR'   - a named composer dead well over 70 years
//   'original'                    - written for this app
// The sequence these sit in follows how classical guitar methods have ordered
// things for two centuries, which is a method and not a text; no method book's
// words, arrangements or original exercises are reproduced.
//
// Folk tunes are transposed to whatever key fits the lesson. That is not a
// liberty - it is exactly what method books do, and it is the only way a real
// tune can appear before the whole octave is learned. Two tunes that would have
// fitted (When the Saints, Amazing Grace) are deliberately absent: their later
// phrases could not be reconstructed note-perfectly from memory, and a tune with
// one wrong note is worse here than no tune at all. Add them from a checked
// source, not from recollection.
//
// `melody` is his part; `accomp` is the app's, and has no note-set limit because
// he never plays it. Durations are quarter-note beats. See js/tune.js.

export const PIECES = [

  // ------------------------------------------------------------ lesson 1 
  // Two open strings, G and B. A tune is impossible on two notes, so these lean
  // entirely on the accompaniment: his part is plain and the music happens
  // underneath it. That is the oldest trick in the method book, and it is why a
  // first sitting can end in something worth hearing.
  {
    id: 'evening-bells',
    title: 'Evening Bells',
    source: 'original',
    kind: 'duet',
    lesson: 1,
    meter: [4,4],
    bpm: 60,
    melody: 'B3/2 B3/2 | G3/2 G3/2 | B3 B3 G3 G3 | B3/2 G3/2 | B3/2 B3/2 | G3/2 G3/2 '
          + '| B3 G3 B3 G3 | G3/4',
    accomp: 'E2/2 B2/2 | C3/2 G2/2 | E2 B2 C3 G2 | D3/2 G2/2 | E2/2 B2/2 | C3/2 G2/2 '
          + '| E2 C3 D3/2 | G2/4',
    why: 'Two notes, but the bass line underneath moves Em-C-G so the same two '
       + 'notes change meaning every bar - the first sitting already ends in '
       + 'music.',
  },
  {
    id: 'cuckoo-in-the-pines',
    title: 'Cuckoo in the Pines',
    source: 'original',
    kind: 'duet',
    lesson: 1,
    meter: [3,4],
    bpm: 66,
    melody: 'B3 G3 r | B3 G3 r | B3 B3 G3 | G3/3 | B3 G3 r | B3 G3 r | B3 B3 B3 | G3/3',
    accomp: 'G2/3 | E2/3 | C3/3 | D3/3 | G2/3 | E2/3 | D3/3 | G2/3',
    why: 'B-to-G is the cuckoo\'s falling third; also his first 3/4 bar and his '
       + 'first written rests, on material his fingers cannot fumble.',
  },

  // ------------------------------------------------------------ lesson 2 
  {
    id: 'three-lanterns',
    title: 'Three Lanterns',
    source: 'original',
    kind: 'tune',
    lesson: 2,
    meter: [4,4],
    bpm: 63,
    melody: 'E4/2 B3/2 | G3/4 | E4/2 B3/2 | G3/4 | E4 E4 B3 B3 | G3 G3 B3/2 | E4/2 B3/2 | E4/4',
    accomp: 'E2/4 | C3/4 | E2/4 | C3/4 | A2/4 | E2/2 B2/2 | C3/2 B2/2 | E2/4',
    why: 'The three landmarks are an E-minor arpeggio; descending through all '
       + 'three strings drills the string-crossing the note drill never asks for.',
  },
  {
    id: 'starlight',
    title: 'Starlight',
    source: 'original',
    kind: 'duet',
    lesson: 2,
    meter: [3,4],
    bpm: 69,
    melody: 'E4/2 B3 | G3/2 B3 | E4 B3 G3 | B3/3 | E4/2 B3 | G3/2 B3 | G3 B3 E4 | E4/3',
    accomp: 'E2/3 | E2/3 | C3/3 | B2/3 | A2/3 | C3/3 | B2/3 | E2/3',
    why: 'Same three notes, opposite direction at the end - reading the contour, '
       + 'not memorising the order.',
  },

  // ------------------------------------------------------------ lesson 3 
  // The first fingered note - and the exact moment a real tune becomes possible.
  // Hot Cross Buns needs only the top three degrees of a scale.
  {
    id: 'hot-cross-buns',
    title: 'Hot Cross Buns',
    source: 'trad',
    kind: 'duet',
    lesson: 3,
    meter: [4,4],
    bpm: 72,
    melody: 'B3 A3 G3/2 | B3 A3 G3/2 '
          + '| G3/0.5 G3/0.5 G3/0.5 G3/0.5 A3/0.5 A3/0.5 A3/0.5 A3/0.5 | B3 A3 G3/2',
    accomp: 'G2/2 D3/2 | G2/2 D3/2 | G2/2 D3/2 | G2 D3 G2/2',
    why: 'The canonical first three-note tune (mi-re-do), transposed so do = his '
       + 'open G; the new A sits between two notes he already owns. The '
       + 'eighth-note bar is slow enough at 72 to be graded cleanly.',
  },
  {
    id: 'au-clair-de-la-lune',
    title: 'Au Clair de la Lune',
    source: 'trad',
    kind: 'tune',
    lesson: 3,
    meter: [4,4],
    bpm: 69,
    melody: 'G3 G3 G3 A3 | B3/2 A3/2 | G3 B3 A3 A3 | G3/4 | G3 G3 G3 A3 | B3/2 A3/2 '
          + '| G3 B3 A3 A3 | G3/4',
    accomp: 'G2/2 B2/2 | G2/2 D3/2 | E2/2 D3/2 | G2/4 | G2/2 B2/2 | G2/2 D3/2 | E2/2 D3/2 | G2/4',
    why: 'A real, nameable melody on exactly three notes - proof on day three that '
       + 'the note-set he owns is already enough for music. (A-phrase only; the '
       + 'middle section needs notes he does not have yet.)',
  },

  // ------------------------------------------------------------ lesson 4 
  {
    id: 'shchedryk',
    title: 'Shchedryk (Carol of the Bells)',
    source: 'public-domain: Mykola Leontovych, d. 1921 (ostinato from the traditional shchedrivka)',
    kind: 'duet',
    lesson: 4,
    meter: [3,4],
    bpm: 80,
    melody: 'C4 B3/0.5 C4/0.5 A3 | C4 B3/0.5 C4/0.5 A3 | C4 B3/0.5 C4/0.5 A3 '
          + '| C4 B3/0.5 C4/0.5 A3 | C4 B3/0.5 C4/0.5 A3 | C4 B3/0.5 C4/0.5 A3 '
          + '| C4 B3/0.5 C4/0.5 A3 | C4 B3/0.5 C4/0.5 A3',
    accomp: 'A2/3 | A2/3 | G2/3 | G2/3 | F2/3 | F2/3 | E2/3 | E2/3',
    why: 'The four-note ostinato IS the piece; the app\'s descending bass turns '
       + 'eight identical bars into the most impressive-sounding thing he has '
       + 'played, and the new C4 leans on B3, teaching the first-fret semitone by '
       + 'ear and eye at once. One repeating bar to read, huge musical return.',
  },
  {
    id: 'quiet-steps',
    title: 'Quiet Steps',
    source: 'original',
    kind: 'tune',
    lesson: 4,
    meter: [4,4],
    bpm: 66,
    melody: 'C4 C4 B3 A3 | G3/2 A3/2 | B3 B3 C4 C4 | B3/4 | C4 C4 B3 A3 | G3/2 E4/2 '
          + '| C4 B3 A3 B3 | G3/4',
    accomp: 'A2/4 | E2/4 | G2/2 A2/2 | E2/4 | A2/4 | C3/4 | A2/2 D3/2 | G2/4',
    why: 'C4 read in stepwise context both ways, plus one deliberate leap to the '
       + 'old landmark E4 so the top space stays alive.',
  },

  // ------------------------------------------------------------ lesson 5 
  // Five notes, and the folk repertoire opens up properly.
  {
    id: 'mary-had-a-little-lamb',
    title: 'Mary Had a Little Lamb',
    source: 'trad',
    kind: 'tune',
    lesson: 5,
    meter: [4,4],
    bpm: 76,
    melody: 'B3 A3 G3 A3 | B3 B3 B3/2 | A3 A3 A3/2 | B3 D4 D4/2 | B3 A3 G3 A3 | B3 B3 B3 B3 '
          + '| A3 A3 B3 A3 | G3/4',
    accomp: 'G2/2 D3/2 | G2/2 B2/2 | D3/2 A2/2 | G2/2 B2/2 | G2/2 D3/2 | G2/2 B2/2 | D3/4 | G2/4',
    why: 'The new D4 arrives in exactly one place (bar 4) inside a tune he can '
       + 'sing - the eye learns the third-fret spot from a phrase, not a '
       + 'flashcard.',
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    source: 'public-domain: Ludwig van Beethoven, d. 1827',
    kind: 'duet',
    lesson: 5,
    meter: [4,4],
    bpm: 72,
    melody: 'B3 B3 C4 D4 | D4 C4 B3 A3 | G3 G3 A3 B3 | B3/1.5 A3/0.5 A3/2 | B3 B3 C4 D4 '
          + '| D4 C4 B3 A3 | G3 G3 A3 B3 | A3/1.5 G3/0.5 G3/2',
    accomp: 'G2/2 B2/2 | D3/4 | G2/2 B2/2 | A2/2 D3/2 | G2/2 B2/2 | D3/4 | G2/2 D3/2 | D3/2 G2/2',
    why: 'The five-note set is complete and this is the five-note piece: stepwise, '
       + 'world-famous, and it carries the lesson\'s one dotted rhythm (prepared by '
       + 'the rhythm step). Returns twice later in other octaves.',
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells (chorus)',
    source: 'public-domain: James Lord Pierpont, d. 1893',
    kind: 'ear',
    lesson: 5,
    meter: [4,4],
    bpm: 92,
    melody: 'B3 B3 B3/2 | B3 B3 B3/2 | B3 D4 G3/1.5 A3/0.5 | B3/4 | C4 C4 C4/1.5 C4/0.5 '
          + '| C4 B3 B3 B3/0.5 B3/0.5 | B3 A3 A3 B3 | A3/2 D4/2 | B3 B3 B3/2 | B3 B3 B3/2 '
          + '| B3 D4 G3/1.5 A3/0.5 | B3/4 | C4 C4 C4/1.5 C4/0.5 | C4 B3 B3 B3/0.5 B3/0.5 '
          + '| D4 D4 C4 A3 | G3/2 r/2',
    accomp: 'G2/2 D3/2 | G2/2 D3/2 | G2/2 D3/2 | G2/2 D3/2 | C3/2 G2/2 | G2/2 D3/2 '
          + '| D3/2 D3/2 | D3/2 D3/2 | G2/2 D3/2 | G2/2 D3/2 | G2/2 D3/2 | G2/2 D3/2 '
          + '| C3/2 G2/2 | G2/2 D3/2 | D3/4 | G2/4',
    why: 'The first "above reading level" piece: same positions his hands know, '
       + 'but 16 bars at 92 with dotted figures - learned by copying the app, '
       + 'staff hidden. Proof that he can play more than he can read.',
  },

  // ------------------------------------------------------------ lesson 6 
  {
    id: 'april-air',
    title: 'April Air',
    source: 'original',
    kind: 'duet',
    lesson: 6,
    meter: [3,4],
    bpm: 69,
    melody: 'E4/2 F4 | E4/2 C4 | D4 E4 F4 | E4/3 | F4/2 E4 | D4/2 C4 | B3 C4 D4 | C4/3',
    accomp: 'C3/3 | A2/3 | D3/3 | C3/3 | D3/3 | G2/3 | G2/3 | C3/3',
    why: 'F4 always resolving onto E4 - the first-string semitone taught as a '
       + 'leaning note, which is what fa actually does in music.',
  },
  {
    id: 'the-half-step',
    title: 'The Half Step',
    source: 'original',
    kind: 'study',
    lesson: 6,
    meter: [4,4],
    bpm: 72,
    melody: 'E4 F4 E4 F4 | E4/2 D4/2 | F4 E4 D4 E4 | C4/4 | F4 F4 E4 D4 | E4/2 C4/2 '
          + '| D4 D4 C4 B3 | C4/4',
    accomp: 'C3/2 G2/2 | G2/2 B2/2 | D3/2 C3/2 | C3/4 | D3/2 B2/2 | C3/2 A2/2 | G2/2 G2/2 | C3/4',
    why: 'E-F on the page looks like every other step but sounds half the size; '
       + 'this drills seeing the pair fast in both directions. (Both L6 items are '
       + 'original by necessity: real tunes that use fa almost always use sol, '
       + 'which is next lesson - that gap is one lesson wide and this is the '
       + 'honest price.)',
  },

  // ------------------------------------------------------------ lesson 7 
  // The octave closes: G at the bottom, G at the top, nothing missing between.
  {
    id: 'ode-to-joy-in-c',
    title: 'Ode to Joy, up high',
    source: 'public-domain: Ludwig van Beethoven, d. 1827',
    kind: 'duet',
    lesson: 7,
    meter: [4,4],
    bpm: 76,
    melody: 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/1.5 D4/0.5 D4/2 | E4 E4 F4 G4 '
          + '| G4 F4 E4 D4 | C4 C4 D4 E4 | D4/1.5 C4/0.5 C4/2',
    accomp: 'C3/2 E3/2 | G2/4 | C3/2 E3/2 | G2/2 G2/2 | C3/2 E3/2 | G2/4 | C3/2 G2/2 | G2/2 C3/2',
    why: 'The same tune he mastered at L5, one string higher: the ear already '
       + 'knows every note, so all attention goes to the new staff positions - and '
       + 'it lands the new G4 four times a phrase.',
  },
  {
    id: 'lightly-row',
    title: 'Lightly Row',
    source: 'trad',
    kind: 'tune',
    lesson: 7,
    meter: [4,4],
    bpm: 76,
    melody: 'G4 E4 E4/2 | F4 D4 D4/2 | C4 D4 E4 F4 | G4 G4 G4/2 | G4 E4 E4/2 | F4 D4 D4/2 '
          + '| C4 E4 G4 G4 | C4/2 r/2 | D4 D4 D4 D4 | D4 E4 F4/2 | E4 E4 E4 E4 | E4 F4 G4/2 '
          + '| G4 E4 E4/2 | F4 D4 D4/2 | C4 E4 G4 G4 | C4/2 r/2',
    accomp: 'C3/2 G2/2 | G2/2 B2/2 | C3/2 G2/2 | C3/2 E3/2 | C3/2 G2/2 | G2/2 B2/2 '
          + '| C3/2 G2/2 | C3/2 G2/2 | G2/4 | G2/2 B2/2 | C3/4 | C3/2 E3/2 | C3/2 G2/2 '
          + '| G2/2 B2/2 | C3/2 G2/2 | C3/4',
    why: 'The classic first-position five-finger tune, 16 bars - his longest read '
       + 'yet, entirely inside the octave he has just completed.',
  },

  // ------------------------------------------------------------ lesson 8 
  // The first note below the staff, on its own ledger line.
  {
    id: 'frere-jacques',
    title: 'Frere Jacques',
    source: 'trad',
    kind: 'duet',
    lesson: 8,
    meter: [4,4],
    bpm: 76,
    melody: 'G3 A3 B3 G3 | G3 A3 B3 G3 | B3 C4 D4/2 | B3 C4 D4/2 '
          + '| D4/0.5 E4/0.5 D4/0.5 C4/0.5 B3 G3 | D4/0.5 E4/0.5 D4/0.5 C4/0.5 B3 G3 '
          + '| G3 D3 G3/2 | G3 D3 G3/2',
    accomp: 'r/4 | r/4 | G3 A3 B3 G3 | G3 A3 B3 G3 | B3 C4 D4/2 | B3 C4 D4/2 '
          + '| D4/0.5 E4/0.5 D4/0.5 C4/0.5 B3 G3 | G2 D3 G2/2',
    why: 'The new ledger-line D3 is the "ding dang dong" - three notes, '
       + 'unmissable. And the app enters two bars behind him: his first round, '
       + 'which only a machine partner makes possible alone.',
  },
  {
    id: 'deep-river-bells',
    title: 'Deep River Bells',
    source: 'original',
    kind: 'tune',
    lesson: 8,
    meter: [4,4],
    bpm: 69,
    melody: 'D3 D3 G3/2 | D3 D3 A3/2 | G3 A3 B3 G3 | D3/4 | D3 D3 G3/2 | D3 D3 B3/2 '
          + '| B3 A3 G3 A3 | G3/2 D3/2',
    accomp: 'G2/4 | A2/4 | G2/4 | A2/2 D3/2 | G2/4 | G2/4 | D3/4 | G2/4',
    why: 'D3 as a repeated anchor the phrase keeps returning to - the eye learns '
       + 'the first ledger line as home, not as an exception.',
  },

  // ------------------------------------------------------------ lesson 9 
  {
    id: 'the-foundation',
    title: 'The Foundation',
    source: 'original',
    kind: 'duet',
    lesson: 9,
    meter: [4,4],
    bpm: 63,
    melody: 'E2/4 | A2/4 | D3/4 | G3/4 | E2/4 | A2/4 | D3/2 A2/2 | G3/4',
    accomp: 'E4/2 B3/2 | C4/2 A3/2 | D4/2 A3/2 | B3/2 G3/2 | E4/2 B3/2 | C4/2 A3/2 '
          + '| D4/2 C4/2 | B3/4',
    why: 'Role reversal: HE is the bass and the app sings the tune. One whole note '
       + 'a bar - all the difficulty is the ledger lines - and he hears why bass '
       + 'parts matter, which is the honest introduction to the bottom of the '
       + 'instrument.',
  },
  {
    id: 'six-open-strings',
    title: 'Six Open Strings',
    source: 'original',
    kind: 'study',
    lesson: 9,
    meter: [4,4],
    bpm: 66,
    melody: 'E2 A2 D3 G3 | B3 E4 B3 G3 | D3 A2 E2 A2 | D3/2 G3/2 | E2 A2 D3 G3 | B3 E4 E4/2 '
          + '| B3 G3 D3 A2 | E2/4',
    why: 'Every open string, no fingers at all: pure string-crossing plus reading '
       + 'across the staff\'s whole height, from two ledger lines below to the top '
       + 'space.',
  },

  // ----------------------------------------------------------- lesson 10 
  // Fingers on the bass strings; the bottom half starts working like the top.
  {
    id: 'old-macdonald',
    title: 'Old MacDonald',
    source: 'trad',
    kind: 'duet',
    lesson: 10,
    meter: [4,4],
    bpm: 80,
    melody: 'G3 G3 G3 D3 | E3 E3 D3/2 | B3 B3 A3 A3 | G3/2 r D3 | G3 G3 G3 D3 | E3 E3 D3/2 '
          + '| B3 B3 A3 A3 | G3/2 r/2',
    accomp: 'G2/2 D3/2 | C3/2 G2/2 | D3/4 | G2/2 D3/2 | G2/2 D3/2 | C3/2 G2/2 | D3/4 | G2/4',
    why: '"E-I-E-I-O" hangs on the new E3 - a note he cannot miss hearing wrong - '
       + 'and the tune crosses between bass and treble registers inside one '
       + 'phrase.',
  },
  {
    id: 'the-fourth-string-song',
    title: 'The Fourth String Song',
    source: 'original',
    kind: 'tune',
    lesson: 10,
    meter: [4,4],
    bpm: 69,
    melody: 'E3 F3 G3 E3 | F3/2 D3/2 | E3 F3 G3 G3 | E3/4 | F3 F3 E3 E3 | D3/2 F3/2 '
          + '| F3 E3 D3 D3 | E3/4',
    accomp: 'C3/4 | G2/4 | C3/4 | A2/4 | D3/2 C3/2 | G2/4 | D3/2 G2/2 | A2/4',
    why: 'E3-F3 is the same semitone story as C4 and F4 were, one string down; the '
       + 'melody lives entirely in the new low register so the ledger lines get a '
       + 'full piece of their own.',
  },

  // ----------------------------------------------------------- lesson 11 
  {
    id: 'joy-descending',
    title: 'Joy Descending',
    source: 'public-domain: Lowell Mason, d. 1872 (opening phrase of "Antioch"; answering phrase original)',
    kind: 'study',
    lesson: 11,
    meter: [4,4],
    bpm: 69,
    melody: 'C4 B3/0.75 A3/0.25 G3/1.5 F3/0.5 | E3 D3 C3/2 | C3 D3 E3 F3 | G3/2 G3/2 '
          + '| C4 B3/0.75 A3/0.25 G3/1.5 F3/0.5 | E3 D3 C3/2 | F3 E3 D3 D3 | C3/4',
    accomp: 'C3/4 | G2/4 | C3/4 | G2/4 | C3/4 | G2/4 | G2/4 | C3/4',
    why: 'Joy to the World\'s famous opening is a full octave scale downward, C4 to '
       + 'the brand-new C3 - eight notes, eight staff positions, one recognisable '
       + 'gesture.',
  },
  {
    id: 'walking-home',
    title: 'Walking Home',
    source: 'original',
    kind: 'duet',
    lesson: 11,
    meter: [4,4],
    bpm: 72,
    melody: 'A2 B2 C3 D3 | E3/2 D3/2 | C3 B2 A2 B2 | C3/4 | A2 B2 C3 D3 | E3/2 C3/2 '
          + '| D3 C3 B2 B2 | A2/4',
    accomp: 'E4/4 | B3/4 | A3/4 | C4/2 E4/2 | E4/4 | A3/4 | G3/4 | A3/2 E4/2',
    why: 'A walking bass line through the new B2 and C3 while the app holds long '
       + 'notes above - he plays the moving part and hears the harmony change '
       + 'under his own fingers.',
  },

  // ----------------------------------------------------------- lesson 12 
  {
    id: 'ode-in-the-bass',
    title: 'Ode to Joy, down low',
    source: 'public-domain: Ludwig van Beethoven, d. 1827',
    kind: 'duet',
    lesson: 12,
    meter: [4,4],
    bpm: 69,
    melody: 'B2 B2 C3 D3 | D3 C3 B2 A2 | G2 G2 A2 B2 | B2/1.5 A2/0.5 A2/2 | B2 B2 C3 D3 '
          + '| D3 C3 B2 A2 | G2 G2 A2 B2 | A2/1.5 G2/0.5 G2/2',
    accomp: 'G3/2 B3/2 | D4/4 | G3/2 B3/2 | A3/2 D4/2 | G3/2 B3/2 | D4/4 | G3/2 D4/2 | D4/2 G3/2',
    why: 'Third visit to the same tune, now two ledger lines under the staff with '
       + 'the app chiming above - the new G2 anchors the phrase, and the whole low '
       + 'register is read with an ear that already knows the answer.',
  },
  {
    id: 'old-bear',
    title: 'Old Bear',
    source: 'original',
    kind: 'study',
    lesson: 12,
    meter: [4,4],
    bpm: 66,
    melody: 'E2 F2 G2 E2 | F2/2 G2/2 | A2 G2 F2 E2 | G2/4 | E2 F2 G2 A2 | G2/2 F2/2 '
          + '| G2 F2 E2 E2 | E2/4',
    why: 'The lowest four notes on the instrument as a growling little character '
       + 'piece - F2\'s first fret and G2\'s third fret in every combination.',
  },

  // ----------------------------------------------------------- lesson 13 
  // The whole of open position. Nothing new - everything at once.
  {
    id: 'frere-jacques-in-c',
    title: 'Frere Jacques in the Bass',
    source: 'trad',
    kind: 'duet',
    lesson: 13,
    meter: [4,4],
    bpm: 76,
    melody: 'C3 D3 E3 C3 | C3 D3 E3 C3 | E3 F3 G3/2 | E3 F3 G3/2 '
          + '| G3/0.5 A3/0.5 G3/0.5 F3/0.5 E3 C3 | G3/0.5 A3/0.5 G3/0.5 F3/0.5 E3 C3 '
          + '| C3 G2 C3/2 | C3 G2 C3/2',
    accomp: 'r/4 | r/4 | C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4/2 | E4 F4 G4/2 '
          + '| G4/0.5 A4/0.5 G4/0.5 F4/0.5 E4 C4 | C4 G3 C4/2',
    why: 'The round he played at L8, an octave-and-more lower, with the app '
       + 'answering an octave above: the full-circle proof that the whole staff '
       + 'now reads the same.',
  },
  {
    id: 'the-whole-house',
    title: 'The Whole House',
    source: 'original',
    kind: 'tune',
    lesson: 13,
    meter: [4,4],
    bpm: 72,
    melody: 'G3 A3 B3 C4 | D4/2 B3/2 | G3 F3 E3 D3 | C3/2 E3/2 | D3 E3 F3 G3 | A3/2 F3/2 '
          + '| D3 B2 G2 B2 | C3/4',
    accomp: 'G2/4 | G3/4 | G2/4 | A2/4 | G2/4 | D3/4 | G2/4 | G3/4',
    why: 'One melody that walks through eleven of the seventeen open-position '
       + 'naturals, top of the staff to below it - the graduation read for the '
       + 'whole stage.',
  },
];

const BY_ID = new Map(PIECES.map((p) => [p.id, p]));

export function pieceSpec(id) {
  return BY_ID.get(id) || null;
}

export function piecesForLesson(n) {
  return PIECES.filter((p) => p.lesson === n);
}
