// Reading a chord off the staff.
//
// The microphone hears one note at a time, so a strummed chord cannot be
// graded - and pretending otherwise would be the same dishonesty this app
// refuses everywhere else. So the drill asks for the chord ARPEGGIATED, lowest
// string upward. That is not a workaround dressed up as a feature: playing a
// chord one string at a time is how you check you have actually fingered it,
// and every teacher asks for it. It is also the only version of this that can
// be judged truthfully.
//
// What is new here, and what Nootka cannot do, is reading several notes at
// once off the staff. Everything in this file is pure so it can be tested.

import { pickNext, updateStat, emptyStat, isFluent } from './srs.js';
import { shapesFor, shapeNotes, parseChordName, chordName } from './chords.js';
import { soundingToWritten } from './theory.js';

/**
 * The chords worth reading first: the open shapes a beginner actually meets,
 * in roughly the order they turn up. Barres are deliberately absent - this is
 * a reading drill, and a chord you cannot yet hold teaches nothing about
 * reading it.
 */
export const DRILL_POOL = [
  'Em', 'Am', 'E', 'C', 'G', 'D', 'Dm', 'A',
  'E7', 'A7', 'D7', 'G7', 'Em7', 'Am7', 'Dm7', 'Cmaj7',
];

/** Everything the drill needs about one chord, or null if we have no shape. */
export function targetFor(name) {
  const parsed = parseChordName(name);
  if (!parsed) return null;
  const shape = shapesFor(parsed.root, parsed.quality)[0];
  if (!shape) return null;
  const sounding = shapeNotes(shape);           // already low to high
  return {
    name: chordName(parsed.root, parsed.quality),
    shape,
    sounding,
    written: sounding.map(soundingToWritten),
  };
}

/**
 * What a played note is, relative to the note being waited for.
 *
 * "octave" is called out separately because it is the mistake worth naming: on
 * a guitar the same note lives in several places, and hitting the right note on
 * the wrong string is a different error from playing the wrong note.
 */
export function gradeNote(expectedMidi, playedMidi) {
  if (playedMidi === expectedMidi) return 'right';
  if (playedMidi != null && (playedMidi - expectedMidi) % 12 === 0) return 'octave';
  return 'wrong';
}

/**
 * One attempt at one chord: feed it notes, it tells you where you are.
 *
 * A wrong note does not advance. You are meant to fix it and play it again -
 * moving on would teach that a wrong note is fine as long as you keep going.
 */
export class ChordAttempt {
  constructor(target) {
    this.target = target;
    this.index = 0;
    this.errors = 0;
    this.clean = true;      // no wrong notes at all
    this.states = {};       // notehead index -> 'correct' | 'wrong'
    this.done = false;
  }

  get expected() {
    return this.done ? null : this.target.sounding[this.index];
  }

  /** Returns { verdict, index, done } - verdict is right | octave | wrong. */
  play(playedMidi) {
    if (this.done) return { verdict: 'right', index: this.index, done: true };
    const verdict = gradeNote(this.expected, playedMidi);

    if (verdict === 'right') {
      this.states[this.index] = 'correct';
      this.index += 1;
      if (this.index >= this.target.sounding.length) this.done = true;
    } else {
      this.errors += 1;
      this.clean = false;
      this.states[this.index] = 'wrong';
    }
    return { verdict, index: this.index, done: this.done };
  }
}

const STORE_KEY = 'openstring.chords.v1';

/**
 * How often each chord comes up.
 *
 * The same scheduler the note drill uses, pointed at a different set of things
 * to know. Kept in its own store so chord practice cannot distort the
 * fretboard statistics the reading drill is built on - they are separate
 * skills and mixing their numbers would make both readings meaningless.
 */
export class ChordProgress {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.stats = {};
    try {
      const raw = this.storage?.getItem(STORE_KEY);
      if (raw) this.stats = JSON.parse(raw) || {};
    } catch { this.stats = {}; }
  }

  save() {
    try { this.storage?.setItem(STORE_KEY, JSON.stringify(this.stats)); } catch { /* fine without */ }
  }

  record(name, { correct, ms, now = Date.now() }) {
    this.stats[name] = updateStat(this.stats[name] || emptyStat(), { correct, ms, now });
    this.save();
  }

  next({ avoid = null, pool = DRILL_POOL, now = Date.now(), random = Math.random } = {}) {
    return pickNext(pool, this.stats, { avoid, now, random });
  }

  fluentCount(pool = DRILL_POOL) {
    return pool.filter((n) => this.stats[n] && isFluent(this.stats[n])).length;
  }

  reset() {
    this.stats = {};
    this.save();
  }
}
