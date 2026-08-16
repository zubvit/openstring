// Practising a piece: chunk it, drill the chunks, join them, raise the demands.
//
// The method is not novel and that is the point - it is what a good teacher makes
// you do, and what almost nobody does alone because it is boring and requires
// bookkeeping. The bookkeeping is exactly what software is for.
//
//   CHUNK   a bar or two at a time. Whole-piece repetition mostly rehearses the
//           beginning and your own mistakes.
//   LADDER  clean at this tempo -> speed up a little; scrappy -> back off more
//           slowly than you advanced, so the net drift is always toward accuracy.
//   CHAIN   when two neighbours are solid, drill THE SEAM between them. Pieces
//           break at the joins, because the joins are the one thing chunked
//           practice never rehearses.
//   LAYER   raise the demand on material already learned: right notes, then in
//           time, then even, then shaped. Never two new demands at once.

export const LAYERS = ['notes', 'timing', 'evenness', 'dynamics', 'colour', 'legato'];

export const LAYER_LABELS = {
  notes: 'the right notes',
  timing: 'in time',
  evenness: 'an even touch',
  dynamics: 'shaped loud and soft',
  colour: 'changing tone colour',
  legato: 'smoothly joined',
};

/** Tempo ladder. Up in fours, down in twos: progress is slower than retreat is. */
export const LADDER = { up: 4, down: 2, minBpm: 30 };

/** Split a note sequence into practice chunks of `bars` bars each. */
export function makeChunks(sequence, { bars = 1 } = {}) {
  if (!sequence.length) return [];
  const byMeasure = new Map();
  for (const n of sequence) {
    if (!byMeasure.has(n.measure)) byMeasure.set(n.measure, []);
    byMeasure.get(n.measure).push(n);
  }
  const measures = [...byMeasure.keys()].sort((a, b) => a - b);
  const chunks = [];
  for (let i = 0; i < measures.length; i += bars) {
    const group = measures.slice(i, i + bars);
    const notes = group.flatMap((m) => byMeasure.get(m));
    if (!notes.some((n) => !n.isRest)) continue; // a chunk of pure rests is not practice
    chunks.push({
      id: `bars-${group[0]}-${group[group.length - 1]}`,
      firstMeasure: group[0],
      lastMeasure: group[group.length - 1],
      notes,
      kind: 'chunk',
    });
  }
  return chunks;
}

/**
 * A seam: the tail of one chunk joined to the head of the next.
 * Deliberately narrow - a couple of notes either side of the join, which is the
 * bit that actually fails, rather than replaying both chunks in full.
 */
export function makeSeam(a, b, { notesEachSide = 3 } = {}) {
  const left = a.notes.slice(-notesEachSide);
  const right = b.notes.slice(0, notesEachSide);
  if (!left.length || !right.length) return null;
  return {
    id: `seam-${a.id}-${b.id}`,
    firstMeasure: a.lastMeasure,
    lastMeasure: b.firstMeasure,
    notes: [...left, ...right],
    kind: 'seam',
    joins: [a.id, b.id],
  };
}

/** Merge two adjacent chunks into the larger unit they become once the seam holds. */
export function mergeChunks(a, b) {
  return {
    id: `bars-${a.firstMeasure}-${b.lastMeasure}`,
    firstMeasure: a.firstMeasure,
    lastMeasure: b.lastMeasure,
    notes: [...a.notes, ...b.notes],
    kind: 'chunk',
  };
}

export function newChunkState(startBpm = 50) {
  return { bpm: startBpm, attempts: 0, cleanRuns: 0, layerIndex: 0, bestBpm: 0, lastPlayed: 0 };
}

/**
 * Apply one attempt to a chunk's state.
 * Two clean runs at a tempo before advancing: one can be luck.
 */
export function applyAttempt(state, { passed, targetBpm, now = Date.now(), requiredClean = 2 }) {
  const s = { ...state };
  s.attempts += 1;
  s.lastPlayed = now;
  if (passed) {
    s.cleanRuns += 1;
    s.bestBpm = Math.max(s.bestBpm, s.bpm);
    if (s.cleanRuns >= requiredClean) {
      s.cleanRuns = 0;
      if (s.bpm < targetBpm) {
        s.bpm = Math.min(targetBpm, s.bpm + LADDER.up);
      } else if (s.layerIndex < LAYERS.length - 1) {
        // At tempo already: stop going faster and start demanding more instead.
        s.layerIndex += 1;
      }
    }
  } else {
    s.cleanRuns = 0;
    s.bpm = Math.max(LADDER.minBpm, s.bpm - LADDER.down);
  }
  return s;
}

export function chunkMastered(state, targetBpm, { throughLayer = 'timing' } = {}) {
  const need = LAYERS.indexOf(throughLayer);
  return state.bestBpm >= targetBpm && state.layerIndex >= need;
}

