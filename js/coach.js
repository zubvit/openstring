// What a teacher would say, if one were in the practice room.
//
// The app had two silences in it, and they were the same silence.
//
// It made good decisions and never said why. It picked the bar you were worst
// at, dropped the tempo when you missed and raised it after two clean runs -
// all of which is what a good practiser does - and it did every bit of it
// invisibly. So the method stayed in the code. If the app vanished you would
// keep the note recognition and none of the reasoning, which is a strange thing
// for a teacher to leave behind.
//
// And it measured what you played without ever measuring HOW YOU PRACTISED.
// That distinction is the strongest finding in the practice literature. Duke,
// Simmons and Cash watched seventeen advanced pianists learn a hard passage and
// found that time spent, number of repetitions and number of complete run-
// throughs predicted nothing about how well they played it the next day. What
// separated the best was the handling of mistakes: they found the error
// exactly, went at it rather than round it, changed tempo deliberately, and
// kept repeating after it first came right.
//
// Every one of those is audible in a stream of attempts, and none of it was
// being looked at.
//
// Nothing here nags. Two rules: an observation must be something he can do
// differently next time, and what he did WELL counts as an observation - the
// point is to name the method so it transfers, not to keep score.

import { LAYERS, LADDER, chunkMastered } from './practice.js';

// ------------------------------------------------------- why this, why now

/**
 * Why the app chose this bar.
 *
 * Read off the same properties `pickChunk` weights, so it cannot flatter: if it
 * says "this is the one you are furthest behind on", that is because the
 * scheduler weighted it that way, not because a sentence was picked to sound
 * encouraging.
 */
export function whyThisChunk(chunk, state, { targetBpm = 80 } = {}) {
  if (!chunk) return null;
  if (!state || !state.attempts) {
    return { key: 'coach.why.new', vars: {} };
  }
  if (chunk.kind === 'seam') {
    return { key: 'coach.why.seam', vars: { from: chunk.firstMeasure, to: chunk.lastMeasure } };
  }
  if (state.bpm < targetBpm * 0.75) {
    return { key: 'coach.why.behind', vars: { bpm: state.bpm, target: targetBpm } };
  }
  if (chunkMastered(state, targetBpm)) {
    return { key: 'coach.why.keeping', vars: {} };
  }
  return { key: 'coach.why.shallow', vars: { layer: LAYERS[state.layerIndex] } };
}

/**
 * Why the tempo or the demand just moved.
 *
 * The ladder goes up in fours and down in twos, so retreat is slower than
 * advance - a deliberate asymmetry that is invisible unless somebody says it.
 */
export function whyThisMove(before, after, { targetBpm = 80, passed = false } = {}) {
  if (!before || !after) return null;
  if (!passed) {
    return after.bpm < before.bpm
      ? { key: 'coach.move.slower', vars: { bpm: after.bpm, by: LADDER.down } }
      : { key: 'coach.move.holding', vars: { bpm: after.bpm } };
  }
  if (after.bpm > before.bpm) {
    return { key: 'coach.move.faster', vars: { bpm: after.bpm, target: targetBpm } };
  }
  if (after.layerIndex > before.layerIndex) {
    return { key: 'coach.move.layer', vars: { layer: LAYERS[after.layerIndex] } };
  }
  // A clean run that changed nothing is the second-clean-run rule doing its job,
  // and it is the single most counter-intuitive thing the engine does.
  return { key: 'coach.move.again', vars: {} };
}

/**
 * Why the reading drill asked for this note.
 *
 * Same discipline as the bars: read off the properties `weightFor` actually
 * scores, so the sentence and the decision cannot come apart. The reading drill
 * is where he spends most of his time and it has never once said why it wanted
 * a particular note - which makes it feel random, and random is exactly what it
 * is not.
 */
export function whyThisNote(stat) {
  if (!stat || !stat.attempts) return { key: 'coach.note.new', vars: {} };
  if (stat.accuracy < 0.7) return { key: 'coach.note.missed', vars: {} };
  if (stat.avgMs > 2000) {
    return { key: 'coach.note.slow', vars: { s: (stat.avgMs / 1000).toFixed(1) } };
  }
  if (stat.attempts < 4) return { key: 'coach.note.unproven', vars: { n: stat.attempts } };
  return { key: 'coach.note.keeping', vars: {} };
}

