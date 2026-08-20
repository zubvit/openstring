// Microphone in, metronome out.
//
// A note on timing honesty. There is always a delay between a string moving and
// the browser handing us the samples - driver buffers, Bluetooth, the OS. It varies
// by machine and we cannot know it exactly, so any claim about absolute timing
// carries that unknown offset. Two consequences the UI has to respect:
//
//   - CONSISTENCY (the spread of your timing) is unaffected by a constant delay
//     and is therefore always trustworthy.
//   - BIAS (rushing or dragging) is only as good as the offset compensation, so
//     it is calibratable and the app says so rather than pretending otherwise.

import { detectPitch, PitchTracker, rms } from './pitch.js';
import { OnsetDetector } from './onset.js';
import { brightness } from './spectral.js';

// How long after an attack to sample the note. Immediately at the onset the
// string is still a click rather than a pitch; too late and a fast passage has
// already moved on. 12 ms in, 2048 samples wide, works from low E upward.
const NOTE_DELAY_S = 0.012;
const NOTE_WINDOW = 2048;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.running = false;
    this.sampleRate = 48000;
    this.latencyOffsetMs = 0;   // subtracted from detected onset times
    this.onPitch = null;        // (detection|null) => void
    this.onOnset = null;        // (timeSeconds) => void
    this.onLevel = null;        // (rms) => void
    this._analysisBuf = null;
    this._tracker = new PitchTracker();
    this._onsets = null;
    this._raf = 0;
    // Onset sample counts are relative to the last reset; this records where that
    // reset sat on the audio clock so the two timelines can be compared at all.
    this.captureEpoch = 0;
    // Note events pair each attack with what was actually played there.
    this.onNoteEvent = null;    // ({time, sounding, hz, loudness, brightness}) => void
    this._ring = null;
    this._ringWrite = 0;
    this._samplesWritten = 0;   // must stay in step with the onset detector's counter
    this._pendingNotes = [];
  }

  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!(window.AudioContext || window.webkitAudioContext);
  }

  /** Ask for the microphone and start analysing. Throws with a readable reason. */
  async start() {
    if (this.running) return;
    if (!this.supported) throw new Error('This browser cannot record audio.');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // All three would fight the pitch detector for control of the signal.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (err) {
      if (err?.name === 'NotAllowedError') throw new Error('Microphone permission was refused. Allow it in your browser settings and reload.');
      if (err?.name === 'NotFoundError') throw new Error('No microphone was found.');
      throw new Error(`Could not open the microphone: ${err?.message || err}`);
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.sampleRate = this.ctx.sampleRate;

    // Best available guess at input+output delay; the user can refine it.
    const base = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    this.latencyOffsetMs = Math.round(base * 1000);

    this._onsets = new OnsetDetector({ sampleRate: this.sampleRate });
    // Two seconds of history is plenty to look back at an attack we just heard.
    this._ring = new Float32Array(Math.ceil(this.sampleRate * 2));
    const source = this.ctx.createMediaStreamSource(this.stream);

    // Pitch runs off an analyser polled per frame - it needs a window, not a stream.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    this._analysisBuf = new Float32Array(this.analyser.fftSize);

    // Onsets need every sample in order, with an exact position.
    await this.#attachCapture(source);

    this.running = true;
    this.#pollPitch();
  }

  async #attachCapture(source) {
    const handleChunk = (samples) => {
      const found = this._onsets.push(samples);
      this.#writeRing(samples);
      for (const s of found) {
        const t = this.captureEpoch + s / this.sampleRate - this.latencyOffsetMs / 1000;
        if (this.onOnset) this.onOnset(t);
        if (this.onNoteEvent) this._pendingNotes.push({ sample: s, time: t });
      }
      this.#drainPendingNotes();
    };

    if (this.ctx.audioWorklet) {
      try {
        await this.ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
        const node = new AudioWorkletNode(this.ctx, 'openstring-capture');
        node.port.onmessage = (e) => handleChunk(e.data.samples, e.data.startSample);
        source.connect(node);
        // A worklet with no output still needs somewhere to go in some browsers.
        const mute = this.ctx.createGain();
        mute.gain.value = 0;
        node.connect(mute).connect(this.ctx.destination);
        this.captureMode = 'worklet';
        return;
      } catch {
        // Fall through to the older path rather than failing outright.
      }
    }

    const sp = this.ctx.createScriptProcessor(1024, 1, 1);
    sp.onaudioprocess = (e) => handleChunk(e.inputBuffer.getChannelData(0), 0);
    source.connect(sp);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    sp.connect(mute).connect(this.ctx.destination);
    this.captureMode = 'scriptprocessor';
  }

  #writeRing(samples) {
    const ring = this._ring;
    if (!ring) return;
    for (let i = 0; i < samples.length; i++) {
      ring[this._ringWrite] = samples[i];
      this._ringWrite = (this._ringWrite + 1) % ring.length;
    }
    this._samplesWritten += samples.length;
  }

  /** Read `len` samples starting at an absolute stream position, or null if gone. */
  #readRing(startSample, len) {
    const ring = this._ring;
    if (!ring) return null;
    const newest = this._samplesWritten;
    const oldest = Math.max(0, newest - ring.length);
    if (startSample < oldest || startSample + len > newest) return null;
    const out = new Float32Array(len);
    let idx = (this._ringWrite - (newest - startSample) + ring.length * 2) % ring.length;
    for (let i = 0; i < len; i++) {
      out[i] = ring[idx];
      idx = (idx + 1) % ring.length;
    }
    return out;
  }

  /** Once enough audio has arrived after an attack, measure what was played. */
  #drainPendingNotes() {
    const delay = Math.round(NOTE_DELAY_S * this.sampleRate);
    const still = [];
    for (const p of this._pendingNotes) {
      const win = this.#readRing(p.sample + delay, NOTE_WINDOW);
      if (!win) {
        // Not arrived yet - keep waiting, unless it has aged out of the buffer.
        if (this._samplesWritten - p.sample < this._ring.length) still.push(p);
        continue;
      }
      const det = detectPitch(win, this.sampleRate);
      const level = rms(win);
      this.onNoteEvent({
        time: p.time,
        hz: det ? det.hz : null,
        sounding: det ? Math.round(69 + 12 * Math.log2(det.hz / 440)) : null,
        loudness: level,
        brightness: det ? brightness(win, this.sampleRate, det.hz) : null,
        clarity: det ? det.clarity : 0,
      });
    }
    this._pendingNotes = still;
  }

  #pollPitch() {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this._analysisBuf);
    const det = detectPitch(this._analysisBuf, this.sampleRate);
    const stable = this._tracker.push(det);
    if (this.onPitch) this.onPitch(stable, det);
    if (this.onLevel) {
      let s = 0;
      for (let i = 0; i < this._analysisBuf.length; i++) s += this._analysisBuf[i] * this._analysisBuf[i];
      this.onLevel(Math.sqrt(s / this._analysisBuf.length));
    }
    this._raf = requestAnimationFrame(() => this.#pollPitch());
  }

  /**
   * Widen or narrow the pitch analysis window.
   *
   * The drills want it short: a wide window is slow to notice that the note has
   * changed. The tuner wants it wide: at 2048 samples a low E fits barely two
   * periods, which is where a detector starts guessing octaves. Nothing else in
   * the app should touch this.
   */
  setAnalysisWindow(size) {
    if (!this.analyser) return;
    this.analyser.fftSize = size;
    this._analysisBuf = new Float32Array(this.analyser.fftSize);
    this._tracker.reset();
  }

  resetTracking() {
    this._tracker.reset();
    this._onsets?.reset();
    this._pendingNotes = [];
    // The onset detector restarts its sample count from zero, so the ring's
    // counter must too - otherwise every lookup lands outside the buffer and
    // note events silently stop arriving.
    this._samplesWritten = 0;
    this._ringWrite = 0;
    if (this._ring) this._ring.fill(0);
    this.captureEpoch = this.ctx ? this.ctx.currentTime : 0;
  }

  /** Audio-clock seconds since the context started - the shared timeline. */
  now() { return this.ctx ? this.ctx.currentTime : 0; }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.stream = null;
  }
}

