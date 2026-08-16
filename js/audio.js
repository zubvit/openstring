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

import { detectPitch, PitchTracker } from './pitch.js';
import { OnsetDetector } from './onset.js';

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
    const handleChunk = (samples, startSample) => {
      const found = this._onsets.push(samples);
      if (found.length && this.onOnset) {
        for (const s of found) {
          // Audio-clock seconds, so this can be compared with metronome beats.
          this.onOnset(this.captureEpoch + s / this.sampleRate - this.latencyOffsetMs / 1000);
        }
      }
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

  resetTracking() {
    this._tracker.reset();
    this._onsets?.reset();
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
