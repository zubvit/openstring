import assert from 'node:assert/strict';
import {
  LESSONS, lessonById, nextLesson, lessonPlan, currentLesson, unlockedLessons,
  knownPositions, lessonPool, stepDone, fluent, afterFailure, STEP_ENGINES,
} from '../js/lesson.js';
import { STAGES } from '../js/curriculum.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// The course exists because of one complaint: "it is not incremental, does not
// build on top of those 3". Everything below is that complaint turned into a
// rule a program can check.

const good = { attempts: 6, accuracy: 0.95, avgMs: 900 };
const slow = { attempts: 6, accuracy: 0.95, avgMs: 4000 };
const ctx = (o = {}) => ({ stats: {}, pieces: {}, rounds: {}, ...o });

t('the course is in order and each lesson names a stage that exists', () => {
  const stageIds = new Set(STAGES.map((s) => s.id));
  LESSONS.forEach((l, i) => {
    assert.equal(l.n, i + 1, `${l.id} is numbered ${l.n} but sits at ${i + 1}`);
    assert.ok(stageIds.has(l.stage), `${l.id} names a stage that does not exist: ${l.stage}`);
    assert.ok(l.steps?.length, `${l.id} has no steps`);
  });
});

t('the lessons follow the stage ladder rather than jumping about in it', () => {
  const order = STAGES.map((s) => s.id);
  let at = -1;
  for (const l of LESSONS) {
    const i = order.indexOf(l.stage);
    assert.ok(i >= at, `${l.id} goes back to ${l.stage} after a later stage`);
    at = i;
  }
});

// The thing that actually went wrong: five new notes arrived at once.
t('no lesson introduces more than three new notes', () => {
  for (const l of LESSONS) {
    const n = (l.newNotes || []).length;
    assert.ok(n > 0, `${l.id} introduces nothing`);
    assert.ok(n <= 3, `${l.id} introduces ${n} notes at once, which is the cliff again`);
  }
});

t('a lesson never introduces a note an earlier lesson already did', () => {
  const seen = new Set();
  for (const l of LESSONS) {
    for (const id of l.newNotes || []) {
      assert.ok(!seen.has(id), `${l.id} re-introduces ${id}`);
      seen.add(id);
    }
  }
});

t('every step names an engine that exists', () => {
  for (const l of LESSONS) {
    for (const s of l.steps) {
      assert.ok(STEP_ENGINES[s.kind], `${l.id} has a step of unknown kind: ${s.kind}`);
    }
  }
});

t('the learn step teaches exactly the notes the lesson says are new', () => {
  for (const l of LESSONS) {
    const learn = l.steps.find((s) => s.kind === 'learn');
    assert.ok(learn, `${l.id} has no step that introduces its new notes`);
    assert.deepEqual([...learn.positions].sort(), [...l.newNotes].sort(),
      `${l.id}: the learn step and newNotes disagree`);
  }
});

// Old material has to keep coming back. Without this a note learned in lesson
// two is never seen again, which is how a "course" becomes a list of things you
// have each done once.
t('the warm-up draws on old notes and deliberately excludes the new one', () => {
  for (const l of LESSONS.slice(1)) {
    const known = knownPositions(l);
    assert.ok(known.length > 0, `${l.id} has nothing to warm up on`);
    for (const fresh of l.newNotes) {
      assert.ok(!known.includes(fresh), `${l.id} warms up on ${fresh}, which is today's new note`);
    }
    for (const id of known) assert.ok(lessonPool(l).includes(id));
  }
});

t('the first lesson has nothing to warm up on, and does not pretend otherwise', () => {
  assert.equal(LESSONS[0].steps.some((s) => s.kind === 'warmup'), false);
});

t('a step is finished by measurement, never by pressing a button', () => {
  const l = LESSONS[1];                       // one new note: s3f2
  const learn = l.steps.findIndex((s) => s.kind === 'learn');
  assert.equal(stepDone(l.steps[learn], learn, ctx()), false, 'nothing played yet');
  assert.equal(stepDone(l.steps[learn], learn, ctx({ stats: { s3f2: slow } })), false,
    'correct but slow is not learned');
  assert.equal(stepDone(l.steps[learn], learn, ctx({ stats: { s3f2: good } })), true);
});

t('a piece step is finished when its bars stand up, not when it is opened', () => {
  const step = { kind: 'duet', piece: 'hot-cross-buns' };
  assert.equal(stepDone(step, 0, ctx()), false);
  assert.equal(stepDone(step, 0, ctx({ pieces: { 'hot-cross-buns': { bars: 4, solid: 2 } } })), false);
  assert.equal(stepDone(step, 0, ctx({ pieces: { 'hot-cross-buns': { bars: 4, solid: 4 } } })), true);
  assert.equal(stepDone(step, 0, ctx({ pieces: { 'hot-cross-buns': { bars: 0, solid: 0 } } })), false,
    'a piece with no bars is not a finished piece');
});

