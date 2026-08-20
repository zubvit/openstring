// Reading by distance.
//
// The alternative to naming every note is to know a few anchors and read
// everything else as a distance from the nearest one. Naming is what beginners
// are taught - the acronyms - and it never gets faster, because the work does
// not shrink with practice: every note is spelled out from the bottom line
// again. Distance does get faster, because a third LOOKS like a third.
//
// So this drill shows two notes. The first is an anchor you already know; the
// second is only findable by measuring from it. Everything here is arithmetic
// on staff degrees rather than semitones - a third is a third whether or not
// it is major, and that is exactly the point of reading this way.

import { spell, writtenAt, positionId, parsePositionId } from './theory.js';
import { pickNext, updateStat, emptyStat, isFluent } from './srs.js';

/**
 * The open strings that land inside the staff with no ledger lines: G on the
 * second line, B on the middle line, E in the top space. They make the best
 * anchors because they need no fingers and cannot be fumbled.
 */
export const LANDMARK_IDS = ['s3f0', 's2f0', 's1f0'];

/** Biggest distance worth reading as one jump. Beyond an octave you count. */
export const MAX_INTERVAL = 8;

/** Staff degree of a fretboard position - the line-or-space it sits on. */
export function degreeOf(id) {
  const pos = parsePositionId(id);
  if (!pos) return null;
  return spell(writtenAt(pos.string, pos.fret)).diatonic;
}

/**
 * The distance between two written pitches, counted the way musicians count it:
 * inclusively, so a note to the one above it is a SECOND, not a first. Sharps
 * and flats do not enter into it - this is the distance on the page.
 */
export function intervalBetween(fromDegree, toDegree) {
  if (fromDegree == null || toDegree == null) return null;
  const steps = toDegree - fromDegree;
  return {
    number: Math.abs(steps) + 1,
    direction: steps > 0 ? 'up' : steps < 0 ? 'down' : 'same',
  };
}

/**
 * Choose the note to measure from.
 *
 * Landmarks first - the whole method rests on measuring from something you know
 * cold - and among those, the nearest one, because a third is easier to see than
 * a seventh. Ties break on the position id so the same target always produces
 * the same question rather than a different one each time.
 *
 * Returns null when nothing in the pool is within an octave, and the caller
 * should ask an ordinary single-note question instead of inventing an anchor.
 */
export function pickAnchor(targetId, pool, { landmarks = LANDMARK_IDS } = {}) {
  const targetDegree = degreeOf(targetId);
  if (targetDegree == null) return null;

  const candidates = pool
    .filter((id) => id !== targetId)
    .map((id) => ({ id, interval: intervalBetween(degreeOf(id), targetDegree) }))
    .filter((c) => c.interval && c.interval.number >= 2 && c.interval.number <= MAX_INTERVAL);
  if (!candidates.length) return null;

  const inPool = new Set(landmarks);
  const preferred = candidates.filter((c) => inPool.has(c.id));
  const usable = preferred.length ? preferred : candidates;

  usable.sort((a, b) => a.interval.number - b.interval.number || (a.id < b.id ? -1 : 1));
  return usable[0].id;
}

/**
 * Every distance worth drilling, as scheduler items: a number and a direction.
 *
 * The seventh is missing on purpose. Melodies avoid it - it is the one leap a
 * simple tune essentially never makes - so a drill built out of tunes could
 * never show one, and an item that can never appear would sit in the scheduler
 * forever looking neglected. The octave stays: it is a big jump but a common
 * and an easy one to hear.
 */
export const MELODIC_NUMBERS = [2, 3, 4, 5, 6, 8];

export const INTERVAL_IDS = MELODIC_NUMBERS.flatMap((n) => [`+${n}`, `-${n}`]);

export function intervalId({ number, direction }) {
  return `${direction === 'down' ? '-' : '+'}${number}`;
}

export function parseIntervalId(id) {
  const m = /^([+-])(\d+)$/.exec(id || '');
  if (!m) return null;
  return { number: Number(m[2]), direction: m[1] === '-' ? 'down' : 'up' };
}

/** Translation key for a distance: interval.2 through interval.8. */
export function intervalKey(number) {
  return `interval.${number}`;
}

/** The position that distance away from here, or null if it is not in the pool. */
function move(fromId, { number, direction }, byDegree) {
  const from = degreeOf(fromId);
  if (from == null) return null;
  const to = from + (direction === 'down' ? -1 : 1) * (number - 1);
  const at = byDegree.get(to);
  return at || null;
}

// A leap wants resolving. Real melodies turn round after a big jump and step
// back into the gap; a random walk does not, and sounds like one. This is the
// single rule that makes the difference between a phrase and a note list.
const LEAP = 4;

/**
 * Build a short melody out of the distances the scheduler wants drilled.
 *
 * The point is that the intervals are practised inside something that sounds
 * like music rather than as isolated pairs of notes - you meet a third in a
 * tune, not on a flashcard. The constraints are all explicit rules, not
 * tuned numbers:
 *
 *   - it starts and ends on a landmark, so it has somewhere to come home to;
 *   - every note is inside the stage's own region, so nothing appears that the
 *     drill has not taught yet;
 *   - a leap of a fourth or more is answered by a step back the other way;
 *   - at most one leap in a phrase, never as the first move and never as the
 *     last - a tune that opens by jumping, or ends mid-jump, is not a simple
 *     tune, it is a note list;
 *   - the same note never repeats immediately, and never comes straight back
 *     after leaving - G B G B G is a stall, not a tune.
 *
 * The scheduler chooses WHICH distance to try next; these rules decide whether
 * it can be used here. When it cannot, the next-weakest is tried instead, so
 * practice still leans on the weak ones without ever breaking the shape.
 */
