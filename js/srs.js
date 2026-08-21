// Choosing the next note to ask.
//
// Classic spaced repetition assumes steady daily study and schedules cards for
// calendar dates. Practice here is irregular by design - some days ten minutes,
// some days nothing - so date-based intervals would either bury you in overdue
// cards after a gap or hand you nothing after a good week. Instead each fretboard
// position carries a running strength, and the next question is drawn at random
// with weight. Weak positions come up often, solid ones tick over occasionally,
// and a gap in practice degrades everything gently rather than creating a debt.
//
// Latency matters as much as accuracy. Reading fluently means recognising fast;
// a note you eventually find after four seconds of hunting is not learned, so a
// slow correct answer earns much less credit than a quick one.

/** A position is "fluent" once it is reliably correct and reliably fast. */
export const FLUENT_MS = 2000;
export const FLUENT_ACCURACY = 0.85;

export function emptyStat() {
  return { attempts: 0, correct: 0, accuracy: 0.5, avgMs: 4000, lastSeen: 0, streak: 0 };
}

/**
 * Fold one answer into a position's running stats.
 * Exponential moving averages, so recent playing counts for more than the
 * fumbling you did a fortnight ago.
 */
export function updateStat(stat, { correct, ms, now = Date.now() }) {
  const s = { ...emptyStat(), ...stat };
  const alpha = s.attempts < 3 ? 0.5 : 0.25; // move fast when we know little
  s.attempts += 1;
  if (correct) s.correct += 1;
  s.accuracy = s.accuracy + alpha * ((correct ? 1 : 0) - s.accuracy);
  if (correct && Number.isFinite(ms)) {
    s.avgMs = s.avgMs + alpha * (ms - s.avgMs);
  } else if (!correct) {
    // A wrong answer says nothing about speed, but it should not look fast.
    s.avgMs = s.avgMs + alpha * 0.5 * (FLUENT_MS * 2 - s.avgMs);
  }
  s.streak = correct ? s.streak + 1 : 0;
  s.lastSeen = now;
  return s;
}

export function isFluent(stat) {
  if (!stat || stat.attempts < 4) return false;
  return stat.accuracy >= FLUENT_ACCURACY && stat.avgMs <= FLUENT_MS;
}

/**
 * How badly this position needs asking. Higher = more urgent.
 * Deliberately never returns zero: even a mastered note should reappear now and
 * then, or it quietly rots while the stats still claim it is fine.
 */
export function weightFor(stat, { now = Date.now() } = {}) {
  const s = { ...emptyStat(), ...stat };

  if (s.attempts === 0) return 3.0; // unseen notes are the priority

  // 1.0 when perfect, up to 4.0 when always wrong.
  const errorFactor = 1 + 3 * (1 - Math.min(1, Math.max(0, s.accuracy)));

  // 1.0 when fluent-fast, up to ~2.5 when painfully slow.
  const slowness = Math.min(2.5, Math.max(1, s.avgMs / FLUENT_MS));

  // Creeps up the longer a position goes unasked; caps so old items cannot
  // completely crowd out the weak ones.
  const hours = Math.max(0, (now - (s.lastSeen || 0)) / 3.6e6);
  const staleness = 1 + Math.min(1.5, hours / 24);

  const mastered = isFluent(s) ? 0.35 : 1;

  return 0.15 + errorFactor * slowness * staleness * mastered;
}

/**
 * Draw the next position. `pool` is a list of ids; `stats` maps id -> stat.
 * `avoid` (usually the previous question) is excluded so the same note never
 * comes twice running, which otherwise happens often once one note is weak.
 */
export function pickNext(pool, stats = {}, { avoid = null, now = Date.now(), random = Math.random } = {}) {
  const candidates = pool.filter((id) => id !== avoid);
  const usable = candidates.length ? candidates : pool;
  if (usable.length === 0) return null;

  const weights = usable.map((id) => weightFor(stats[id], { now }));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < usable.length; i++) {
    r -= weights[i];
    if (r <= 0) return usable[i];
  }
  return usable[usable.length - 1];
}

