// Chords: what notes they are, and where the fingers go.
//
// Two separate questions, deliberately kept apart. What a chord IS is
// arithmetic - a root and a set of intervals - and is generated. Where you PUT
// your fingers is not arithmetic; it is a hundred years of what hands can
// comfortably reach, and it is a curated table. Guessing shapes from theory
// produces chords that are correct on paper and unplayable in the hand.
//
// Every shape in the table is checked against the arithmetic by the tests: the
// notes a shape actually sounds must be exactly the notes the chord name
// promises, no extras, nothing missing. A typo in the table fails the build
// rather than teaching someone the wrong chord.

import { STANDARD_TUNING, soundingAt, noteName, LETTER_SEMITONES, LETTERS } from './theory.js';

/** Interval sets from the root, in semitones. */
export const QUALITIES = {
  '':     { label: 'major',        intervals: [0, 4, 7] },
  'm':    { label: 'minor',        intervals: [0, 3, 7] },
  '7':    { label: 'dominant 7th', intervals: [0, 4, 7, 10] },
  'm7':   { label: 'minor 7th',    intervals: [0, 3, 7, 10] },
  'maj7': { label: 'major 7th',    intervals: [0, 4, 7, 11] },
  'sus2': { label: 'suspended 2nd', intervals: [0, 2, 7] },
  'sus4': { label: 'suspended 4th', intervals: [0, 5, 7] },
  'dim':  { label: 'diminished',   intervals: [0, 3, 6] },
};

/**
 * The order to offer qualities in - roughly the order a learner meets them.
 *
 * NOT Object.keys(QUALITIES): JavaScript hoists integer-like keys to the front,
 * so '7' would jump ahead of plain major and the row would open with a seventh.
 */
export const QUALITY_ORDER = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'dim'];

export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Accept B♭ and A♯ as the same thing without letting anything else through. */
const ENHARMONIC = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', 'Cb': 'B', 'Fb': 'E', 'E#': 'F', 'B#': 'C' };

