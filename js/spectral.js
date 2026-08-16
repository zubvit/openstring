// Spectral analysis, for the two layers that need to know about a note's colour
// rather than just its pitch and timing.
//
// Brightness is the useful measurement here. Plucking near the bridge (ponticello)
// excites the upper partials and the spectrum's centre of mass moves up; plucking
// over the fretboard (tasto) does the opposite. That shift is large, robust, and
// independent of which note you played once you normalise by the fundamental -
// which is what makes "did you actually change colour?" answerable, unlike most
// of what people mean by "tone".

/** In-place iterative radix-2 FFT. re/im are Float32Array of the same power-of-two length. */
export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error('fft length must be a power of two');

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Magnitude spectrum of a real signal, Hann-windowed. Returns bins 0..n/2. */
export function magnitudeSpectrum(buffer) {
  let n = 1;
  while (n * 2 <= buffer.length) n *= 2;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Hann window: without it, the edges of the frame smear energy across every
    // bin and the centroid drifts upward regardless of how the note was played.
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = buffer[i] * w;
  }
  fft(re, im);
  const half = n / 2;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/**
 * Spectral centroid in Hz - the "centre of mass" of the spectrum.
 * Higher = brighter.
 */
export function spectralCentroid(buffer, sampleRate, { minHz = 60, maxHz = 6000 } = {}) {
  const mag = magnitudeSpectrum(buffer);
  const binHz = sampleRate / (mag.length * 2);
  let num = 0;
  let den = 0;
  const lo = Math.max(1, Math.floor(minHz / binHz));
  const hi = Math.min(mag.length - 1, Math.ceil(maxHz / binHz));
  for (let i = lo; i <= hi; i++) {
    const m = mag[i];
    num += i * binHz * m;
    den += m;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Brightness relative to the note being played.
 *
 * A raw centroid cannot be compared between notes: a high E is brighter than a
 * low E no matter where you pluck it. Dividing by the fundamental gives roughly
 * "how many harmonics up is the centre of mass", which IS comparable across the
 * neck - so a drill can ask for a colour change and mean the same thing on every
 * string.
 */
export function brightness(buffer, sampleRate, fundamentalHz) {
  if (!fundamentalHz || fundamentalHz <= 0) return null;
  const c = spectralCentroid(buffer, sampleRate);
  return c / fundamentalHz;
}
