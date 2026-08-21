import assert from 'node:assert/strict';
import {
  centsBetween, nearestString, nearestChromatic, verdictFor, Tuner, tapTempo,
  STRING_ORDER, IN_TUNE_CENTS, readingView, stringTarget, foldOctaves,
} from '../js/tuner.js';
import { STANDARD_TUNING, midiToHz } from '../js/theory.js';
import { detectPitch } from '../js/pitch.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// ------------------------------------------------------------------ cents

t('an octave is twelve hundred cents, either way', () => {
  assert.equal(Math.round(centsBetween(880, 440)), 1200);
  assert.equal(Math.round(centsBetween(220, 440)), -1200);
  assert.equal(Math.round(centsBetween(440, 440)), 0);
});

// ---------------------------------------------------------------- strings

t('every open string is recognised from its own frequency', () => {
  for (const s of STRING_ORDER) {
    const hz = midiToHz(STANDARD_TUNING[s]);
    const m = nearestString(hz);
    assert.equal(m.string, s, `string ${s} at ${hz.toFixed(2)} Hz`);
    assert.ok(Math.abs(m.cents) < 0.001);
  }
});

// The bug this whole app has to keep dodging: a guitar sounds an octave BELOW
// what is written. The tuner works in what you HEAR, so the low string is E2 at
// 82 Hz. If this ever reads E3 the tuner is telling people to break strings.
t('the tuner names sounding pitch, not written pitch', () => {
  assert.equal(nearestString(82.41).note, 'E2');
  assert.equal(nearestString(110).note, 'A2');
  assert.equal(nearestString(329.63).note, 'E4');
});

t('a badly flat string is still that string, not the one below', () => {
  // A whole tone flat of the low E - well past anything you would call flat.
  const m = nearestString(73.42);
  assert.equal(m.string, 6);
  assert.ok(m.cents < -180, 'and it says how far');
});

t('a note between two strings picks the nearer one', () => {
  // Midway A2-D3 is about 127 Hz; just under it must read as A.
  assert.equal(nearestString(120).string, 5);
  assert.equal(nearestString(135).string, 4);
});

t('nothing sensible comes back from silence', () => {
  assert.equal(nearestString(0), null);
  assert.equal(nearestChromatic(-1), null);
});

// -------------------------------------------------------------- chromatic

t('chromatic mode finds any semitone, and follows the reference pitch', () => {
  assert.equal(nearestChromatic(440).note, 'A4');
  assert.equal(Math.round(nearestChromatic(440).cents), 0);
  // Move the reference and the whole scale moves with it: at A=415 it is 415 Hz
  // that is a dead-centre A, and concert-pitch 440 lands a semitone up.
  const low = nearestChromatic(415, 415);
  assert.equal(low.note, 'A4');
  assert.ok(Math.abs(low.cents) < 0.001);
  const shifted = nearestChromatic(440, 415);
  assert.equal(shifted.note, 'A#4', 'a semitone above the moved reference');
  assert.ok(Math.abs(shifted.cents) < 5, `got ${shifted.cents}`);
});

// --------------------------------------------------------------- verdicts

t('the in-tune window is symmetrical and honest about its width', () => {
  assert.equal(verdictFor(0), 'in-tune');
  assert.equal(verdictFor(IN_TUNE_CENTS), 'in-tune');
  assert.equal(verdictFor(-IN_TUNE_CENTS), 'in-tune');
  assert.equal(verdictFor(IN_TUNE_CENTS + 1), 'sharp');
  assert.equal(verdictFor(-IN_TUNE_CENTS - 1), 'flat');
});

// ------------------------------------------------------------- the reading

t('one bad frame does not move the reading', () => {
  const tu = new Tuner();
  const e2 = midiToHz(40);
  let r = null;
  // A run of good frames with one octave slip dropped into the middle of it.
  [e2, e2, e2, e2 * 2, e2, e2, e2].forEach((hz, i) => { r = tu.push(hz, i * 20); });
  assert.equal(r.string, 6, 'the slip is outvoted by the median');
  assert.ok(Math.abs(r.cents) < 5);
});

