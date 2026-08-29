import assert from 'node:assert/strict';
import { whyThisChunk, whyThisMove, observe, summarise } from '../js/coach.js';
import { newChunkState, applyAttempt, LAYERS } from '../js/practice.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// The coach exists because the app made good decisions silently. Two things are
// being tested: that the reason it gives matches the decision it actually made
// (a reason that flatters is worse than no reason), and that it reads a sitting
// the way the practice literature says one should be read.

const at = (i) => ({ chunkId: 'a', kind: 'chunk', bpm: 60, passed: true, at: i, label: 'bar 1' });
const drill = (o) => ({ chunkId: 'a', kind: 'chunk', bpm: 60, passed: true, label: 'bar 1', at: 0, ...o });
const run = (o) => ({ chunkId: '@whole', kind: 'whole', bpm: 80, passed: true, at: 0, ...o });

// ------------------------------------------------------------- why this bar

t('a bar never played says so, rather than inventing a diagnosis', () => {
  assert.equal(whyThisChunk({ id: 'a', kind: 'chunk' }, null).key, 'coach.why.new');
  assert.equal(whyThisChunk({ id: 'a', kind: 'chunk' }, newChunkState()).key, 'coach.why.new');
});

t('a seam says it is a join, because that is why it was weighted up', () => {
  const state = { ...newChunkState(60), attempts: 3 };
  const why = whyThisChunk({ id: 's', kind: 'seam', firstMeasure: 2, lastMeasure: 3 }, state);
  assert.equal(why.key, 'coach.why.seam');
  assert.deepEqual(why.vars, { from: 2, to: 3 });
});

t('the reason matches the scheduler, not the mood', () => {
  // Well behind target is the dominant term in pickChunk's weighting, so it has
  // to be the reason given - anything else would be a nicer sentence about a
  // decision that was not made for that reason.
  const behind = { ...newChunkState(40), attempts: 5, bpm: 40 };
  assert.equal(whyThisChunk({ id: 'a', kind: 'chunk' }, behind, { targetBpm: 80 }).key,
    'coach.why.behind');

  const shallow = { ...newChunkState(78), attempts: 5, bpm: 78, layerIndex: 0 };
  assert.equal(whyThisChunk({ id: 'a', kind: 'chunk' }, shallow, { targetBpm: 80 }).key,
    'coach.why.shallow');
});

t('a bar that is already solid says it is being kept, not fixed', () => {
  const solid = { ...newChunkState(80), attempts: 9, bpm: 80, bestBpm: 80, layerIndex: 2 };
  assert.equal(whyThisChunk({ id: 'a', kind: 'chunk' }, solid, { targetBpm: 80 }).key,
    'coach.why.keeping');
});

// ---------------------------------------------------------- why it moved

t('the tempo moving is explained by the move that actually happened', () => {
  const before = newChunkState(60);
  const missed = applyAttempt(before, { passed: false, targetBpm: 80 });
  const why = whyThisMove(before, missed, { passed: false });
  assert.equal(why.key, 'coach.move.slower');
  assert.equal(why.vars.bpm, missed.bpm);
  assert.ok(missed.bpm < before.bpm);
});

t('one clean run explains why nothing changed - the least obvious rule there is', () => {
  const before = newChunkState(60);
  const once = applyAttempt(before, { passed: true, targetBpm: 80 });
  assert.equal(once.bpm, before.bpm, 'one clean run must not move the tempo');
  assert.equal(whyThisMove(before, once, { passed: true }).key, 'coach.move.again');
});

t('the second clean run is the one that moves it', () => {
  const before = newChunkState(60);
  const once = applyAttempt(before, { passed: true, targetBpm: 80 });
  const twice = applyAttempt(once, { passed: true, targetBpm: 80 });
  assert.ok(twice.bpm > once.bpm);
  assert.equal(whyThisMove(once, twice, { passed: true }).key, 'coach.move.faster');
});

t('at target tempo the next demand is a new layer, and it is named', () => {
  let s = { ...newChunkState(80), bpm: 80, layerIndex: 0 };
  s = applyAttempt(s, { passed: true, targetBpm: 80 });
  const after = applyAttempt(s, { passed: true, targetBpm: 80 });
  const why = whyThisMove(s, after, { passed: true, targetBpm: 80 });
  assert.equal(why.key, 'coach.move.layer');
  assert.equal(why.vars.layer, LAYERS[after.layerIndex]);
});