export function buildMelody(pool, stats = {}, {
  length = 5,
  landmarks = LANDMARK_IDS,
  now = Date.now(),
  random = Math.random,
} = {}) {
  const byDegree = new Map();
  for (const id of pool) {
    const d = degreeOf(id);
    // Two positions can be the same written note; the lower string is the one
    // a beginner is being taught to use, and picking deterministically matters
    // more than which one wins.
    if (d != null && !byDegree.has(d)) byDegree.set(d, id);
    else if (d != null && byDegree.get(d) > id) byDegree.set(d, id);
  }

  const anchors = landmarks.filter((id) => pool.includes(id));
  const starts = anchors.length ? shuffled(anchors, random) : pool.slice(0, 1);
  if (!starts.length) return null;

  // Not every landmark can open a phrase - from the top one, every move in a
  // three-note pool is a leap, and leaps may not open. So try each in turn and
  // take the first that works rather than giving up on the first refusal.
  for (const start of starts) {
    const built = growFrom(start, { byDegree, anchors, stats, length, now, random, notes: [start] });
    if (built) return built;
  }
  return null;
}

function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function growFrom(start, { byDegree, anchors, stats, length, now, random }) {
  const notes = [start];
  const used = [];
  let lastLeap = null;
  let leaps = 0;

  for (let i = 1; i < length; i++) {
    const from = notes[i - 1];
    // Ask the scheduler in order of need, and take the first that fits here.
    const wanted = orderedByNeed(INTERVAL_IDS, stats, { now, random });
    let placed = null;

    for (const id of wanted) {
      const iv = parseIntervalId(id);
      // Answer a leap with a step the other way, or it never resolves.
      if (lastLeap) {
        if (iv.number !== 2) continue;
        if (iv.direction === lastLeap) continue;
      }
      // One leap is a shape; two is a scramble. A phrase does not end on one -
      // there would be nothing left to resolve it with - and it does not open
      // with one either, because there is nothing yet to leap away from.
      if (iv.number >= LEAP && (leaps >= 1 || i === 1 || i === length - 1)) continue;
      const to = move(from, iv, byDegree);
      if (!to || to === from) continue;
      // Going straight back where you came from oscillates rather than moves.
      if (notes.length >= 2 && to === notes[notes.length - 2]) continue;
      // The last note comes home, so the phrase ends somewhere and not mid-air.
      if (i === length - 1 && anchors.length && !anchors.includes(to)) continue;
      placed = { id, iv, to };
      break;
    }

    if (!placed) break;

    notes.push(placed.to);
    used.push({ id: placed.id, ...placed.iv, from, to: placed.to });
    if (placed.iv.number >= LEAP) leaps += 1;
    lastLeap = placed.iv.number >= LEAP ? placed.iv.direction : null;
  }

  // The loop can stop early when nothing fits, which would leave the phrase
  // hanging on whatever it managed last - including a leap. Trim back until it
  // ends on a step or a skip, because an unresolved leap is the one ending that
  // sounds like a mistake rather than a phrase.
  while (used.length && notes.length > 2 && used[used.length - 1].number >= LEAP) {
    notes.pop();
    used.pop();
  }

  if (notes.length < 2) return null;
  return { notes, intervals: used };
}

/**
 * The scheduler's preference order rather than a single pick, so a caller that
 * cannot use the first choice can fall through to the next without losing the
 * weighting. Same weights the note drill uses.
 */
function orderedByNeed(ids, stats, { now, random }) {
  const left = [...ids];
  const out = [];
  while (left.length) {
    const chosen = pickNext(left, stats, { now, random });
    if (!chosen) break;
    out.push(chosen);
    left.splice(left.indexOf(chosen), 1);
  }
  return out;
}

const STORE_KEY = 'openstring.intervals.v1';

/**
 * How often each distance comes up.
 *
 * Its own store, like the chord drill's. Reading a distance and knowing where a
 * particular fret is are different skills, and letting one write into the
 * other's numbers would make both readings meaningless.
 */
export class IntervalProgress {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.stats = {};
    try {
      const raw = this.storage?.getItem(STORE_KEY);
      if (raw) this.stats = JSON.parse(raw) || {};
    } catch { this.stats = {}; }
  }

  save() {
    try { this.storage?.setItem(STORE_KEY, JSON.stringify(this.stats)); } catch { /* fine without */ }
  }

  record(id, { correct, ms, now = Date.now() }) {
    this.stats[id] = updateStat(this.stats[id] || emptyStat(), { correct, ms, now });
    this.save();
  }

  fluentCount(ids = INTERVAL_IDS) {
    return ids.filter((id) => this.stats[id] && isFluent(this.stats[id])).length;
  }

  reset() { this.stats = {}; this.save(); }
}

export { positionId };
