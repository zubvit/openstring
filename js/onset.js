// Onset detection - when did a note actually start?
//
// This is the half of the app nothing free does properly. Nootka can hear WHAT you
// played but not WHEN, so it cannot tell you that you rush every third beat. Timing
// is easier to measure than pitch: a plucked string has a sharp attack, so a rise in
// energy is unambiguous. The work is in not counting one pluck twice (a string rings
// and wobbles) and in not firing on room noise.
//
// Resolution is one hop - 128 samples at 48 kHz is 2.7 ms, well under the ~20 ms
// where a human starts to hear a note as early or late.

// Getting the envelope right is the whole trick. Measuring energy in short blocks
// does not work: low E is 82 Hz, one cycle is 12 ms, and any block shorter than that
// measures the waveform's own ripple rather than the note's loudness - which then
// reads as a fresh attack several times per note. So rectify the signal and run it
// through two gentle low-pass stages tuned below the lowest note (~27 Hz corner).
// The ripple after rectification sits at twice the pitch (164 Hz and up) and is
// flattened hard, while a real attack still registers within about 1.3 ms.

// The threshold is a RELATIVE rise, not an absolute one. Measured on synthetic
// plucks, the leftover ripple on a sustained low E is a 21x bigger absolute jump
// than on a high E - so any fixed number either misses quiet high notes or fires
// forever on loud low ones. As a proportion of the current level, though, ripple
// stays under 0.06 across the whole range while a real attack is orders of
// magnitude above it. That ratio is what makes one constant work for every string.

export const DEFAULT_HOP = 128;
const ENVELOPE_TAU = 0.006;  // seconds; ~27 Hz corner, two poles. Costs 1.3 ms of lag.

/**
 * Streaming attack detector. Feed it audio chunks; it reports onsets as sample
 * offsets from the start of the stream, which the caller converts to a timeline.
 */
export class OnsetDetector {
  constructor({
    sampleRate = 48000,
    hopSize = DEFAULT_HOP,
    refractoryMs = 60,      // one pluck cannot become two; 60 ms = 250 bpm sixteenths
    riseThreshold = 0.30,   // envelope must jump 30% in one hop; ripple peaks at 0.06
    floorRms = 0.004,       // absolute quiet gate, keeps room tone out
  } = {}) {
    this.sampleRate = sampleRate;
    this.hopSize = hopSize;
    this.refractorySamples = (refractoryMs / 1000) * sampleRate;
    this.riseThreshold = riseThreshold;
    this.floorRms = floorRms;
    this.reset();
  }

  reset() {
    this.k = 1 - Math.exp(-1 / (ENVELOPE_TAU * this.sampleRate));
    this.env1 = 0;
    this.env2 = 0;
    this.sampleIndex = 0;   // absolute position in the stream
    this.hopPhase = 0;      // samples since the last envelope sample
    this.prevEnv = 0;
    this.lastOnsetSample = -Infinity;
    this.rising = false;    // inside an attack we have already reported
    this.onsets = [];
  }

  /** Feed a chunk. Returns onsets (sample offsets) discovered in THIS chunk. */
  push(chunk) {
    const found = [];
    for (let i = 0; i < chunk.length; i++) {
      // Two-pole smoothing of the rectified signal.
      const x = Math.abs(chunk[i]);
      this.env1 += (x - this.env1) * this.k;
      this.env2 += (this.env1 - this.env2) * this.k;

      if (++this.hopPhase < this.hopSize) continue;
      this.hopPhase = 0;

      const env = this.env2;
      const absSample = this.sampleIndex + i;

      // Proportional rise since the previous envelope sample.
      const rise = (env - this.prevEnv) / (this.prevEnv + 1e-9);

      const loudEnough = env >= this.floorRms;
      const clearOfLast = absSample - this.lastOnsetSample >= this.refractorySamples;
      const isAttack = rise > this.riseThreshold;

      // Fire on the LEADING edge only. Without this latch a single attack, which
      // rises over several hops, would report once per hop.
      if (isAttack && !this.rising && loudEnough && clearOfLast) {
        this.rising = true;
        this.lastOnsetSample = absSample;
        this.onsets.push(absSample);
        found.push(absSample);
      } else if (!isAttack) {
        this.rising = false;
      }

      this.prevEnv = env;
    }
    this.sampleIndex += chunk.length;
    return found;
  }

  /** Onset times in seconds since the stream began. */
  times() {
    return this.onsets.map((s) => s / this.sampleRate);
  }
}

/** Convenience for offline analysis and tests. Returns onset times in seconds. */
export function detectOnsets(buffer, sampleRate, opts = {}) {
  const d = new OnsetDetector({ ...opts, sampleRate });
  d.push(buffer);
  return d.times();
}

/**
 * Match what was played against what was asked for.
 *
 * The output is deliberately more than a score. "78% correct" tells a learner
 * nothing they can act on; "you are consistently 40 ms early" tells them to wait
 * for the click instead of anticipating it. Rushing and dragging have different
 * cures, and inconsistency is a different problem again from a steady offset.
 *
 * @param played   onset times, seconds
 * @param expected expected note times, seconds
 * @param toleranceMs how far off still counts as the same note
 */
export function gradeTiming(played, expected, { toleranceMs = 120 } = {}) {
  const tol = toleranceMs / 1000;
  const usedPlayed = new Set();
  const matches = [];

  expected.forEach((exp, i) => {
    let bestIdx = -1;
    let bestDist = Infinity;
    played.forEach((p, j) => {
      if (usedPlayed.has(j)) return;
      const d = Math.abs(p - exp);
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    });
    if (bestIdx !== -1 && bestDist <= tol) {
      usedPlayed.add(bestIdx);
      matches.push({ index: i, expected: exp, played: played[bestIdx], errorMs: (played[bestIdx] - exp) * 1000 });
    } else {
      matches.push({ index: i, expected: exp, played: null, errorMs: null });
    }
  });

  const hit = matches.filter((m) => m.played !== null);
  const errors = hit.map((m) => m.errorMs);
  const missed = matches.length - hit.length;
  const extra = played.length - usedPlayed.size;

  const mean = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
  const meanAbs = errors.length ? errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length : 0;
  const variance = errors.length
    ? errors.reduce((s, e) => s + (e - mean) * (e - mean), 0) / errors.length
    : 0;
  const spread = Math.sqrt(variance);

  let verdict = 'no notes detected';
  if (errors.length) {
    if (meanAbs <= 25 && spread <= 30) verdict = 'in time';
    else if (mean < -25) verdict = 'rushing';       // playing before the beat
    else if (mean > 25) verdict = 'dragging';       // playing after the beat
    else verdict = 'uneven';                        // no steady bias, just scattered
  }

  return {
    matches,
    hitCount: hit.length,
    missed,
    extra,
    meanErrorMs: Math.round(mean),
    meanAbsErrorMs: Math.round(meanAbs),
    spreadMs: Math.round(spread),
    verdict,
  };
}