/** Which chunk to work on next: unseen first, then whatever is furthest behind. */
export function pickChunk(chunks, states, { avoid = null, targetBpm = 80, random = Math.random } = {}) {
  const usable = chunks.filter((c) => c.id !== avoid);
  const pool = usable.length ? usable : chunks;
  if (!pool.length) return null;

  const weights = pool.map((c) => {
    const s = states[c.id];
    if (!s || s.attempts === 0) return 4;
    const behind = Math.max(0, targetBpm - s.bpm) / targetBpm;      // 0..1
    const shallow = 1 - s.layerIndex / LAYERS.length;               // 0..1
    const stale = Math.min(1, (Date.now() - s.lastPlayed) / 3.6e6);
    // Seams matter more than they look: they are where performances fall apart.
    const seamBoost = c.kind === 'seam' ? 1.4 : 1;
    return (0.25 + behind * 2.5 + shallow * 1.2 + stale * 0.6) * seamBoost;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// ------------------------------------------------------------------ grading

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
};

/**
 * Grade one attempt at a chunk.
 *
 * @param expected notes with { sounding, beat, beats, isRest }
 * @param played   detected events { time, sounding, loudness, brightness }
 * @param opts     { bpm, startTime, layer }
 *
 * Each layer is judged independently and reported separately, because "68%" tells
 * a player nothing. Only the layers up to the current one decide pass/fail; the
 * rest are measured and shown so you can see what is coming.
 */
export function gradeChunk(expected, played, { bpm = 60, startTime = 0, layer = 'notes' } = {}) {
  const beat = 60 / bpm;
  const wanted = expected.filter((n) => !n.isRest);
  const firstBeat = wanted.length ? wanted[0].beat : 0;
  const targets = wanted.map((n) => ({
    sounding: n.sounding,
    at: startTime + (n.beat - firstBeat) * beat,
    beats: n.beats,
    dynamic: n.dynamic ?? null, // carried through, or the dynamics layer can never pass
  }));

  // Pair each expected note with the nearest unused attack.
  const used = new Set();
  const pairs = targets.map((t) => {
    let best = -1;
    let bestD = Infinity;
    played.forEach((p, i) => {
      if (used.has(i)) return;
      const d = Math.abs(p.time - t.at);
      if (d < bestD) { bestD = d; best = i; }
    });
    const tolerance = Math.max(0.25, beat * 0.6);
    if (best !== -1 && bestD <= tolerance) {
      used.add(best);
      return { target: t, ev: played[best] };
    }
    return { target: t, ev: null };
  });

  const hit = pairs.filter((p) => p.ev);
  const results = {};

  // --- notes
  const rightPitch = hit.filter((p) => p.ev.sounding === p.target.sounding).length;
  const wrongPitch = hit.length - rightPitch;
  const missing = pairs.length - hit.length;
  const extra = played.length - used.size;
  results.notes = {
    ok: wrongPitch === 0 && missing === 0 && extra === 0,
    detail: missing || wrongPitch || extra
      ? [missing && `${missing} missed`, wrongPitch && `${wrongPitch} wrong`, extra && `${extra} extra`].filter(Boolean).join(', ')
      : 'every note correct',
    rightPitch, wrongPitch, missing, extra,
  };

  // --- timing
  const errs = hit.map((p) => (p.ev.time - p.target.at) * 1000);
  const meanErr = mean(errs);
  const spread = stdev(errs);
  results.timing = {
    ok: errs.length > 0 && mean(errs.map(Math.abs)) <= 45 && spread <= 45,
    meanMs: Math.round(meanErr),
    spreadMs: Math.round(spread),
    detail: !errs.length ? 'nothing to time'
      : meanErr < -30 ? `ahead of the beat by ${Math.abs(Math.round(meanErr))} ms`
      : meanErr > 30 ? `behind the beat by ${Math.round(meanErr)} ms`
      : `steady, ${Math.round(spread)} ms spread`,
  };

  // --- evenness: are the notes the same weight as each other?
  const louds = hit.map((p) => p.ev.loudness).filter((x) => typeof x === 'number' && x > 0);
  const cv = louds.length > 1 ? stdev(louds) / mean(louds) : 0;
  results.evenness = {
    ok: louds.length > 1 && cv <= 0.35,
    cv: Number(cv.toFixed(2)),
    detail: louds.length < 2 ? 'not enough notes'
      : cv <= 0.2 ? 'very even'
      : cv <= 0.35 ? 'reasonably even'
      : 'some notes much louder than others',
  };

  // --- dynamics: does the loudness follow the shape the music asks for?
  const shaped = wanted.some((n) => n.dynamic != null);
  if (shaped) {
    const want = pairs.filter((p) => p.ev && p.target.dynamic != null);
    const ok = want.length >= 2 && correlation(
      want.map((p) => p.target.dynamic),
      want.map((p) => p.ev.loudness),
    ) > 0.5;
    results.dynamics = { ok, detail: ok ? 'the shape came through' : 'the loud and soft did not really happen' };
  } else {
    results.dynamics = { ok: true, detail: 'no dynamics marked', skipped: true };
  }

  // --- colour
  const brights = hit.map((p) => p.ev.brightness).filter((x) => typeof x === 'number' && x > 0);
  results.colour = brights.length > 1
    ? { ok: true, spread: Number((Math.max(...brights) / Math.min(...brights)).toFixed(2)),
        detail: `tone varied by ${(Math.max(...brights) / Math.min(...brights)).toFixed(1)}x across the phrase` }
    : { ok: true, detail: 'not measured', skipped: true };

  // --- legato: how much silence between one note and the next
  const gaps = [];
  for (let i = 1; i < hit.length; i++) {
    const prev = hit[i - 1];
    const cur = hit[i];
    if (typeof prev.ev.endTime === 'number') gaps.push((cur.ev.time - prev.ev.endTime) * 1000);
  }
  results.legato = gaps.length
    ? { ok: mean(gaps) <= 60, meanGapMs: Math.round(mean(gaps)),
        detail: mean(gaps) <= 20 ? 'nicely joined' : mean(gaps) <= 60 ? 'slight gaps' : 'choppy - notes are stopping early' }
    : { ok: true, detail: 'not measured', skipped: true };

  // Pass requires every layer up to and including the current one.
  const upto = LAYERS.slice(0, LAYERS.indexOf(layer) + 1);
  const passed = upto.every((l) => results[l].ok);

  return { passed, layer, results, checked: upto };
}

function correlation(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}
