// What "done with this level" means - and letting the player decide.
//
// The drill used to end after twenty notes played, however many were wrong.
// That measures attendance, not reading. Twenty RIGHT IN A ROW is a different
// and much better bar: one slip and the count starts again, so it cannot be
// reached by grinding, and it stays honest when the stage grows. Three notes or
// four, twenty unbroken is twenty unbroken - the run just gets harder to hold
// because more can go wrong in it.
//
// Two kinds of goal live here, and the difference matters:
//
//   A LEVEL BAR is a run without mistakes. Reaching it finishes the stage.
//   A PRACTICE ROUND has a size but no standard - a set number of notes, or a
//   set time. It gives the session a finish line without claiming anything
//   about how well it went, which is what you want on a stage you have just
//   opened and cannot yet hold a run on.
//
// Everything here is arithmetic on a few numbers, so the rules can be checked
// without a microphone, a browser or a guitar.

/** In display order. The first is the default. */
export const GOALS = [
  { id: 'streak20', kind: 'streak', n: 20, completesStage: true },
  { id: 'streak10', kind: 'streak', n: 10, completesStage: true },
  { id: 'streak40', kind: 'streak', n: 40, completesStage: true },
  { id: 'notes20',  kind: 'notes',  n: 20, completesStage: false },
  { id: 'time5',    kind: 'time',   ms: 5 * 60 * 1000, completesStage: false },
  { id: 'open',     kind: 'open',   completesStage: false },
];

export const DEFAULT_GOAL_ID = GOALS[0].id;

/** The bar a stage must clear to count as finished, whatever goal is chosen. */
export const STAGE_BAR_STREAK = 20;

export function goalById(id) {
  return GOALS.find((g) => g.id === id) || GOALS[0];
}

/**
 * Where this round has got to.
 *
 * `current` and `target` are for showing; `reached` is the decision. An open
 * round has no target and is never reached - it ends when he says so.
 */
export function goalProgress(goal, { streak = 0, asked = 0, elapsedMs = 0 } = {}) {
  switch (goal.kind) {
    case 'streak': return { current: streak,    target: goal.n,  reached: streak >= goal.n };
    case 'notes':  return { current: asked,     target: goal.n,  reached: asked >= goal.n };
    case 'time':   return { current: elapsedMs, target: goal.ms, reached: elapsedMs >= goal.ms };
    default:       return { current: asked,     target: null,    reached: false };
  }
}

/**
 * Is the stage finished?
 *
 * Two conditions, and the second is not fussiness. A twenty-note run cannot
 * touch every position of a stage that has thirty-six of them, so a streak
 * alone would let a late stage be "completed" with half its notes never played.
 * So: the run has to be there, AND every note in the stage has to have been
 * found correctly at least once. On the early stages, where the pool is smaller
 * than the run, the second condition is met on the way to the first.
 */
export function stageFinished(goal, { streak = 0, poolSize = 0, metCorrectly = 0 } = {}) {
  if (!goal.completesStage) return false;
  if (streak < goal.n) return false;
  return poolSize > 0 && metCorrectly >= poolSize;
}

/**
 * Why this round stopped: 'stage', 'round', or null to carry on.
 *
 * Finishing the stage outranks finishing the round - if both land on the same
 * note, he deserves to hear the bigger news.
 */
export function roundOver(goal, state) {
  if (stageFinished(goal, state)) return 'stage';
  return goalProgress(goal, state).reached ? 'round' : null;
}
