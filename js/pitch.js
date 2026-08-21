// Monophonic pitch detection, McLeod Pitch Method (NSDF).
//
// Why not plain autocorrelation: a guitar note is harmonic-rich, and a laptop mic
// rolls off the low end, so the fundamental is often WEAKER than its own second
// harmonic. Plain autocorrelation happily reports the harmonic and you get an
// octave error - the single most common bug in guitar tuners and note trainers.
// MPM normalises the autocorrelation and then deliberately picks the FIRST peak
// that clears a threshold relative to the tallest, not the tallest itself. That
// choice is what makes a weak fundamental still win against a strong harmonic.
//
// Pure functions on Float32Array so the whole thing is testable off the mic.

/** Cheap anti-aliasing decimator. Guitar needs nothing above ~2 kHz to find a pitch. */
export function decimate(input, factor) {
  if (factor <= 1) return input;
  const outLen = Math.floor(input.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) sum += input[base + k]; // boxcar low-pass
    out[i] = sum / factor;
  }
  return out;
}

export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/**
 * Normalised square difference function over [minLag, maxLag].
 * Returns Float32Array indexed by lag; values in roughly [-1, 1], 1 = perfect period.
 */
export function nsdf(buf, minLag, maxLag) {
  const W = buf.length;
  const out = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let acf = 0;
    let div = 0;
    const n = W - tau;
    for (let j = 0; j < n; j++) {
      const a = buf[j];
      const b = buf[j + tau];
      acf += a * b;
      div += a * a + b * b;
    }
    out[tau] = div > 0 ? (2 * acf) / div : 0;
  }
  return out;
}

/** Parabolic interpolation around index i of array a. Returns {x, y} refined peak. */
function refinePeak(a, i) {
  const y0 = a[i - 1];
  const y1 = a[i];
  const y2 = a[i + 1];
  const denom = 2 * (2 * y1 - y0 - y2);
  if (denom === 0 || !Number.isFinite(denom)) return { x: i, y: y1 };
  const delta = (y2 - y0) / denom;
  return { x: i + delta, y: y1 - ((y0 - y2) * delta) / 4 };
}

/**
 * Detect the fundamental of a monophonic buffer.
 * Returns { hz, clarity, rms } or null when there is nothing confident to report.
 */
export function detectPitch(buffer, sampleRate, opts = {}) {
  const {
    minHz = 70,          // a little below low E (82.4 Hz), allows a flat string
    maxHz = 1320,        // above the highest note a 12th-fret high E reaches
    clarityThreshold = 0.85,
    rmsThreshold = 0.008,
    peakRatio = 0.9,     // McLeod's k: accept the first peak >= k * tallest peak
  } = opts;

  const level = rms(buffer);
  if (level < rmsThreshold) return null; // silence or room noise

  // Work at a lower rate: fewer lags to scan, and it low-passes away fret noise.
  const factor = Math.max(1, Math.floor(sampleRate / 12000));
  const buf = decimate(buffer, factor);
  const rate = sampleRate / factor;

  const minLag = Math.max(2, Math.floor(rate / maxHz));
  const maxLag = Math.min(Math.floor(rate / minHz), Math.floor(buf.length / 2) - 1);
  if (maxLag <= minLag + 2) return null; // window too short for this range

  const n = nsdf(buf, minLag, maxLag);

  // Collect local maxima that sit inside a positively-valued region.
  const peaks = [];
  let searching = false;
  for (let tau = minLag + 1; tau < maxLag; tau++) {
    if (!searching) {
      // Wait for the function to come back up through zero before hunting again;
      // this keeps the shoulder of the tau=0 lobe from registering as a peak.
      if (n[tau] > 0 && n[tau - 1] <= 0) searching = true;
      continue;
    }
    if (n[tau] > n[tau - 1] && n[tau] >= n[tau + 1]) {
      peaks.push(tau);
      searching = false;
    }
  }
  if (peaks.length === 0) return null;

  let best = 0;
  for (const p of peaks) if (n[p] > best) best = n[p];
  if (best < clarityThreshold) return null; // no convincing periodicity

  // The crux: earliest peak clearing the threshold, NOT the tallest one.
  const threshold = peakRatio * best;
  let chosen = peaks[0];
  for (const p of peaks) {
    if (n[p] >= threshold) { chosen = p; break; }
  }

  const refined = refinePeak(n, chosen);
  if (refined.x <= 0) return null;
  const hz = rate / refined.x;
  if (hz < minHz || hz > maxHz) return null;

  return { hz, clarity: Math.min(1, refined.y), rms: level };
}