// Detections arrive with every animation frame while a string rings, so a
// realistic feed is a steady drip rather than a handful of samples.
function feed(tu, hz, fromMs, toMs, stepMs = 20) {
  let r = null;
  for (let at = fromMs; at <= toMs; at += stepMs) r = tu.push(hz, at);
  return r;
}

t('in tune is not announced as held until it has actually been held', () => {
  const tu = new Tuner({ holdMs: 500 });
  const e2 = midiToHz(40);
  let r = feed(tu, e2, 0, 300);
  assert.equal(r.verdict, 'in-tune');
  assert.equal(r.done, false, 'only 300 ms so far');
  r = feed(tu, e2, 320, 700);
  assert.equal(r.done, true);
  assert.ok(tu.settled.has(6));
});

t('drifting back out of tune restarts the hold', () => {
  const tu = new Tuner({ holdMs: 500 });
  const e2 = midiToHz(40);
  feed(tu, e2, 0, 400);
  // Bend it sharp, then come back: the half second starts again from there.
  feed(tu, e2 * 1.02, 420, 800);
  const r = feed(tu, e2, 820, 1100);
  assert.equal(r.verdict, 'in-tune');
  assert.equal(r.done, false, 'the clock restarted when it went sharp');
  assert.equal(feed(tu, e2, 1120, 1500).done, true, 'and finishes once it stays');
});

t('ticks survive moving to the next string, and clear on demand', () => {
  const tu = new Tuner({ holdMs: 100 });
  feed(tu, midiToHz(40), 0, 300);
  tu.clearNote();
  feed(tu, midiToHz(45), 400, 700);
  assert.deepEqual([...tu.settled].sort(), [5, 6]);
  tu.clearNote();
  assert.deepEqual([...tu.settled].sort(), [5, 6], 'a new note is not a new session');
  tu.reset();
  assert.equal(tu.settled.size, 0);
});

t('silence eventually clears the note', () => {
  const tu = new Tuner({ windowMs: 350 });
  feed(tu, midiToHz(40), 0, 200);
  assert.ok(tu.last);
  tu.push(null, 1000);
  assert.equal(tu.last, null);
});

// ------------------------------------------------------------- tap tempo

t('four even taps give the tempo they were tapped at', () => {
  assert.equal(tapTempo([0, 500, 1000, 1500]), 120);
  assert.equal(tapTempo([0, 1000, 2000]), 60);
});

t('one clumsy tap is averaged away rather than believed', () => {
  // 500 ms gaps with one 560 ms wobble: still about 120, not 107.
  const bpm = tapTempo([0, 500, 1000, 1560, 2060]);
  assert.ok(bpm >= 115 && bpm <= 122, `got ${bpm}`);
});

t('a long pause starts counting again instead of setting a crawl', () => {
  // Two taps, a ten-second think, then three taps at 120.
  assert.equal(tapTempo([0, 500, 10500, 11000, 11500]), 120);
});

t('nothing to go on gives nothing back', () => {
  assert.equal(tapTempo([]), null);
  assert.equal(tapTempo([1234]), null);
});

t('absurd tempos are clamped rather than shown', () => {
  assert.equal(tapTempo([0, 10]), 240);
  assert.equal(tapTempo([0, 1900]), 32);
});

// ------------------------------------------------- the whole chain, on audio
//
// The unit tests above feed the tuner perfect frequencies. This one feeds it
// what the microphone actually delivers: a harmonic stack through the real
// detector, at the wide window the tuner asks for. The low E is where every
// pitch detector on earth embarrasses itself, so it is tested hardest.

const SR = 48000;
const TUNE_WINDOW = 4096;

