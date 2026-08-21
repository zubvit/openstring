import assert from 'node:assert/strict';
import { detectPitch, PitchTracker, rms , AnswerGate } from '../js/pitch.js';
import { midiToHz, noteName, hzToMidiFloat } from '../js/theory.js';

const SR = 48000;
const WIN = 2048;

/** A plucked-string-ish tone: harmonic stack, decaying envelope, optional noise. */
function tone(hz, {
  n = WIN, sr = SR, harmonics = [1, 0.6, 0.35, 0.2, 0.12, 0.07],
  decay = 2.0, noise = 0, phase = 0.3, startAt = 0,
} = {}) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i + startAt) / sr;
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) {
      const f = hz * (h + 1);
      if (f > sr / 2) break;
      v += harmonics[h] * Math.sin(2 * Math.PI * f * t + phase * (h + 1));
    }
    v *= Math.exp(-decay * t);
    if (noise) v += noise * (Math.random() * 2 - 1);
    buf[i] = v * 0.3;
  }
  return buf;
}

const centsErr = (hz, target) => Math.abs(1200 * Math.log2(hz / target));

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

t('every semitone across the guitar range, harmonic-rich', () => {
  const failures = [];
  for (let midi = 40; midi <= 76; midi++) { // E2 (low open E) to E5 (high E, 12th fret)
    const target = midiToHz(midi);
    const det = detectPitch(tone(target), SR);
    if (!det) { failures.push(`${noteName(midi)}: no detection`); continue; }
    const err = centsErr(det.hz, target);
    if (err > 50) {
      failures.push(`${noteName(midi)} (${target.toFixed(1)}Hz): got ${det.hz.toFixed(1)}Hz, ${err.toFixed(0)}c off`);
    }
  }
  assert.deepEqual(failures, [], `pitch failures:\n${failures.join('\n')}`);
});

t('weak fundamental does not cause an octave error', () => {
  // A laptop mic rolls off bass badly: fundamental far quieter than harmonic 2.
  // Plain autocorrelation reports the octave here; MPM must not.
  const failures = [];
  for (const midi of [40, 41, 43, 45, 47, 50, 52]) { // the low, bass-heavy strings
    const target = midiToHz(midi);
    const det = detectPitch(tone(target, { harmonics: [0.12, 1.0, 0.7, 0.4, 0.2] }), SR);
    if (!det) { failures.push(`${noteName(midi)}: no detection`); continue; }
    const err = centsErr(det.hz, target);
    const octaveUp = centsErr(det.hz, target * 2) < 50;
    if (octaveUp) failures.push(`${noteName(midi)}: OCTAVE ERROR, reported ${det.hz.toFixed(1)}Hz`);
    else if (err > 50) failures.push(`${noteName(midi)}: ${err.toFixed(0)}c off`);
  }
  assert.deepEqual(failures, [], `weak-fundamental failures:\n${failures.join('\n')}`);
});

t('missing fundamental entirely still resolves to the right pitch', () => {
  // Extreme case: no energy at f0 at all, only harmonics 2..6.
  const target = midiToHz(45); // A2, 110 Hz
  const det = detectPitch(tone(target, { harmonics: [0, 1.0, 0.6, 0.4, 0.25, 0.15] }), SR);
  assert.ok(det, 'should still detect');
  assert.ok(centsErr(det.hz, target) < 50, `got ${det.hz.toFixed(1)}Hz, wanted ${target.toFixed(1)}Hz`);
});

t('survives a noisy room', () => {
  const target = midiToHz(55); // G3
  const det = detectPitch(tone(target, { noise: 0.05 }), SR);
  assert.ok(det, 'should detect through noise');
  assert.ok(centsErr(det.hz, target) < 50, `${det.hz.toFixed(1)}Hz off target`);
});

t('slightly out-of-tune string reports the offset rather than snapping', () => {
  const target = midiToHz(64) * Math.pow(2, 35 / 1200); // 35 cents sharp
  const det = detectPitch(tone(target), SR);
  assert.ok(det);
  const cents = 1200 * Math.log2(det.hz / midiToHz(64));
  assert.ok(Math.abs(cents - 35) < 12, `expected ~+35c, got ${cents.toFixed(0)}c`);
});

t('silence and noise are rejected, not guessed at', () => {
  assert.equal(detectPitch(new Float32Array(WIN), SR), null, 'silence');
  const quiet = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) quiet[i] = (Math.random() * 2 - 1) * 0.002;
  assert.equal(detectPitch(quiet, SR), null, 'near-silent noise');
  const loudNoise = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) loudNoise[i] = (Math.random() * 2 - 1) * 0.3;
  const det = detectPitch(loudNoise, SR);
  assert.equal(det, null, `white noise should be rejected, got ${det && det.hz}`);
});

t('tracker waits for the note to settle', () => {
  const tr = new PitchTracker({ requiredFrames: 3 });
  assert.equal(tr.push(null), null);
  // Wild attack transient then a steady note: the wobble must not be reported.
  assert.equal(tr.push({ hz: 300, clarity: 0.9 }), null);
  assert.equal(tr.push({ hz: 180, clarity: 0.9 }), null);
  assert.equal(tr.push({ hz: 196, clarity: 0.95 }), null, 'still spread too wide');
  tr.push({ hz: 196.2, clarity: 0.95 });
  const stable = tr.push({ hz: 195.8, clarity: 0.95 });
  assert.ok(stable, 'should settle once frames agree');
  assert.ok(Math.abs(stable.hz - 196) < 1, `median ${stable.hz}`);
});