/** Pitch class 0-11 of a root name, or null if it is not a note. */
export function rootPitchClass(name) {
  const n = ENHARMONIC[name] || name;
  const m = /^([A-G])([#b]?)$/.exec(n);
  if (!m) return null;
  const base = LETTER_SEMITONES[m[1]];
  if (base == null) return null;
  const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (base + shift + 12) % 12;
}

/** The pitch classes a chord is made of. */
export function chordPitchClasses(root, quality) {
  const pc = rootPitchClass(root);
  const q = QUALITIES[quality];
  if (pc == null || !q) return null;
  return q.intervals.map((i) => (pc + i) % 12);
}

// ------------------------------------------------------------------ shapes
//
// frets[0] is the SIXTH string (the thick one) through frets[5], the first.
// null means do not play that string; 0 means play it open.
// fingers uses the same order: 1 index, 2 middle, 3 ring, 4 little.

const shape = (frets, fingers, extra = {}) => ({ frets, fingers, barre: null, ...extra });

/**
 * Open-position shapes. These are the ones worth learning first and the only
 * ones that use the open strings, which is why they cannot be derived.
 */
export const OPEN_SHAPES = {
  'C':     [shape([null, 3, 2, 0, 1, 0], [null, 3, 2, null, 1, null])],
  'C7':    [shape([null, 3, 2, 3, 1, 0], [null, 3, 2, 4, 1, null])],
  'Cmaj7': [shape([null, 3, 2, 0, 0, 0], [null, 3, 2, null, null, null])],

  'D':     [shape([null, null, 0, 2, 3, 2], [null, null, null, 1, 3, 2])],
  'Dm':    [shape([null, null, 0, 2, 3, 1], [null, null, null, 2, 3, 1])],
  'D7':    [shape([null, null, 0, 2, 1, 2], [null, null, null, 2, 1, 3])],
  'Dm7':   [shape([null, null, 0, 2, 1, 1], [null, null, null, 2, 1, 1])],
  'Dmaj7': [shape([null, null, 0, 2, 2, 2], [null, null, null, 1, 2, 3])],
  'Dsus2': [shape([null, null, 0, 2, 3, 0], [null, null, null, 1, 2, null])],
  'Dsus4': [shape([null, null, 0, 2, 3, 3], [null, null, null, 1, 2, 3])],

  'E':     [shape([0, 2, 2, 1, 0, 0], [null, 2, 3, 1, null, null])],
  'Em':    [shape([0, 2, 2, 0, 0, 0], [null, 2, 3, null, null, null])],
  'E7':    [shape([0, 2, 0, 1, 0, 0], [null, 2, null, 1, null, null])],
  'Em7':   [shape([0, 2, 0, 0, 0, 0], [null, 2, null, null, null, null])],
  'Emaj7': [shape([0, 2, 1, 1, 0, 0], [null, 3, 1, 2, null, null])],
  'Esus4': [shape([0, 2, 2, 2, 0, 0], [null, 1, 2, 3, null, null])],

  'Fmaj7': [shape([null, null, 3, 2, 1, 0], [null, null, 3, 2, 1, null])],

  'G':     [shape([3, 2, 0, 0, 0, 3], [2, 1, null, null, null, 3])],
  'G7':    [shape([3, 2, 0, 0, 0, 1], [3, 2, null, null, null, 1])],
  'Gmaj7': [shape([3, 2, 0, 0, 0, 2], [3, 2, null, null, null, 1])],

  'A':     [shape([null, 0, 2, 2, 2, 0], [null, null, 1, 2, 3, null])],
  'Am':    [shape([null, 0, 2, 2, 1, 0], [null, null, 2, 3, 1, null])],
  'A7':    [shape([null, 0, 2, 0, 2, 0], [null, null, 2, null, 3, null])],
  'Am7':   [shape([null, 0, 2, 0, 1, 0], [null, null, 2, null, 1, null])],
  'Amaj7': [shape([null, 0, 2, 1, 2, 0], [null, null, 3, 1, 2, null])],
  'Asus2': [shape([null, 0, 2, 2, 0, 0], [null, null, 1, 2, null, null])],
  'Asus4': [shape([null, 0, 2, 2, 3, 0], [null, null, 1, 2, 3, null])],

  'B7':    [shape([null, 2, 1, 2, 0, 2], [null, 2, 1, 3, null, 4])],
};

/**
 * Movable barre shapes, given as the pattern relative to the barre fret and
 * which string carries the root. Slide one up the neck and the root moves with
 * it - that IS arithmetic, so these are generated rather than listed.
 */
const MOVABLE = [
  // Rooted on the sixth string: the E, Em, E7, Em7, Emaj7 shapes barred.
  { rootString: 6, quality: '',     offsets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1] },
  { rootString: 6, quality: 'm',    offsets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1] },
  { rootString: 6, quality: '7',    offsets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1] },
  { rootString: 6, quality: 'm7',   offsets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1] },
  { rootString: 6, quality: 'maj7', offsets: [0, 2, 1, 1, 0, 0], fingers: [1, 4, 2, 3, 1, 1] },
  { rootString: 6, quality: 'sus4', offsets: [0, 2, 2, 2, 0, 0], fingers: [1, 2, 3, 4, 1, 1] },
  // Rooted on the fifth string: the A, Am, A7, Am7, Amaj7 shapes barred.
  { rootString: 5, quality: '',     offsets: [null, 0, 2, 2, 2, 0], fingers: [null, 1, 3, 4, 4, 1] },
  { rootString: 5, quality: 'm',    offsets: [null, 0, 2, 2, 1, 0], fingers: [null, 1, 3, 4, 2, 1] },
  { rootString: 5, quality: '7',    offsets: [null, 0, 2, 0, 2, 0], fingers: [null, 1, 3, 1, 4, 1] },
  { rootString: 5, quality: 'm7',   offsets: [null, 0, 2, 0, 1, 0], fingers: [null, 1, 3, 1, 2, 1] },
  { rootString: 5, quality: 'maj7', offsets: [null, 0, 2, 1, 2, 0], fingers: [null, 1, 3, 2, 4, 1] },
  { rootString: 5, quality: 'sus4', offsets: [null, 0, 2, 2, 3, 0], fingers: [null, 1, 2, 3, 4, 1] },
];

