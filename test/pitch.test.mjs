import assert from 'node:assert/strict';
import { detectPitch, PitchTracker, rms } from '../js/pitch.js';
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

console.log(`pitch: ${pass} groups passed`);
