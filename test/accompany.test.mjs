import assert from 'node:assert/strict';
import { scheduleAccompaniment, isAccompaniment } from '../js/accompany.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// The app playing the other part is the whole reason a beginner's three open
// strings sound like music. It also means the microphone hears the app, so the
// two jobs here are: put the notes in the right place on the clock, and be able
// to say afterwards which notes were the app's.

/** Enough of an AudioContext for playChord to schedule against and record. */
function fakeCtx(now = 10) {
  const started = [];
  const node = () => ({
    frequency: { value: 0 },
    gain: {
      setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
    },
    connect(next) { return next; },
    start(at) { started.push(at); },
    stop() {},
  });
  return {
    currentTime: now,
    sampleRate: 48000,
    destination: {},
    createOscillator: node,
    createGain: node,
    started,
  };
}

const timeOfBeat = (b) => 100 + b * 0.5;   // 120 bpm, downbeat at t=100

t('every note lands on its own beat, on the audio clock', () => {
  const ctx = fakeCtx();
  const played = scheduleAccompaniment(ctx, [
    { sounding: 43, beat: 0, beats: 2 },
    { sounding: 50, beat: 2, beats: 2 },
  ], { timeOfBeat, bpm: 120 });
  assert.deepEqual(played.map((p) => p.at), [100, 101]);
  assert.deepEqual(played.map((p) => p.sounding), [43, 50]);
});

t('a note holds for its written length, not a fixed ring', () => {
  const [half, whole] = scheduleAccompaniment(fakeCtx(), [
    { sounding: 43, beat: 0, beats: 2 },
    { sounding: 43, beat: 2, beats: 4 },
  ], { timeOfBeat, bpm: 120 });
  assert.ok(whole.until - whole.at > half.until - half.at);
});

t('a note whose moment has passed is dropped, not fired late', () => {
  // Scheduling in the past makes a note sound immediately and out of time,
  // which is worse than not sounding at all.
  const ctx = fakeCtx(102);
  const played = scheduleAccompaniment(ctx, [
    { sounding: 43, beat: 0, beats: 2 },     // t=100, already gone
    { sounding: 50, beat: 6, beats: 2 },     // t=103
  ], { timeOfBeat, bpm: 120 });
  assert.deepEqual(played.map((p) => p.sounding), [50]);
});

t('nothing to play, or nowhere to play it, is quietly nothing', () => {
  assert.deepEqual(scheduleAccompaniment(fakeCtx(), [], { timeOfBeat }), []);
  assert.deepEqual(scheduleAccompaniment(null, [{ sounding: 43, beat: 0 }], { timeOfBeat }), []);
  assert.deepEqual(scheduleAccompaniment(fakeCtx(), [{ sounding: 43, beat: 0 }], {}), []);
});

t('a note the app is sounding right now is the app, not him', () => {
  const played = [{ sounding: 43, at: 100, until: 101 }];
  assert.equal(isAccompaniment(played, 43, 100.5), true);
  assert.equal(isAccompaniment(played, 43, 100.0), true);
  assert.equal(isAccompaniment(played, 43, 101.0), true);
});

t('the same pitch at another moment is his', () => {
  const played = [{ sounding: 43, at: 100, until: 101 }];
  assert.equal(isAccompaniment(played, 43, 103), false, 'long after the app stopped');
  assert.equal(isAccompaniment(played, 43, 97), false, 'well before it started');
  assert.equal(isAccompaniment(played, 50, 100.5), false, 'a different note entirely');
});

t('a note he plays that doubles the bass is still credited to him', () => {
  // Deliberately this way round. Only a pitch the app is ACTUALLY sounding is
  // forgiven; a blanket "ignore anything the bass ever touches" would mark his
  // own correct notes as never played.
  const played = scheduleAccompaniment(fakeCtx(), [{ sounding: 55, beat: 0, beats: 1 }],
    { timeOfBeat, bpm: 120 });
  assert.equal(isAccompaniment(played, 55, 100.1), true, 'during');
  assert.equal(isAccompaniment(played, 55, 105), false, 'four bars later, that is him');
});

t('with no accompaniment at all, nothing is ever excused', () => {
  assert.equal(isAccompaniment([], 43, 100), false);
});

console.log(`accompany: ${pass} ok`);
