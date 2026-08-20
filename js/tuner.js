// The tuner.
//
// Deliberately not the same code path as the reading drill's little needle. A
// drill must answer in tens of milliseconds and can be wrong occasionally; a
// tuner has all the time in the world and must not be wrong at all. So this
// reads a wider window, takes the median of a third of a second, and refuses to
// say "in tune" until the reading has held still.
//
// Everything here is pure arithmetic so it can be tested without an ear.

import { STANDARD_TUNING, hzToMidiFloat, midiToHz, noteName } from './theory.js';

/** Thickest to thinnest, the way a player counts them. */
export const STRING_ORDER = [6, 5, 4, 3, 2, 1];

// Five cents is about the limit of what this detector can honestly resolve on a
// plucked string, and comfortably below what an ear hears as out of tune. The
// app does not claim better than it can measure.
export const IN_TUNE_CENTS = 5;
// Beyond this the needle is red rather than amber; inside it, you are close.
export const CLOSE_CENTS = 20;

/** Distance in cents from one frequency to another. Positive means sharp. */
export function centsBetween(hz, targetHz) {
  return 1200 * Math.log2(hz / targetHz);
}

/**
 * Which open string is this, and how far off?
 *
 * Nearest by pitch distance, with no cut-off: a string a whole tone flat is
 * still that string, and a tuner that goes blank exactly when you need it most
 * is useless. The neighbouring strings are four or five semitones away, so the
 * nearest one stays unambiguous well past anything a player would call "flat".
 */
export function nearestString(hz, tuning = STANDARD_TUNING) {
  if (!(hz > 0)) return null;
  let best = null;
  for (const string of STRING_ORDER) {
    const midi = tuning[string];
    const cents = centsBetween(hz, midiToHz(midi));
    if (!best || Math.abs(cents) < Math.abs(best.cents)) {
      best = { string, midi, cents, targetHz: midiToHz(midi), note: noteName(midi) };
    }
  }
  return best;
}

/**
 * Nearest semitone of any note, for capos, dropped tunings and anything that is
 * not a guitar. `a4` lets the whole scale move for playing along with a
 * recording that sits off concert pitch.
 */
export function nearestChromatic(hz, a4 = 440) {
  if (!(hz > 0)) return null;
  const midi = Math.round(hzToMidiFloat(hz, a4));
  const targetHz = midiToHz(midi, a4);
  return { string: null, midi, cents: centsBetween(hz, targetHz), targetHz, note: noteName(midi) };
}

/** flat | sharp | in-tune, by the tolerance above. */
export function verdictFor(cents) {
  if (Math.abs(cents) <= IN_TUNE_CENTS) return 'in-tune';
  return cents < 0 ? 'flat' : 'sharp';
}

/**
 * Turns a stream of raw detections into one steady reading.
 *
 * Two jobs. The median over a short window kills the single-frame octave slips
 * that every pitch detector produces on a low string. The hold timer means the
 * green light only appears once the note has actually settled there, rather
 * than flashing as the needle sweeps through the centre on its way past.
 */
export class Tuner {
  constructor({ windowMs = 350, holdMs = 500, mode = 'guitar', a4 = 440, tuning = STANDARD_TUNING } = {}) {
    this.windowMs = windowMs;
    this.holdMs = holdMs;
    this.mode = mode;
    this.a4 = a4;
    this.tuning = tuning;
    this.reset();
  }

  reset() {
    this._frames = [];       // { hz, at }
    this._inTuneSince = 0;
    this.settled = new Set(); // strings that have held in tune this session
    this.last = null;
  }

  /** Forget the current note without losing which strings are already done. */
  clearNote() {
    this._frames = [];
    this._inTuneSince = 0;
    this.last = null;
  }

  /**
   * Feed one detection. `hz` null means silence.
   * Returns a reading, or null while there is nothing to show.
   */
  push(hz, atMs) {
    if (!(hz > 0)) {
      // Silence for longer than the window means the note is gone, not merely
      // quiet between frames.
      if (this._frames.length && atMs - this._frames[this._frames.length - 1].at > this.windowMs) {
        this.clearNote();
      }
      return this.last;
    }

    this._frames.push({ hz, at: atMs });
    while (this._frames.length && atMs - this._frames[0].at > this.windowMs) this._frames.shift();

    // An octave slip is one frame wide; three frames make a median meaningful.
    if (this._frames.length < 3) return this.last;

    const hzs = this._frames.map((f) => f.hz).sort((a, b) => a - b);
    const median = hzs[Math.floor(hzs.length / 2)];

    const match = this.mode === 'guitar'
      ? nearestString(median, this.tuning)
      : nearestChromatic(median, this.a4);
    if (!match) return this.last;

    const verdict = verdictFor(match.cents);
    if (verdict === 'in-tune') {
      if (!this._inTuneSince) this._inTuneSince = atMs;
    } else {
      this._inTuneSince = 0;
    }

    const held = this._inTuneSince ? atMs - this._inTuneSince : 0;
    const done = held >= this.holdMs;
    if (done && match.string) this.settled.add(match.string);

    this.last = { ...match, hz: median, verdict, held, done };
    return this.last;
  }
}

/**
 * Everything the display needs, decided here rather than in the DOM code.
 *
 * Kept pure on purpose: the drawing itself runs inside an animation frame, which
 * no test harness can reach, so the part that can be got wrong lives out here
 * where it can be checked.
 */
export function readingView(reading) {
  if (!reading) {
    return { note: '\u2014', cents: '\u2014', needlePct: 50, needleClass: 'tune-needle',
             verdictKey: null, verdictClass: 'tune-verdict', string: null };
  }
  const cents = Math.round(reading.cents);
  const abs = Math.abs(cents);
  const inTune = reading.verdict === 'in-tune';
  return {
    note: reading.note,
    // Signed, and always with the unit, so a glance cannot read -8 as a note name.
    cents: `${cents > 0 ? '+' : ''}${cents} \u00a2`,
    // Half the width is 50 cents; anything further just sits at the end.
    needlePct: 50 + Math.max(-50, Math.min(50, cents)),
    needleClass: 'tune-needle ' + (inTune ? 'in-tune' : abs <= CLOSE_CENTS ? 'near' : 'far'),
    // Which way to TURN, not which way the note is - that is the bit a beginner
    // gets backwards, and getting it backwards is how strings break.
    verdictKey: inTune
      ? (reading.done ? 'tools.inTuneHeld' : 'tools.inTune')
      : (reading.verdict === 'flat' ? 'tools.flat' : 'tools.sharp'),
    verdictClass: 'tune-verdict ' + (inTune ? 'good' : abs <= CLOSE_CENTS ? 'warn' : 'bad'),
    string: reading.string,
  };
}

/**
 * Tap tempo.
 *
 * Averages the gaps between recent taps rather than using only the last one, so
 * a single clumsy tap does not throw the tempo away. A long pause starts a new
 * count: you meant to re-tap, not to set 12 bpm.
 */
export function tapTempo(times, { maxGapMs = 2000, keep = 5, min = 30, max = 240 } = {}) {
  const recent = [];
  for (let i = times.length - 1; i > 0 && recent.length < keep; i--) {
    const gap = times[i] - times[i - 1];
    if (gap > maxGapMs || gap <= 0) break;
    recent.push(gap);
  }
  if (!recent.length) return null;
  const mean = recent.reduce((s, g) => s + g, 0) / recent.length;
  const bpm = Math.round(60000 / mean);
  return Math.min(max, Math.max(min, bpm));
}