/** A plucked-string-ish tone: harmonic stack, decaying envelope, optional noise. */
function tone(hz, { n = TUNE_WINDOW, sr = SR, decay = 1.2, noise = 0, startAt = 0 } = {}) {
  const harmonics = [1, 0.6, 0.35, 0.2, 0.12, 0.07];
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i + startAt) / sr;
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) {
      const f = hz * (h + 1);
      if (f > sr / 2) break;
      v += harmonics[h] * Math.sin(2 * Math.PI * f * t + 0.3 * (h + 1));
    }
    v *= Math.exp(-decay * t);
    if (noise) v += noise * (Math.random() * 2 - 1);
    buf[i] = v * 0.3;
  }
  return buf;
}

/** Play a tone into a tuner for half a second of frames, as the app would. */
function play(tu, hz, { noise = 0, frames = 40, stepMs = 20 } = {}) {
  let r = null;
  for (let i = 0; i < frames; i++) {
    const det = detectPitch(tone(hz, { noise, startAt: i * (stepMs / 1000) * SR }), SR);
    r = tu.push(det ? det.hz : null, i * stepMs);
  }
  return r;
}

t('every open string is found in real audio, low E included', () => {
  for (const s of STRING_ORDER) {
    const hz = midiToHz(STANDARD_TUNING[s]);
    const r = play(new Tuner(), hz);
    assert.ok(r, `string ${s} produced no reading at all`);
    assert.equal(r.string, s, `string ${s} at ${hz.toFixed(1)} Hz read as string ${r.string}`);
    assert.ok(Math.abs(r.cents) <= IN_TUNE_CENTS,
      `string ${s} was ${r.cents.toFixed(1)} cents out on a perfectly tuned note`);
    assert.equal(r.done, true, `string ${s} never settled`);
  }
});

t('a flat low E is read as flat, not as a different note', () => {
  // 20 cents flat: the amount you actually have to correct after a string change.
  const hz = midiToHz(40) * Math.pow(2, -20 / 1200);
  const r = play(new Tuner(), hz);
  assert.equal(r.string, 6);
  assert.equal(r.verdict, 'flat');
  assert.ok(Math.abs(r.cents + 20) < 6, `said ${r.cents.toFixed(1)} cents, should be about -20`);
});

t('room noise does not turn a tuned string into a wrong answer', () => {
  const r = play(new Tuner(), midiToHz(40), { noise: 0.05 });
  assert.ok(r, 'gave up entirely in noise');
  assert.equal(r.string, 6);
  assert.ok(Math.abs(r.cents) <= 10, `${r.cents.toFixed(1)} cents out in noise`);
});

// ------------------------------------------------------------ what is drawn

t('nothing playing draws a blank face, not a stale one', () => {
  const v = readingView(null);
  assert.equal(v.note, '—');
  assert.equal(v.needlePct, 50);
  assert.equal(v.verdictKey, null, 'the caller decides between "press start" and "play a string"');
});

t('the needle sits where the cents say, and stops at the ends', () => {
  assert.equal(readingView({ cents: 0, verdict: 'in-tune', note: 'E2', string: 6 }).needlePct, 50);
  assert.equal(readingView({ cents: 20, verdict: 'sharp', note: 'E2', string: 6 }).needlePct, 70);
  assert.equal(readingView({ cents: -20, verdict: 'flat', note: 'E2', string: 6 }).needlePct, 30);
  // Two whole tones out would run off the end of the dial.
  assert.equal(readingView({ cents: 400, verdict: 'sharp', note: 'E2', string: 6 }).needlePct, 100);
  assert.equal(readingView({ cents: -400, verdict: 'flat', note: 'E2', string: 6 }).needlePct, 0);
});

t('the cents readout is signed and carries its unit', () => {
  assert.equal(readingView({ cents: 12.4, verdict: 'sharp', note: 'A2', string: 5 }).cents, '+12 ¢');
  assert.equal(readingView({ cents: -12.4, verdict: 'flat', note: 'A2', string: 5 }).cents, '-12 ¢');
  assert.equal(readingView({ cents: 0.2, verdict: 'in-tune', note: 'A2', string: 5 }).cents, '0 ¢');
});

