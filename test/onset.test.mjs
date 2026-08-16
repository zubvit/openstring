import assert from 'node:assert/strict';
import { detectOnsets, gradeTiming, OnsetDetector } from '../js/onset.js';
import { midiToHz } from '../js/theory.js';

const SR = 48000;

/** Build audio containing plucks at the given times (seconds). */
function plucks(times, { seconds = 4, sr = SR, hz = 196, noise = 0, decay = 6, amp = 0.35 } = {}) {
  const buf = new Float32Array(Math.ceil(seconds * sr));
  for (const t0 of times) {
    const start = Math.floor(t0 * sr);
    for (let i = 0; i < sr * 0.7 && start + i < buf.length; i++) {
      const t = i / sr;
      const env = Math.exp(-decay * t);
      let v = 0;
      for (let h = 1; h <= 5; h++) v += (1 / h) * Math.sin(2 * Math.PI * hz * h * t);
      buf[start + i] += amp * env * v;
    }
  }
  if (noise) for (let i = 0; i < buf.length; i++) buf[i] += noise * (Math.random() * 2 - 1);
  return buf;
}

const maxDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]) * 1000));

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

t('finds four quarter notes at 60 bpm', () => {
  const want = [0.5, 1.5, 2.5, 3.5];
  const got = detectOnsets(plucks(want), SR);
  assert.equal(got.length, want.length, `expected 4 onsets, got ${got.length}: ${got.map(x=>x.toFixed(3))}`);
  const err = maxDiff(got, want);
  assert.ok(err < 20, `worst onset error ${err.toFixed(1)} ms`);
  console.log(`  quarter notes: worst error ${err.toFixed(1)} ms`);
});

t('finds eighth notes at 120 bpm', () => {
  const want = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const got = detectOnsets(plucks(want, { decay: 10 }), SR);
  assert.equal(got.length, want.length, `got ${got.length} onsets: ${got.map(x=>x.toFixed(3))}`);
  assert.ok(maxDiff(got, want) < 25, `worst error ${maxDiff(got, want).toFixed(1)} ms`);
});

t('a ringing string is one note, not several', () => {
  // Single long pluck: must produce exactly one onset despite the decay wobble.
  const got = detectOnsets(plucks([0.5], { decay: 1.2, seconds: 3 }), SR);
  assert.equal(got.length, 1, `one pluck should be one onset, got ${got.length}`);
});

t('works through room noise', () => {
  const want = [0.5, 1.5, 2.5];
  const got = detectOnsets(plucks(want, { noise: 0.01 }), SR);
  assert.equal(got.length, 3, `got ${got.length}`);
  assert.ok(maxDiff(got, want) < 25);
});

t('silence produces no onsets', () => {
  assert.deepEqual(detectOnsets(new Float32Array(SR * 2), SR), []);
});

t('streaming in chunks matches one-shot analysis', () => {
  const want = [0.4, 1.0, 1.6, 2.2];
  const audio = plucks(want);
  const oneShot = detectOnsets(audio, SR);

  const d = new OnsetDetector({ sampleRate: SR });
  const CHUNK = 1024; // realistic Web Audio buffer size
  for (let i = 0; i < audio.length; i += CHUNK) d.push(audio.subarray(i, Math.min(i + CHUNK, audio.length)));
  const streamed = d.times();

  assert.deepEqual(streamed.map((x) => x.toFixed(3)), oneShot.map((x) => x.toFixed(3)),
    'chunked and one-shot must agree exactly');
});

t('grading tells rushing from dragging from uneven', () => {
  const beats = [0, 0.5, 1.0, 1.5];

  const spotOn = gradeTiming(beats.map((b) => b + 0.004), beats);
  assert.equal(spotOn.verdict, 'in time');
  assert.equal(spotOn.missed, 0);

  const early = gradeTiming(beats.map((b) => b - 0.055), beats);
  assert.equal(early.verdict, 'rushing');
  assert.ok(early.meanErrorMs < -25, `mean ${early.meanErrorMs}`);

  const late = gradeTiming(beats.map((b) => b + 0.06), beats);
  assert.equal(late.verdict, 'dragging');
  assert.ok(late.meanErrorMs > 25);

  // Scattered but with no consistent bias - a different fault, different cure.
  const scattered = gradeTiming([0 + 0.07, 0.5 - 0.075, 1.0 + 0.08, 1.5 - 0.07], beats);
  assert.equal(scattered.verdict, 'uneven');
  assert.ok(scattered.spreadMs > 30, `spread ${scattered.spreadMs}`);
});

t('grading counts missed and extra notes', () => {
  const beats = [0, 0.5, 1.0, 1.5];
  const g = gradeTiming([0.005, 1.005, 1.2, 1.505], beats);
  assert.equal(g.missed, 1, 'the note at 0.5 was never played');
  assert.equal(g.extra, 1, 'the note at 1.2 was not asked for');
  assert.equal(g.hitCount, 3);
});

t('end to end: audio in, timing verdict out', () => {
  const beats = [0.5, 1.0, 1.5, 2.0];
  // Player consistently 45 ms late - a real, correctable habit.
  const audio = plucks(beats.map((b) => b + 0.045));
  const g = gradeTiming(detectOnsets(audio, SR), beats);
  assert.equal(g.hitCount, 4);
  assert.equal(g.verdict, 'dragging');
  assert.ok(Math.abs(g.meanErrorMs - 45) < 20, `reported ${g.meanErrorMs} ms, actual 45 ms`);
  console.log(`  end to end: verdict "${g.verdict}", mean ${g.meanErrorMs} ms (true 45 ms)`);
});

console.log(`onset: ${pass} groups passed`);
