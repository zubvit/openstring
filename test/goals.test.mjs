import assert from 'node:assert/strict';
import {
  GOALS, DEFAULT_GOAL_ID, goalById, goalProgress, stageFinished, roundOver, STAGE_BAR_STREAK,
} from '../js/goals.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// A run of twenty right in a row, not twenty notes played. His call, and the
// better bar: a count of notes measures attendance, a run measures reading.
// "say we introduce a forth note, then... still 20 looks great" - and it does,
// because a longer pool makes the same run harder to hold rather than needing
// a bigger number.

const streak20 = goalById('streak20');
const state = (o) => ({ streak: 0, asked: 0, elapsedMs: 0, poolSize: 3, metCorrectly: 3, ...o });

t('twenty in a row is the default', () => {
  assert.equal(DEFAULT_GOAL_ID, 'streak20');
  assert.equal(GOALS[0].id, 'streak20');
  assert.equal(streak20.n, STAGE_BAR_STREAK);
});

t('every goal is offered with a label the app knows how to build', () => {
  const kinds = new Set(['streak', 'notes', 'time', 'open']);
  for (const g of GOALS) {
    assert.ok(kinds.has(g.kind), `${g.id} has an unknown kind`);
    assert.equal(typeof g.completesStage, 'boolean', `${g.id} does not say whether it finishes a level`);
    if (g.kind === 'streak' || g.kind === 'notes') assert.ok(g.n > 0);
    if (g.kind === 'time') assert.ok(g.ms > 0);
  }
  assert.equal(new Set(GOALS.map((g) => g.id)).size, GOALS.length, 'duplicate goal id');
});

t('the run has to be unbroken', () => {
  assert.equal(roundOver(streak20, state({ streak: 19 })), null);
  assert.equal(roundOver(streak20, state({ streak: 20 })), 'stage');
  // A hundred notes played with a slip in the middle finishes nothing.
  assert.equal(roundOver(streak20, state({ streak: 3, asked: 100 })), null);
});

t('reaching the run finishes the level, not just the round', () => {
  assert.equal(roundOver(streak20, state({ streak: 20 })), 'stage');
});

t('a shorter or longer run can be chosen, and each finishes the level', () => {
  assert.equal(roundOver(goalById('streak10'), state({ streak: 10 })), 'stage');
  assert.equal(roundOver(goalById('streak40'), state({ streak: 20 })), null, '40 must mean 40');
  assert.equal(roundOver(goalById('streak40'), state({ streak: 40 })), 'stage');
});

t('a level cannot be finished with notes never played', () => {
  // A run of twenty cannot touch all thirty-six positions of a late stage, so a
  // streak alone would promote him out of a stage he had half met.
  assert.equal(roundOver(streak20, state({ streak: 20, poolSize: 36, metCorrectly: 20 })), 'round',
    'finished a stage with sixteen notes never found');
  assert.equal(roundOver(streak20, state({ streak: 20, poolSize: 36, metCorrectly: 36 })), 'stage');
});

t('practice goals end the round and claim nothing about the level', () => {
  // A fixed number of notes, or a fixed time: useful on a stage just opened,
  // where a run is not yet realistic and failing at one all session is no help.
  assert.equal(roundOver(goalById('notes20'), state({ asked: 20, streak: 20 })), 'round');
  assert.equal(roundOver(goalById('time5'), state({ elapsedMs: 5 * 60 * 1000, streak: 20 })), 'round');
  for (const id of ['notes20', 'time5', 'open']) {
    assert.equal(stageFinished(goalById(id), state({ streak: 999 })), false,
      `${id} should not finish a level`);
  }
});

t('the open goal never ends by itself', () => {
  const open = goalById('open');
  assert.equal(roundOver(open, state({ asked: 500, streak: 500, elapsedMs: 9e6 })), null);
  assert.equal(goalProgress(open, { asked: 7 }).target, null, 'an open round must show no target');
  assert.equal(goalProgress(open, { asked: 7 }).current, 7);
});

t('progress reports the thing the goal is actually counting', () => {
  // The row on the card and the thing that ends the round must never be two
  // different numbers - that is what made the old "20 notes" round confusing.
  assert.deepEqual(goalProgress(streak20, { streak: 7, asked: 40 }), { current: 7, target: 20, reached: false });
  assert.deepEqual(goalProgress(goalById('notes20'), { streak: 7, asked: 12 }), { current: 12, target: 20, reached: false });
  const time = goalProgress(goalById('time5'), { elapsedMs: 60000 });
  assert.equal(time.current, 60000);
  assert.equal(time.target, 300000);
  assert.equal(time.reached, false);
});

t('an unknown or missing goal falls back to the default rather than breaking', () => {
  assert.equal(goalById('nonsense').id, DEFAULT_GOAL_ID);
  assert.equal(goalById(undefined).id, DEFAULT_GOAL_ID);
});

t('an empty stage can never be reported as finished', () => {
  assert.equal(stageFinished(streak20, { streak: 20, poolSize: 0, metCorrectly: 0 }), false);
});

console.log(`goals: ${pass} groups passed`);