// The one thing in this whole feature that can hurt someone: telling a beginner
// to tighten a string that is already sharp is how strings snap.
t('flat says tighten and sharp says loosen, never the other way round', () => {
  assert.equal(readingView({ cents: -30, verdict: 'flat', note: 'E2', string: 6 }).verdictKey, 'tools.flat');
  assert.equal(readingView({ cents: 30, verdict: 'sharp', note: 'E2', string: 6 }).verdictKey, 'tools.sharp');
});

t('colour follows how far out it is', () => {
  const cls = (cents, verdict) => readingView({ cents, verdict, note: 'E2', string: 6 }).needleClass;
  assert.ok(cls(2, 'in-tune').includes('in-tune'));
  assert.ok(cls(12, 'sharp').includes('near'), 'a little out is amber');
  assert.ok(cls(40, 'sharp').includes('far'), 'a lot out is red');
});

t('the held tick has its own message', () => {
  assert.equal(readingView({ cents: 1, verdict: 'in-tune', done: false, note: 'E2', string: 6 }).verdictKey, 'tools.inTune');
  assert.equal(readingView({ cents: 1, verdict: 'in-tune', done: true, note: 'E2', string: 6 }).verdictKey, 'tools.inTuneHeld');
});


// ---------------------------------------------------------------------------
// Staying on one string.
//
// Reported from the guitar: "the third string makes the tuner go flat, then
// stabilises in the centre then immediately go hard sharp... I can't play."
// It was not the detector. Picking the nearest open string afresh every frame
// means the needle is measuring against a different target from one frame to
// the next, and it slams end to end when the target changes. String 3 is the
// worst because G to B is four semitones where every other gap is five, so it
// has the narrowest capture range of the six.

/** Feed a steady pitch for a while, as a peg being turned slowly would. */
function hold(tu, hz, { fromMs = 0, frames = 25, stepMs = 20 } = {}) {
  let r = null;
  for (let i = 0; i < frames; i++) r = tu.push(hz, fromMs + i * stepMs);
  return { reading: r, endMs: fromMs + frames * stepMs };
}

const G3 = midiToHz(STANDARD_TUNING[3]);
const offset = (cents) => G3 * Math.pow(2, cents / 1200);

t('tuning one string up does not make the needle jump end to end', () => {
  // The old behaviour, measured: hard sharp (as D), hard flat (as G), centre,
  // hard sharp, hard flat (as B) - four slams while turning one peg one way.
  const tu = new Tuner();
  let ms = 0;
  const shown = [];
  for (const c of [-300, -250, -225, -200, -150, -100, -50, -25, 0, 25, 50, 100, 150, 200, 225, 250]) {
    const out = hold(tu, offset(c), { fromMs: ms });
    ms = out.endMs;
    shown.push({ c, note: out.reading.note, cents: out.reading.cents });
  }
  const names = [...new Set(shown.map((x) => x.note))];
  assert.ok(names.length <= 2, `needle changed target ${names.length} times: ${names.join(' -> ')}`);

  // Once it settles on G it must never hand back to a neighbour: from the first
  // G reading onward the displayed cents only ever increase.
  const fromG = shown.slice(shown.findIndex((x) => x.note === 'G3'));
  for (let i = 1; i < fromG.length; i++) {
    assert.ok(fromG[i].cents >= fromG[i - 1].cents - 1,
      `needle went backwards at ${fromG[i].c}c: ${fromG[i - 1].cents} -> ${fromG[i].cents}`);
  }
});

t('a string pinned by the player is never second-guessed', () => {
  // The answer for a new nylon string sitting semitones flat, where guessing
  // the nearest names a different string with complete confidence.
  const tu = new Tuner();
  tu.pin(3);
  let ms = 0;
  let previous = -Infinity;
  for (const c of [-300, -250, -200, -150, -100, -50, 0, 50, 100, 200, 250]) {
    const out = hold(tu, offset(c), { fromMs: ms });
    ms = out.endMs;
    assert.equal(out.reading.note, 'G3', `pinned to string 3 but reported ${out.reading.note} at ${c}c`);
    assert.equal(out.reading.string, 3);
    assert.ok(out.reading.cents > previous, `needle not monotonic at ${c}c`);
    previous = out.reading.cents;
  }
});

