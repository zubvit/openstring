import assert from 'node:assert/strict';
import { fft, magnitudeSpectrum, spectralCentroid, brightness } from '../js/spectral.js';
import { midiToHz } from '../js/theory.js';

const SR = 48000;
const N = 4096;

/** Tone with controllable harmonic richness. `tilt` > 1 = brighter (ponticello-like). */
function tone(hz, { n = N, sr = SR, tilt = 1, partials = 10 } = {}) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (let h = 1; h <= partials; h++) {
      const f = hz * h;
      if (f > sr / 2) break;
      // amplitude falls as 1/h^p; a smaller p leaves more energy up top
      const amp = Math.pow(h, -(2 / tilt));
      v += amp * Math.sin(2 * Math.PI * f * t);
    }
    b[i] = v * 0.2;
  }
  return b;
}

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

t('fft finds a pure tone in the right bin', () => {
  const n = 1024;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const binWanted = 64;
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * binWanted * i) / n);
  fft(re, im);
  let peak = 0; let peakBin = -1;
  for (let i = 1; i < n / 2; i++) {
    const m = Math.hypot(re[i], im[i]);
    if (m > peak) { peak = m; peakBin = i; }
  }
  assert.equal(peakBin, binWanted);
});

t('fft rejects non power-of-two lengths rather than returning nonsense', () => {
  assert.throws(() => fft(new Float32Array(300), new Float32Array(300)), /power of two/);
});

t('spectral centroid tracks a pure tone', () => {
  for (const hz of [220, 440, 880]) {
    const c = spectralCentroid(tone(hz, { partials: 1 }), SR);
    assert.ok(Math.abs(c - hz) / hz < 0.06, `${hz}Hz -> centroid ${c.toFixed(0)}`);
  }
});

t('a brighter spectrum yields a higher centroid', () => {
  const dark = spectralCentroid(tone(196, { tilt: 0.6 }), SR);
  const mid = spectralCentroid(tone(196, { tilt: 1 }), SR);
  const bright = spectralCentroid(tone(196, { tilt: 2.2 }), SR);
  assert.ok(dark < mid && mid < bright, `expected rising: ${dark.toFixed(0)} < ${mid.toFixed(0)} < ${bright.toFixed(0)}`);
  assert.ok(bright / dark > 1.5, `separation too small: ${(bright / dark).toFixed(2)}x`);
});

t('brightness is comparable across the neck - the whole point', () => {
  // The same plucking position on different strings must read as the same colour,
  // otherwise a colour drill would just be measuring which note you played.
  const vals = [82.41, 146.83, 246.94, 329.63].map((hz) => brightness(tone(hz, { tilt: 1 }), SR, hz));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  assert.ok(hi / lo < 1.35, `brightness varies too much by pitch: ${vals.map((v) => v.toFixed(2)).join(', ')}`);
});

t('brightness separates ponticello from tasto on the same note', () => {
  const hz = 196;
  const tasto = brightness(tone(hz, { tilt: 0.6 }), SR, hz);
  const ponti = brightness(tone(hz, { tilt: 2.2 }), SR, hz);
  assert.ok(ponti > tasto * 1.5, `not separable: tasto ${tasto.toFixed(2)} vs ponticello ${ponti.toFixed(2)}`);
});

t('silence does not produce a bogus centroid', () => {
  assert.equal(spectralCentroid(new Float32Array(N), SR), 0);
  assert.equal(brightness(new Float32Array(N), SR, 0), null);
});

t('fast enough to run per note', () => {
  const buf = tone(196);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) spectralCentroid(buf, SR);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
  assert.ok(ms < 6, `too slow: ${ms.toFixed(2)} ms`);
  console.log(`  centroid: ${ms.toFixed(2)} ms per 4096-sample frame`);
});

console.log(`spectral: ${pass} groups passed`);
