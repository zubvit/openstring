// The course: what to do today, and when it is finished.
//
// The app could already answer "is this note right?" and "am I fluent enough to
// move on?". It could not answer the question a beginner actually opens it with,
// which is "what should I do now?" - and a tool that puts six tabs in front of
// you and waits has quietly made you your own teacher again, exactly when you
// know least. That is the complaint this file answers: three open strings were
// fine, then the app asked for five new notes at once and never once gave him a
// tune to play.
//
// A lesson is a short ordered list of STEPS, each of which is an existing engine
// with its settings decided for him. Nothing here drills anything; it decides
// what the drill should be pointed at, and reads back from the same measured
// statistics the rest of the app already keeps.
//
// Two rules the whole design hangs on:
//
//   1. A step is finished when the MEASUREMENT says so, never when a button is
//      pressed and never after enough time. Everything below derives completion
//      from fluency stats and piece mastery that were recorded by playing.
//   2. Every lesson ends in music. Not an exercise with a title - a piece, with
//      the app playing the other part. Method books have done this since the
//      1830s for a reason: reading drills teach reading, and pieces are why
//      anybody bothers.

import { STAGES, stageById } from './curriculum.js';
import { soundingAt, parsePositionId } from './theory.js';
import { LESSONS } from './course.js';

export { LESSONS };

/** Which kinds of step exist, and which engine each one drives. */
export const STEP_ENGINES = {
  warmup: 'read',    // notes already known, mixed - keeps old material alive
  learn:  'read',    // the new note or notes, alone, until they stick
  read:   'read',    // the whole lesson's note set, interleaved
  rhythm: 'rhythm',  // a rhythm against the click, no pitch to worry about
  play:   'piece',   // a piece, read
  duet:   'piece',   // a piece with the app playing the other part
  ear:    'piece',   // learned by hearing it first - deliberately above his reading
};

export function lessonById(id) {
  return LESSONS.find((l) => l.id === id) || LESSONS[0];
}

export function lessonIndex(id) {
  const i = LESSONS.findIndex((l) => l.id === id);
  return i < 0 ? 0 : i;
}

export function nextLesson(id) {
  return LESSONS[lessonIndex(id) + 1] || null;
}

/**
 * Every position a lesson may ask about: the running total of what the course
 * has introduced up to and including it.
 *
 * NOT the stage's pool. A stage is split across two or three lessons, so its
 * pool holds notes the learner has not met yet - and drilling those is exactly
 * the cliff, in miniature. Lesson one is two notes where its stage has three.
 */