t('a finished round belongs to ONE lesson, not to every lesson at that index', () => {
  // Flat by step index, lesson four's duet was marked done because lesson two's
  // warm-up had been. Rounds are keyed by lesson for exactly that reason.
  const rounds = { l2: { 0: true } };
  const l2 = lessonById('l2');
  const l4 = lessonById('l4');
  assert.equal(stepDone(l2.steps[0], 0, ctx({ rounds }), 'l2'), true);
  assert.equal(stepDone(l4.steps[0], 0, ctx({ rounds }), 'l4'), false);
});

t('steps unlock one at a time, because each is built from the one before', () => {
  const plan = lessonPlan(LESSONS[0], ctx());
  assert.equal(plan.steps[0].unlocked, true);
  assert.equal(plan.steps[0].current, true);
  assert.equal(plan.steps[1].unlocked, false, 'reading comes after meeting the notes');
  assert.equal(plan.percent, 0);
  assert.equal(plan.complete, false);
});

t('finishing a step opens the next one and nothing further', () => {
  const l = LESSONS[0];
  const stats = Object.fromEntries(l.newNotes.map((id) => [id, good]));
  const plan = lessonPlan(l, ctx({ stats }));
  assert.equal(plan.steps[0].done, true);
  assert.equal(plan.steps[1].unlocked, true);
  assert.equal(plan.steps[1].current, true);
  assert.equal(plan.steps[2].unlocked, false);
});

t('a lesson is complete only when every step is', () => {
  const l = LESSONS[0];
  const stats = Object.fromEntries(l.newNotes.map((id) => [id, good]));
  const rounds = { l1: { 1: true } };
  const pieces = { 'bell-tower': { bars: 8, solid: 8 }, 'evening-round': { bars: 8, solid: 8 } };
  assert.equal(lessonPlan(l, ctx({ stats, rounds })).complete, false, 'the duets are not done');
  const full = lessonPlan(l, ctx({ stats, rounds, pieces }));
  assert.equal(full.complete, true);
  assert.equal(full.percent, 100);
});

t('the app opens on the first thing not yet finished', () => {
  assert.equal(currentLesson(ctx()).id, 'l1');
  const stats = Object.fromEntries(LESSONS[0].newNotes.map((id) => [id, good]));
  const done = ctx({
    stats,
    rounds: { l1: { 1: true } },
    pieces: { 'bell-tower': { bars: 8, solid: 8 }, 'evening-round': { bars: 8, solid: 8 } },
  });
  assert.equal(currentLesson(done).id, 'l2');
});

t('with everything finished it stays on the last lesson rather than looping', () => {
  const all = ctx({
    stats: Object.fromEntries(LESSONS.flatMap((l) => l.newNotes).map((id) => [id, good])),
    rounds: Object.fromEntries(LESSONS.map((l) => [l.id,
      Object.fromEntries(l.steps.map((s, i) => [i, true]))])),
    pieces: Object.fromEntries(LESSONS.flatMap((l) => l.steps)
      .filter((s) => s.piece).map((s) => [s.piece, { bars: 99, solid: 99 }])),
  });
  assert.equal(currentLesson(all).id, LESSONS[LESSONS.length - 1].id);
});

t('going back is always allowed; going forward is earned one at a time', () => {
  const rows = unlockedLessons(ctx());
  assert.equal(rows[0].unlocked, true);
  assert.equal(rows[1].unlocked, false);
  assert.equal(rows[2].unlocked, false, 'two ahead is never open');
});

t('fluency here is the same bar the stage ladder uses', () => {
  assert.equal(fluent(undefined), false);
  assert.equal(fluent({ attempts: 3, accuracy: 1, avgMs: 500 }), false, 'too few tries');
  assert.equal(fluent({ attempts: 8, accuracy: 0.8, avgMs: 500 }), false, 'not accurate enough');
  assert.equal(fluent({ attempts: 8, accuracy: 1, avgMs: 2500 }), false, 'too slow to be reading');
  assert.equal(fluent(good), true);
});

t('failing repeatedly offers a way down, and stops repeating itself', () => {
  const step = { kind: 'duet', piece: 'x' };
  assert.equal(afterFailure(step, 1).offer, null);
  assert.equal(afterFailure(step, 2).offer, 'hear');
  assert.equal(afterFailure(step, 3).offer, 'slower');
  assert.equal(afterFailure(step, 6).offer, 'back');
  const keys = [1, 2, 3, 4].map((n) => afterFailure(step, n).key);
  assert.equal(new Set(keys).size, 4, 'it says the same thing every time');
});

t('nextLesson runs out at the end instead of wrapping', () => {
  assert.equal(nextLesson('l1').id, 'l2');
  assert.equal(nextLesson(LESSONS[LESSONS.length - 1].id), null);
  assert.equal(lessonById('nonsense').id, LESSONS[0].id, 'an unknown id falls back, never throws');
});

console.log(`lesson: ${pass} ok`);