/**
 * Smooths a stream of detections and reports a note only once it holds steady.
 * A plucked string wobbles for the first few tens of milliseconds and the attack
 * transient can read as almost anything, so judging the very first frame would
 * punish good playing. Requiring agreement across frames costs a little latency
 * and removes nearly all of the false readings.
 */
export class PitchTracker {
  constructor({ requiredFrames = 3, toleranceCents = 60 } = {}) {
    this.requiredFrames = requiredFrames;
    this.toleranceCents = toleranceCents;
    this.reset();
  }

  reset() {
    this.frames = [];
    this.stable = null;
  }

  /** Feed one detection (or null). Returns a stable { hz, clarity } or null. */
  push(det) {
    if (!det) {
      this.frames = [];
      this.stable = null;
      return null;
    }
    this.frames.push(det);
    if (this.frames.length > this.requiredFrames) this.frames.shift();
    if (this.frames.length < this.requiredFrames) return null;

    const hzs = this.frames.map((f) => f.hz).sort((a, b) => a - b);
    const median = hzs[Math.floor(hzs.length / 2)];
    const spreadCents = 1200 * Math.log2(hzs[hzs.length - 1] / hzs[0]);
    if (spreadCents > this.toleranceCents) return null; // still moving, not settled

    this.stable = {
      hz: median,
      clarity: this.frames.reduce((s, f) => s + f.clarity, 0) / this.frames.length,
    };
    return this.stable;
  }
}

/**
 * Decides which stable readings are ANSWERS and which are the last note still
 * sounding.
 *
 * This exists because of a bug that quietly wrecked every score in the app. A
 * plucked guitar string rings for seconds. The drill waited 350 ms after
 * putting up a new note and then judged the first stable pitch it heard - which
 * was, reliably, the note you had just played, still decaying. So most
 * questions opened with a free mistake that nobody made, accuracy sat around
 * three quarters no matter how well you played, and the fluency ring could
 * never reach its bar.
 *
 * Waiting longer does not fix it: a note can ring for four seconds and no
 * beginner should be made to wait that out. The fix is to know WHICH pitch is
 * the leftover and ignore that one specifically, until the microphone has been
 * quiet once - which is what happens the moment you damp the string or simply
 * stop it by fretting the next note.
 */
export class AnswerGate {
  constructor({ requireOnset = false } = {}) {
    this.muted = null;      // the note we are still hearing the tail of
    this.counted = null;    // the note already taken as an answer
    // An answer is a string being STRUCK. Letting a note ring on is not an
    // answer to anything, and neither is the room. When this is on, a reading
    // is only considered after an attack has been heard.
    this.requireOnset = requireOnset;
    this.armed = false;
  }

  /**
   * A string was plucked: the next steady reading is a real answer.
   *
   * This also forgets what was last counted. The `counted` guard exists to stop
   * one HELD note answering sixty times a second - but a fresh attack is a new
   * event even when it is the same pitch, and without this, playing the same
   * note twice on purpose had its second try silently ignored.
   */
  arm() {
    this.armed = true;
    this.counted = null;
  }

  /** Start a fresh question. `ringing` is the note just played, if any. */
  reset(ringing = null) {
    this.muted = ringing;
    this.counted = null;
    this.armed = false;
  }

  /** After an answer, its own note becomes the one to ignore. */
  mute(midi) {
    this.muted = midi;
    this.counted = null;
  }

  /**
   * Feed one stable reading, or null for silence.
   * Returns the note to judge, or null when there is nothing new to judge.
   */
  accept(midi) {
    if (midi == null) {
      // Silence means the string stopped: whatever was ringing is gone, and the
      // same note may legitimately be played again from here.
      this.muted = null;
      this.counted = null;
      return null;
    }
    if (midi === this.muted) return null;   // the tail of the last answer
    if (midi === this.counted) return null; // still the same note, already counted
    // Nothing was struck, so whatever this is - a string still ringing, a chair,
    // the neighbour - it is not an answer. Missing an attack costs nothing: the
    // question simply stays up and the next pluck is heard.
    if (this.requireOnset && !this.armed) return null;
    this.armed = false;
    this.counted = midi;
    // A different note means the old one is over, whether or not we heard a gap.
    this.muted = null;
    return midi;
  }
}