t('a missed attempt already at the floor says it is holding, not going lower', () => {
  const floor = { ...newChunkState(30), bpm: 30 };
  const after = applyAttempt(floor, { passed: false, targetBpm: 80 });
  assert.equal(after.bpm, 30, 'the ladder has a floor');
  assert.equal(whyThisMove(floor, after, { passed: false }).key, 'coach.move.holding');
});

// ------------------------------------------------------- how you practised

t('too little happened to say anything, and it says nothing', () => {
  // A coach that produces a verdict from two attempts is a coach nobody
  // believes by the third session.
  assert.deepEqual(observe([]), []);
  assert.deepEqual(observe([at(1), at(2)]), []);
});

t('playing it through instead of practising it is named', () => {
  // The most comfortable way to waste a sitting: a run-through gives the hard
  // bar one more unprepared attempt out of every twenty.
  const log = [run({ at: 1 }), run({ at: 2 }), run({ at: 3 }), drill({ at: 4 })];
  const seen = observe(log).map((o) => o.key);
  assert.ok(seen.includes('coach.saw.ranThrough'));
});

t('drilling more than running is NOT flagged, however many run-throughs', () => {
  const log = [drill({ at: 1 }), drill({ at: 2 }), drill({ at: 3 }), drill({ at: 4 }), run({ at: 5 })];
  assert.equal(observe(log).some((o) => o.key === 'coach.saw.ranThrough'), false);
});

t('staying with one bar until it held is the behaviour worth naming', () => {
  const log = [
    drill({ at: 1, passed: false }), drill({ at: 2, passed: false }), drill({ at: 3, passed: true }),
  ];
  const stayed = observe(log).find((o) => o.key === 'coach.saw.stayed');
  assert.ok(stayed, 'the top practisers repeat the target until it is fixed');
  assert.equal(stayed.good, true);
  assert.equal(stayed.vars.n, 3);
  assert.equal(stayed.vars.label, 'bar 1');
});

t('slowing down and then getting it right is reported as the thing that worked', () => {
  const log = [
    drill({ at: 1, bpm: 60, passed: false }),
    drill({ at: 2, bpm: 58, passed: true }),
    drill({ at: 3, bpm: 58, passed: true }),
  ];
  assert.ok(observe(log).some((o) => o.key === 'coach.saw.slowedDown' && o.good));
});

t('one clean run and gone, repeatedly, is a fault and is named as one', () => {
  const log = [
    drill({ chunkId: 'a', at: 1, passed: true }),
    drill({ chunkId: 'b', at: 2, passed: true }),
    drill({ chunkId: 'c', at: 3, passed: true }),
  ];
  const one = observe(log).find((o) => o.key === 'coach.saw.oneAndGone');
  assert.ok(one);
  assert.equal(one.good, false);
  assert.ok(one.vars.n >= 2);
});

t('ending on a miss is caught, because the last thing played is what sticks', () => {
  const log = [drill({ at: 1 }), drill({ at: 2 }), drill({ at: 3, passed: false })];
  assert.ok(observe(log).some((o) => o.key === 'coach.saw.endedOnMiss'));
});

t('ending on a clean run is not', () => {
  const log = [drill({ at: 1, passed: false }), drill({ at: 2 }), drill({ at: 3 })];
  assert.equal(observe(log).some((o) => o.key === 'coach.saw.endedOnMiss'), false);
});

t('a list of nothing but faults is never returned', () => {
  // It would be accurate and it would be ignored by the third session, and then
  // it protects nothing.
  const log = [
    drill({ chunkId: 'a', at: 1, passed: false }), drill({ chunkId: 'b', at: 2, passed: false }),
    drill({ chunkId: 'c', at: 3, passed: false }), drill({ chunkId: 'd', at: 4, passed: false }),
    drill({ chunkId: 'e', at: 5, passed: false }), drill({ chunkId: 'f', at: 6, passed: false }),
  ];
  const seen = observe(log);
  assert.ok(seen.length >= 1);
  assert.ok(seen.length <= 3, 'never more than three things to think about');
});

t('at most three observations, however messy the sitting', () => {
  const log = [];
  for (let i = 0; i < 6; i++) log.push(drill({ chunkId: `c${i}`, at: i, passed: true }));
  for (let i = 0; i < 4; i++) log.push(run({ at: 10 + i }));
  log.push(drill({ chunkId: 'z', at: 99, passed: false }));
  assert.ok(observe(log).length <= 3);
});

t('the summary counts what it says it counts', () => {
  const log = [drill({ at: 1 }), drill({ at: 2, passed: false }), run({ at: 3 })];
  assert.deepEqual(summarise(log), { attempts: 3, drills: 2, runs: 1, clean: 2 });
});

console.log(`coach: ${pass} ok`);