/**
 * A metronome scheduled on the audio clock rather than with setInterval, which
 * drifts and stutters whenever the main thread is busy drawing. Beats are queued
 * slightly ahead of time and their exact times handed back so the grader can
 * compare against them.
 */
export class Metronome {
  constructor(ctx) {
    this.ctx = ctx;
    this.bpm = 60;
    this.beatsPerBar = 4;
    this.running = false;
    this.onBeat = null;      // (beatIndex, time) => void, fired at the audible moment
    this._next = 0;
    this._beat = 0;
    this._timer = null;
    this.volume = 0.25;
  }

  start(bpm = this.bpm, { countInBars = 0, startTime = null } = {}) {
    this.bpm = bpm;
    this.running = true;
    this._beat = -countInBars * this.beatsPerBar;
    this.firstClickTime = startTime ?? this.ctx.currentTime + 0.12;
    // Beat 0 is the DOWNBEAT, after the count-in has finished - not the first
    // click. Conflating the two puts every expected note a whole bar early.
    this.zeroTime = this.firstClickTime + countInBars * this.beatsPerBar * (60 / bpm);
    this._next = this.firstClickTime;
    this.#schedule();
  }

  /** Audio-clock time of a beat index; beat 0 is the downbeat after the count-in. */
  timeOfBeat(i) { return this.zeroTime + (i * 60) / this.bpm; }