t('detection is fast enough for real time', () => {
  const buf = tone(midiToHz(52));
  const t0 = process.hrtime.bigint();
  const N = 200;
  for (let i = 0; i < N; i++) detectPitch(buf, SR);
  const msPerFrame = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  // A 2048-sample frame is 42.7 ms of audio; analysis must be far under that.
  assert.ok(msPerFrame < 8, `too slow: ${msPerFrame.toFixed(2)} ms/frame`);
  console.log(`  detection: ${msPerFrame.toFixed(2)} ms per 42.7 ms frame`);
});

// ------------------------------------------------------- telling an answer
// apart from the note still ringing
//
// This gate exists because of a bug that quietly wrecked every score in the
// app: a plucked string rings for seconds, so the note you had just played was
// arriving as a wrong answer to the NEXT question before you touched a string.
// Accuracy sat around three quarters however well you played.

t('the note just answered is not an answer to the next question', () => {
  const g = new AnswerGate();
  g.mute(67);                               // G was the answer; it rings on
  assert.equal(g.accept(67), null);
  assert.equal(g.accept(67), null);
  assert.equal(g.accept(67), null, 'however long it rings');
});

t('a different note ends the tail and counts', () => {
  const g = new AnswerGate();
  g.mute(67);
  assert.equal(g.accept(71), 71, 'playing B is an answer');
  assert.equal(g.accept(67), 67, 'and G counts again once it is no longer the tail');
});

t('a held note is one answer, not sixty a second', () => {
  const g = new AnswerGate();
  assert.equal(g.accept(64), 64);
  for (let i = 0; i < 50; i++) assert.equal(g.accept(64), null);
});

t('silence clears everything, so the same note can be played twice', () => {
  const g = new AnswerGate();
  assert.equal(g.accept(64), 64);
  assert.equal(g.accept(64), null);
  assert.equal(g.accept(null), null, 'the string stopped');
  assert.equal(g.accept(64), 64, 'and playing it again is a new answer');
});

t('a new question carries over whatever is still sounding', () => {
  const g = new AnswerGate();
  g.reset(60);
  assert.equal(g.accept(60), null, 'the leftover is ignored');
  assert.equal(g.accept(62), 62);
});

t('a fresh question with nothing ringing accepts the first note', () => {
  const g = new AnswerGate();
  g.reset(null);
  assert.equal(g.accept(60), 60);
});

// The failure this replaced, stated as a test: the old rule was "count any
// pitch that differs from the last one counted", which lets the decaying
// previous answer straight through at the start of every question.
t('the old rule would have let the ringing note through, this one does not', () => {
  const g = new AnswerGate();
  g.mute(67);
  const framesWhileItDecays = [67, 67, 67, 67];
  const judged = framesWhileItDecays.map((m) => g.accept(m)).filter((m) => m != null);
  assert.deepEqual(judged, [], 'not one of those frames is an answer');
});

// The second half of the same bug. Muting only the note you got RIGHT left
// every wrong note free to ring on into the next question and be counted
// against it a second time - so a fumble cost you two marks, not one, and the
// worse you were doing the more phantom mistakes you collected.
t('a wrong note is still ringing too, and must also be ignored', () => {
  const g = new AnswerGate();
  g.reset(60);                  // 60 was the last thing heard - and it was WRONG
  assert.equal(g.accept(60), null, 'its tail is not an answer to the new question');
  assert.equal(g.accept(64), 64, 'the note actually played is');
});

// ------------------------------------------- an answer is a string being struck
//
// He plays a note, forgets to damp it, and the next question appears while it
// is still sounding. Nobody should have to mute a string to avoid being marked
// wrong: how long a note rings is a separate skill, practised in the rhythm
// drill, and the reading drill has no business testing it by accident.

t('a note left ringing is not an answer, however long it rings', () => {
  const g = new AnswerGate({ requireOnset: true });
  for (let i = 0; i < 200; i++) assert.equal(g.accept(67), null, 'nothing was plucked');
});

t('the same note IS an answer once the string is struck', () => {
  const g = new AnswerGate({ requireOnset: true });
  assert.equal(g.accept(67), null);
  g.arm();
  assert.equal(g.accept(67), 67);
});

t('one pluck is one answer, not one per frame', () => {
  const g = new AnswerGate({ requireOnset: true });
  g.arm();
  assert.equal(g.accept(64), 64);
  for (let i = 0; i < 50; i++) assert.equal(g.accept(64), null, 'still the same pluck');
  g.arm();
  assert.equal(g.accept(64), 64, 'plucked again, so answered again');
});

// The benign failure. If an attack is somehow missed the question simply stays
// up - it costs nothing, where a false answer costs a mark.
t('a missed attack costs nothing rather than scoring a mistake', () => {
  const g = new AnswerGate({ requireOnset: true });
  assert.equal(g.accept(60), null);
  assert.equal(g.accept(62), null);
  assert.equal(g.accept(64), null, 'silence is the worst that happens');
});

t('a new question forgets any attack heard before it', () => {
  const g = new AnswerGate({ requireOnset: true });
  g.arm();
  g.reset(null);
  assert.equal(g.accept(60), null, 'the pluck belonged to the previous question');
});

t('the tail of the last answer is still ignored even after a fresh pluck', () => {
  const g = new AnswerGate({ requireOnset: true });
  g.reset(67);          // 67 is still ringing from before
  g.arm();              // and now a different string is struck
  assert.equal(g.accept(67), null, 'the detector caught the old one first');
  assert.equal(g.accept(71), 71, 'then the new one');
});

t('without the onset rule the gate behaves as it always did', () => {
  const g = new AnswerGate();
  assert.equal(g.accept(60), 60, 'the tuner and anything else are unaffected');
});

console.log(`pitch: ${pass} groups passed`);