export function lessonPool(lesson) {
  const upto = lessonIndex(lesson.id);
  const out = [];
  const seen = new Set();
  for (let i = 0; i <= upto; i++) {
    for (const id of LESSONS[i].newNotes || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** The same positions as note records - what a piece is fingered from. */
export function lessonNotes(lesson) {
  return lessonPool(lesson).map((id) => {
    const p = parsePositionId(id);
    return { string: p.string, fret: p.fret, sounding: soundingAt(p.string, p.fret) };
  });
}

/**
 * Positions the lesson treats as ALREADY KNOWN - everything the course has
 * introduced BEFORE today. This is what the warm-up draws from, and it is why
 * old notes keep coming back instead of being finished with.
 */
export function knownPositions(lesson) {
  const fresh = new Set(lesson.newNotes || []);
  return lessonPool(lesson).filter((id) => !fresh.has(id));
}

/**
 * Is one position fluent?
 *
 * The same bar the stage ladder uses, deliberately: a step that let him past on
 * an easier standard than the stage would promote him into a stage he cannot
 * hold, which is the failure the ladder was rebuilt to prevent.
 */
export function fluent(stat) {
  return !!stat && stat.attempts >= 4 && stat.accuracy >= 0.85 && stat.avgMs <= 2000;
}

/**
 * Has this step been finished?
 *
 * `ctx` carries the measurements: `stats` (per-position fluency), `pieces` (per
 * piece, how many of its bars stand up at tempo), and `rounds` (goals reached,
 * by lesson and then step index - the one genuinely bookkeeping-shaped thing
 * here, because "he played twenty notes" leaves no trace in per-position
 * statistics).
 */
export function stepDone(step, index, ctx = {}, lessonId = null) {
  const { stats = {}, pieces = {} } = ctx;
  // `rounds` is keyed by lesson and then by step, because the same step index
  // means a different thing in every lesson and a flat map silently marked
  // lesson four's duet done because lesson two's warm-up had been.
  const rounds = (ctx.rounds || {})[lessonId] || {};
  switch (step.kind) {
    case 'learn': {
      const fresh = step.positions || [];
      return fresh.length > 0 && fresh.every((id) => fluent(stats[id]));
    }
    case 'warmup':
    case 'read':
    case 'rhythm':
      return !!rounds[index];
    case 'play':
    case 'duet':
    case 'ear': {
      const p = pieces[step.piece];
      return !!p && p.bars > 0 && p.solid >= p.bars;
    }
    default:
      return false;
  }
}

/**
 * The whole lesson, step by step, with the one to do next marked.
 *
 * Steps unlock in order. That is not arbitrary strictness: the reading step is
 * built out of the note the learn step teaches, and the piece is built out of
 * both, so offering them at once is the cliff again in miniature.
 */
export function lessonPlan(lesson, ctx = {}) {
  const steps = (lesson.steps || []).map((step, index) => ({
    step, index, done: stepDone(step, index, ctx, lesson.id),
  }));
  let reached = true;
  for (const s of steps) {
    s.unlocked = reached;
    s.current = reached && !s.done;
    if (!s.done) reached = false;
  }
  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    doneCount,
    total: steps.length,
    percent: steps.length ? Math.round((doneCount / steps.length) * 100) : 0,
    complete: doneCount === steps.length && steps.length > 0,
    current: steps.find((s) => s.current) || null,
  };
}

/**
 * Which lesson to open on.
 *
 * The first unfinished one, so the app opens on the thing to do rather than on
 * wherever he happened to leave off. If everything is finished it opens on the
 * last lesson, which is honest - there is no more course - rather than looping
 * back to the beginning and pretending there is.
 */
export function currentLesson(ctx = {}) {
  for (const l of LESSONS) if (!lessonPlan(l, ctx).complete) return l;
  return LESSONS[LESSONS.length - 1];
}

/**
 * Which lessons he may open.
 *
 * Backwards is always allowed - replaying a lesson is ordinary practice, and the
 * app used to have no way to do it at all. Forwards is earned, one at a time, by
 * finishing the one before. Nothing extra is stored: this is recomputed from the
 * same measurements, so it heals itself if he jumps back.
 */
export function unlockedLessons(ctx = {}) {
  let prevComplete = true;
  return LESSONS.map((lesson, index) => {
    const plan = lessonPlan(lesson, ctx);
    const unlocked = index === 0 || prevComplete;
    prevComplete = plan.complete;
    return { lesson, index, plan, unlocked };
  });
}

/**
 * What to say after a failed attempt.
 *
 * Three strikes is not a punishment, it is the app admitting the step is too
 * hard right now and offering the way back down: hear it, slow it, or go back to
 * the note on its own. Saying "try again" a fourth time is how an app teaches
 * someone that it is not listening.
 */
export function afterFailure(step, misses) {
  if (misses <= 1) return { key: 'lesson.tryAgain', offer: null };
  if (misses === 2) return { key: 'lesson.hearItFirst', offer: 'hear' };
  if (misses === 3) return { key: 'lesson.slowItDown', offer: 'slower' };
  return { key: 'lesson.backToTheNote', offer: 'back' };
}

/**
 * The stages a lesson list covers, in order, with their lessons - the map view.
 */
export function lessonsByStage(lessons = LESSONS) {
  return STAGES.map((stage) => ({
    stage,
    lessons: lessons.filter((l) => l.stage === stage.id),
  })).filter((g) => g.lessons.length);
}
