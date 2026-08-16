import assert from 'node:assert/strict';
import { Metronome } from '../js/audio.js';
import { expectedOnsets } from '../js/curriculum.js';
import { gradeTiming } from '../js/onset.js';

// Enough of a Web Audio context to exercise the scheduling arithmetic.
function stubCtx(startTime = 10) {
  const noop = () => ({
    connect(x) { return x; }, start() {}, stop() {},
    frequency: { value: 0 },
    gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
  });
  return { currentTime: startTime, createOscillator: noop, createGain: noop, destination: {} };
}

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

t('beat zero is the downbeat, not the first count-in click', () => {
  const ctx = stubCtx(10);
  const m = new Metronome(ctx);
  m.beatsPerBar = 4;
  m.start(60, { countInBars: 1, startTime: 10 });
  m.stop();
  // At 60 bpm a beat is 1s; one bar of count-in is 4s.
  assert.equal(m.firstClickTime, 10, 'the count-in starts immediately');
  assert.equal(m.timeOfBeat(0), 14, 'the downbeat is a full bar later');
  assert.equal(m.timeOfBeat(4), 18, 'bar two');
});

t('no count-in means beat zero is the first click', () => {
  const m = new Metronome(stubCtx(5));
  m.beatsPerBar = 4;
  m.start(120, { countInBars: 0, startTime: 5 });
  m.stop();
  assert.equal(m.timeOfBeat(0), 5);
  assert.equal(m.timeOfBeat(2), 6, '120 bpm = half a second per beat');
});

t('expected onsets line up with the metronome, count-in included', () => {
  const m = new Metronome(stubCtx(3));
  m.beatsPerBar = 4;
  m.start(60, { countInBars: 1, startTime: 3 });
  m.stop();
  const zero = m.timeOfBeat(0);            // 7
  const exp = expectedOnsets('quarters', 60, { startAt: zero, bars: 1 });
  assert.deepEqual(exp, [7, 8, 9, 10]);
  // Every expected note must coincide with an actual click.
  exp.forEach((tSec, i) => assert.equal(tSec, m.timeOfBeat(i)));
});

t('a player perfectly in time scores as in time on the real timeline', () => {
  const m = new Metronome(stubCtx(0));
  m.beatsPerBar = 4;
  m.start(80, { countInBars: 1, startTime: 0.12 });
  m.stop();
  const exp = expectedOnsets('eighths', 80, { startAt: m.timeOfBeat(0), bars: 2 });
  const played = exp.map((x) => x + 0.006); // 6 ms late, inaudible
  const g = gradeTiming(played, exp);
  assert.equal(g.verdict, 'in time');
  assert.equal(g.missed, 0);
  assert.equal(g.extra, 0);
});

t('a bar-early mistake would be caught, not silently accepted', () => {
  // This is the bug the timeOfBeat fix removed: if expected onsets were computed
  // from the count-in start, everything would be one bar out. Prove it shows up.
  const m = new Metronome(stubCtx(0));
  m.beatsPerBar = 4;
  m.start(60, { countInBars: 1, startTime: 0 });
  m.stop();
  const correct = expectedOnsets('quarters', 60, { startAt: m.timeOfBeat(0), bars: 1 });
  const wrong = expectedOnsets('quarters', 60, { startAt: m.firstClickTime, bars: 1 });
  assert.notDeepEqual(correct, wrong);
  const g = gradeTiming(correct, wrong); // playing correctly, graded against the bad grid
  assert.equal(g.hitCount, 0, 'a whole bar out must not be scored as playing');
});

console.log(`metronome: ${pass} groups passed`);