t('pinning survives the string being three semitones flat', () => {
  // Unpinned, this pitch is nearest to D and would be announced as a sharp D -
  // sending the peg the wrong way, which is how strings get broken.
  const flat = offset(-300);
  assert.equal(nearestString(flat).string, 4, 'precondition: nearest really is the D string');

  const tu = new Tuner();
  tu.pin(3);
  const { reading } = hold(tu, flat);
  assert.equal(reading.string, 3);
  assert.equal(reading.verdict, 'flat');
  assert.ok(reading.cents < -250, `should read very flat, read ${reading.cents}`);
});

t('unpinning hands the choice back', () => {
  const tu = new Tuner();
  tu.pin(2);
  assert.equal(hold(tu, G3).reading.string, 2);
  tu.pin(null);
  assert.equal(hold(tu, G3).reading.string, 3);
});

t('an octave slip while the string is known is folded, not announced', () => {
  // The second harmonic is often louder than the fundamental. Hearing it does
  // not mean the player moved to another string.
  const tu = new Tuner();
  hold(tu, G3);                                   // establish string 3
  const { reading } = hold(tu, G3 * 2, { fromMs: 600 });
  assert.equal(reading.string, 3, 'the octave was treated as a different string');
  assert.ok(Math.abs(reading.cents) <= 5, `octave should fold to in tune, read ${reading.cents}`);
});

t('folding only accepts near-exact octaves', () => {
  assert.equal(foldOctaves(0), 0);
  assert.equal(foldOctaves(1195), -5);           // an octave, five cents flat
  assert.equal(foldOctaves(-1200), 0);
  assert.equal(foldOctaves(900), 900);           // a sixth is not an octave
  assert.equal(foldOctaves(700), 700);           // nor is a fifth
});

t('really changing strings still works, and takes about a fifth of a second', () => {
  const tu = new Tuner();
  hold(tu, G3);
  assert.equal(tu.last.string, 3);
  const B3 = midiToHz(STANDARD_TUNING[2]);
  const { reading } = hold(tu, B3, { fromMs: 600 });
  assert.equal(reading.string, 2, 'never moved to the string actually being played');
  assert.ok(Math.abs(reading.cents) <= 5);
});

t('one stray frame does not change which string is being tuned', () => {
  const tu = new Tuner();
  hold(tu, G3);
  const before = tu.last.string;
  tu.push(midiToHz(STANDARD_TUNING[2]), 600);     // a single frame from nowhere
  hold(tu, G3, { fromMs: 620 });
  assert.equal(tu.last.string, before, 'a single frame moved the target');
});

t('chromatic mode reports what it hears, octave and all', () => {
  // No string context, so nothing may be folded away - a capo or a piano needs
  // the actual note, not the nearest guitar string an octave down.
  const tu = new Tuner({ mode: 'chromatic' });
  const { reading } = hold(tu, G3 * 2);
  assert.equal(reading.note, 'G4');
});

t('stringTarget measures against the string asked for, not the nearest', () => {
  const m = stringTarget(3, midiToHz(STANDARD_TUNING[4]));
  assert.equal(m.string, 3);
  assert.ok(m.cents < -450, 'the D string is about five semitones below the G string');
});

t('silence releases the string so the next one is judged fresh', () => {
  const tu = new Tuner();
  hold(tu, G3);
  assert.equal(tu.locked, 3);
  for (let i = 0; i < 30; i++) tu.push(null, 600 + i * 20);
  assert.equal(tu.locked, null, 'still holding the previous string after silence');
});

console.log(`tuner: ${pass} groups passed`);