/** Fraction of the pool that has reached fluency - drives "ready to move on". */
export function poolMastery(pool, stats = {}) {
  if (!pool.length) return 0;
  const fluent = pool.filter((id) => isFluent(stats[id])).length;
  return fluent / pool.length;
}

/** The positions holding you back, worst first. */
export function weakest(pool, stats = {}, limit = 5) {
  return pool
    .map((id) => ({ id, stat: { ...emptyStat(), ...stats[id] } }))
    .filter((x) => x.stat.attempts > 0 && !isFluent(x.stat))
    .sort((a, b) => (a.stat.accuracy - b.stat.accuracy) || (b.stat.avgMs - a.stat.avgMs))
    .slice(0, limit);
}

/**
 * How you are playing NOW, rather than how the whole sitting went.
 *
 * The session card used to be running totals from the moment you pressed
 * start. After two hundred notes those barely move: sixteen good ones in a row
 * cannot shift a fraction with a denominator that large, so the card stopped
 * telling you anything about the last ten minutes. A fixed window does tell
 * you, and it is the number you actually want mid-practice.
 *
 * (The fluency ring is a different thing and was already rolling - each
 * position carries exponential moving averages, so recent playing dominates
 * there by construction.)
 *
 * The median time counts every note, fumbles included: how long a note took to
 * find IS the reading speed, and dropping the slow ones would flatter it.
 */
export function recentForm(entries, { window: size = 20 } = {}) {
  const recent = entries.slice(-size);
  if (!recent.length) return { count: 0, clean: 0, medianMs: null, octaveSlips: 0, window: size };

  const times = recent
    .map((e) => e.ms)
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);

  return {
    count: recent.length,
    clean: recent.filter((e) => e.clean).length,
    medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
    // Worth counting separately: on a stage whose notes are not an octave
    // apart, "right note, wrong string" over and over is more likely to be the
    // listener mishearing an octave than the player picking the wrong string.
    octaveSlips: recent.reduce((n, e) => n + (e.octaves || 0), 0),
    window: size,
  };
}

/**
 * Is the guitar out of tune, rather than the player wrong?
 *
 * A beginner cannot tell these apart, and the app was not helping. Play the
 * correct fret on a string that is a semitone flat and the microphone hears a
 * different note - correctly - so the drill says "not that one, try higher" and
 * sends him hunting up the neck for a note that is already under his finger.
 * Every note on that string is then wrong, however well he reads, and the score
 * says he cannot read. The app has the pitch in its hand and can say so.
 *
 * The signal is CONSISTENCY, not size. A wrong fret is a large error that
 * varies from try to try. A mistuned string is the same error every single
 * time, because it is the string, not the finger. So: several attempts on one
 * string, all agreeing closely, all well off - that is the instrument.
 *
 * Deliberately no similarity scoring anywhere here. Every sample is an exact
 * measured distance in cents, and a string is reported only when the readings
 * agree inside a stated window.
 */
export const DRIFT_MIN_SAMPLES = 3;
export const DRIFT_MAX_SPREAD_CENTS = 40;  // wider than this is not one cause
export const DRIFT_MIN_CENTS = 35;         // below this, tuning is not the story

export function tuningDrift(samples, {
  minSamples = DRIFT_MIN_SAMPLES,
  maxSpread = DRIFT_MAX_SPREAD_CENTS,
  minCents = DRIFT_MIN_CENTS,
} = {}) {
  const byString = new Map();
  for (const s of samples) {
    if (!s || !Number.isFinite(s.cents) || !s.string) continue;
    if (!byString.has(s.string)) byString.set(s.string, []);
    byString.get(s.string).push(s.cents);
  }

  let worst = null;
  for (const [string, list] of byString) {
    if (list.length < minSamples) continue;
    const sorted = [...list].sort((a, b) => a - b);
    const spread = sorted[sorted.length - 1] - sorted[0];
    if (spread > maxSpread) continue;              // not one consistent cause
    const median = sorted[Math.floor(sorted.length / 2)];
    if (Math.abs(median) < minCents) continue;     // in tune enough to read by
    if (!worst || Math.abs(median) > Math.abs(worst.cents)) {
      worst = { string, cents: median, direction: median < 0 ? 'flat' : 'sharp', samples: list.length };
    }
  }
  return worst;
}