// --------------------------------------------------------- how you practised

/**
 * One attempt, as the coach sees it.
 * { chunkId, kind: 'chunk' | 'seam' | 'whole', bpm, passed, at }
 */

const isDrill = (e) => e.kind !== 'whole';

/**
 * Read a sitting and say what kind of practice it was.
 *
 * Returns observations worst-first, but always keeps one good one if there is
 * one, because a list that only ever contains faults gets ignored by the third
 * session and then it protects nothing.
 */
export function observe(log = [], { targetBpm = 80, limit = 3 } = {}) {
  const out = [];
  if (log.length < 3) return out;

  const drills = log.filter(isDrill);
  const runs = log.filter((e) => e.kind === 'whole');

  // --- ran it through instead of practising it
  //
  // The most common way to practise badly, and the most comfortable: playing
  // the whole piece again rehearses the parts you can already play and gives
  // the hard bar one more unprepared attempt out of every twenty.
  if (runs.length >= 2 && runs.length >= drills.length) {
    out.push({ key: 'coach.saw.ranThrough', good: false,
      vars: { runs: runs.length, drills: drills.length } });
  }

  // --- stayed with one thing until it held
  const byChunk = new Map();
  for (const e of drills) byChunk.set(e.chunkId, [...(byChunk.get(e.chunkId) || []), e]);
  const stayed = [...byChunk.entries()].filter(([, es]) => es.length >= 3);
  if (stayed.length) {
    const [, worked] = stayed.sort((a, b) => b[1].length - a[1].length)[0];
    out.push({ key: 'coach.saw.stayed', good: true,
      vars: { label: worked[0].label || '', n: worked.length } });
  }

  // --- slowing down worked, and it is worth knowing that it worked
  const rescued = [...byChunk.values()].some((es) => {
    for (let i = 1; i < es.length; i++) {
      if (es[i].bpm < es[i - 1].bpm && es[i].passed) return true;
    }
    return false;
  });
  if (rescued) out.push({ key: 'coach.saw.slowedDown', good: true, vars: {} });

  // --- one clean run and moved on
  //
  // One clean run is luck; the engine wants two before it moves, and the reason
  // is that the second is the one that proves the first.
  const droppedEarly = [...byChunk.values()].filter((es) => {
    const last = es[es.length - 1];
    return es.length === 1 && last.passed;
  }).length;
  if (droppedEarly >= 2) {
    out.push({ key: 'coach.saw.oneAndGone', good: false, vars: { n: droppedEarly } });
  }

  // --- scattered: touched many things once each
  if (byChunk.size >= 5 && drills.length / byChunk.size < 1.5) {
    out.push({ key: 'coach.saw.scattered', good: false, vars: { n: byChunk.size } });
  }

  // --- ended on a miss
  //
  // The last thing you play is the one you carry to tomorrow. Ending on a
  // failed attempt is the cheapest avoidable mistake in the whole sitting.
  const last = log[log.length - 1];
  if (last && !last.passed) out.push({ key: 'coach.saw.endedOnMiss', good: false, vars: {} });

  const bad = out.filter((o) => !o.good);
  const good = out.filter((o) => o.good);
  // Faults first, because they are what changes tomorrow - but a list with
  // nothing he did right in it gets ignored by the third session, and then it
  // protects nothing. So one slot is always held back for something that went
  // well, and a clean sitting fills the whole card with what worked.
  const keepBad = Math.min(bad.length, good.length ? limit - 1 : limit);
  return [...bad.slice(0, keepBad), ...good.slice(0, limit - keepBad)];
}

/** A one-line verdict on the sitting, for the top of the card. */
export function summarise(log = []) {
  const drills = log.filter(isDrill).length;
  const runs = log.filter((e) => e.kind === 'whole').length;
  const clean = log.filter((e) => e.passed).length;
  return { attempts: log.length, drills, runs, clean };
}