/** Which string index in the arrays a string number occupies. 6 -> 0, 1 -> 5. */
const idxOf = (string) => 6 - string;

/** The SOUNDING pitches a shape produces, low to high. */
export function shapeNotes(shape, tuning = STANDARD_TUNING) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const fret = shape.frets[i];
    if (fret == null) continue;
    out.push(soundingAt(6 - i, fret, tuning));
  }
  return out;
}

/** Distinct pitch classes a shape sounds. */
export function shapePitchClasses(shape, tuning = STANDARD_TUNING) {
  return [...new Set(shapeNotes(shape, tuning).map((m) => m % 12))].sort((a, b) => a - b);
}

/** How far up the neck a shape sits; 0 for an open shape. */
export function lowestFret(shape) {
  const fretted = shape.frets.filter((f) => f != null && f > 0);
  return fretted.length ? Math.min(...fretted) : 0;
}

/**
 * Every shape we know for a chord, easiest first.
 *
 * "Easiest" means open shapes before barres, and lower up the neck before
 * higher - which is what a beginner wants and roughly what a hand wants too.
 */
export function shapesFor(root, quality = '', { maxFret = 12, tuning = STANDARD_TUNING } = {}) {
  const pc = rootPitchClass(root);
  if (pc == null || !QUALITIES[quality]) return [];

  const canonical = ROOTS[pc];
  const out = [];

  for (const s of OPEN_SHAPES[`${canonical}${quality}`] || []) out.push({ ...s, open: true });

  for (const m of MOVABLE) {
    if (m.quality !== quality) continue;
    // The barre fret is wherever it puts the root on that string.
    const openRoot = tuning[m.rootString] % 12;
    let barreFret = (pc - openRoot + 12) % 12;
    // Fret 0 would be the open shape, which is already in the table above.
    if (barreFret === 0) barreFret = 12;
    const top = barreFret + Math.max(...m.offsets.filter((o) => o != null));
    if (top > maxFret) continue;
    out.push({
      frets: m.offsets.map((o) => (o == null ? null : o + barreFret)),
      fingers: m.fingers.slice(),
      barre: { fret: barreFret, rootString: m.rootString },
      open: false,
    });
  }

  return out.sort((a, b) => (a.open === b.open ? lowestFret(a) - lowestFret(b) : a.open ? -1 : 1));
}

/** "Am7" -> { root: 'A', quality: 'm7' }, or null. Longest quality wins. */
export function parseChordName(name) {
  if (typeof name !== 'string') return null;
  const m = /^([A-G][#b]?)(.*)$/.exec(name.trim());
  if (!m) return null;
  const root = m[1];
  if (rootPitchClass(root) == null) return null;
  const rest = m[2];
  // Alias the spellings people actually type for the same quality.
  const alias = { M7: 'maj7', 'Δ': 'maj7', min: 'm', min7: 'm7', maj: '', 'M': '', '°': 'dim', o: 'dim' };
  const quality = rest in QUALITIES ? rest : (alias[rest] ?? null);
  if (quality == null) return null;
  return { root, quality };
}

/** Display name, always spelled the way the roots list spells it. */
export function chordName(root, quality = '') {
  const pc = rootPitchClass(root);
  if (pc == null) return null;
  return `${ROOTS[pc]}${quality}`;
}

/** The chords worth offering, in an order a learner meets them. */
export function chordCatalogue() {
  const out = [];
  for (const root of ROOTS) {
    for (const quality of QUALITY_ORDER) {
      if (!shapesFor(root, quality).length) continue;
      out.push({ root, quality, name: `${root}${quality}` });
    }
  }
  return out;
}

/** Note names of a chord's tones, for showing under the diagram. */
export function chordToneNames(root, quality) {
  const pcs = chordPitchClasses(root, quality);
  if (!pcs) return [];
  // Name them from the root upward so the root reads first, not C first.
  return pcs.map((pc) => noteName(60 + pc).replace(/\d+$/, ''));
}

export { LETTERS };