  #schedule() {
    if (!this.running) return;
    const AHEAD = 0.2;
    while (this._next < this.ctx.currentTime + AHEAD) {
      this.#click(this._next, this._beat >= 0 && this._beat % this.beatsPerBar === 0);
      if (this.onBeat) {
        const b = this._beat;
        const t = this._next;
        const delay = Math.max(0, (t - this.ctx.currentTime) * 1000);
        setTimeout(() => this.onBeat && this.onBeat(b, t), delay);
      }
      this._beat += 1;
      this._next += 60 / this.bpm;
    }
    this._timer = setTimeout(() => this.#schedule(), 50);
  }

  #click(time, accent) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    // Short and high so it cuts through a guitar without masking it.
    osc.frequency.value = accent ? 1600 : 1100;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(this.volume * (accent ? 1 : 0.7), time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  stop() {
    this.running = false;
    clearTimeout(this._timer);
  }
}

/**
 * An AudioContext for output only.
 *
 * The metronome must work with no microphone at all - asking for permission to
 * record just to hear a click would be both rude and a reason not to open the
 * app. Kept as one lazily-created context because browsers cap how many a page
 * may have, and creating one per click would exhaust that in a practice session.
 */
let _outCtx = null;
export function outputContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!_outCtx || _outCtx.state === 'closed') _outCtx = new Ctx();
  // Browsers start it suspended until a gesture; every caller here is a click.
  if (_outCtx.state === 'suspended') _outCtx.resume();
  return _outCtx;
}

/**
 * Play a chord, one string after another, the way you would check it by hand.
 *
 * Strummed all at once it is much harder to hear whether one note is wrong -
 * which is the whole reason to press the button. Roughly plucked rather than
 * synthesised properly: three decaying partials is enough to tell an A minor
 * from an A major, and this is a reference, not an instrument.
 *
 * @param midis  SOUNDING midi numbers, low to high
 */
export function playChord(midis, { ctx = null, spreadS = 0.09, holdS = 1.6, volume = 0.16 } = {}) {
  const c = ctx || outputContext();
  if (!c || !midis?.length) return 0;
  const start = c.currentTime + 0.05;

  midis.forEach((midi, i) => {
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    const at = start + i * spreadS;
    // A little more energy in the upper partials of the thin strings, less in
    // the thick ones - otherwise the bass notes boom and the top disappears.
    [1, 2, 3].forEach((partial, k) => {
      const f = hz * partial;
      if (f > c.sampleRate / 2) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.frequency.value = f;
      const peak = volume * [1, 0.34, 0.14][k];
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + holdS * (1 - k * 0.22));
      osc.connect(gain).connect(c.destination);
      osc.start(at);
      osc.stop(at + holdS + 0.05);
    });
  });

  return midis.length * spreadS + holdS;
}
