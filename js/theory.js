// Notes, the fretboard, and the guitar's octave transposition.
//
// Everything is MIDI note numbers internally. Two pitches matter and they differ
// by an octave: what the guitar SOUNDS (open low E = MIDI 40, 82.41 Hz) and what
// is WRITTEN on the staff (an octave higher, MIDI 52). Guitar music has used that
// convention for centuries; the mic hears sounding pitch, the staff shows written.
// Mixing them up is the classic guitar-software bug, so the two never share a name
// in this codebase: `sounding` vs `written`.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// Semitone offset of each natural letter above C.
export const LETTER_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const OCTAVE_TRANSPOSITION = 12; // written = sounding + 12

/** Standard tuning, SOUNDING midi, indexed by string number 1..6 (1 = thin high E). */
export const STANDARD_TUNING = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

export const A4_MIDI = 69;
export const A4_HZ = 440;

export function midiToHz(midi, a4 = A4_HZ) {
  return a4 * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function hzToMidiFloat(hz, a4 = A4_HZ) {
  return A4_MIDI + 12 * Math.log2(hz / a4);
}

/**
 * Cents that `hz` deviates from the NEAREST equal-tempered semitone — tuner display.
 * At exactly +/-50 cents the note is equidistant from two semitones and the sign is
 * arbitrary; judge playing with centsFromTarget() instead, which has no such tie.
 */
export function centsOff(hz, a4 = A4_HZ) {
  const f = hzToMidiFloat(hz, a4);
  return Math.round((f - Math.round(f)) * 100);
}

/** Signed cents from `hz` to a specific target note. Positive = played sharp. */
export function centsFromTarget(hz, targetMidi, a4 = A4_HZ) {
  return Math.round((hzToMidiFloat(hz, a4) - targetMidi) * 100);
}

/**
 * Spell a midi number as a staff position.
 * `preferFlats` decides enharmonics; month-one drills use naturals only so it
 * rarely matters, but chromatic levels need a consistent choice.
 * Returns { letter, accidental (-1|0|1), octave, diatonic }.
 * `diatonic` is a monotonic staff-line index: octave * 7 + letterIndex.
 */
export function spell(midi, preferFlats = false) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const naturalPc = [0, 2, 4, 5, 7, 9, 11];
  const idx = naturalPc.indexOf(pc);
  if (idx !== -1) {
    return { letter: LETTERS[idx], accidental: 0, octave, diatonic: octave * 7 + idx };
  }
  if (preferFlats) {
    // Spell as the letter above, flattened.
    const upIdx = naturalPc.findIndex((n) => n > pc);
    const i = upIdx === -1 ? 0 : upIdx;
    const oct = upIdx === -1 ? octave + 1 : octave;
    return { letter: LETTERS[i], accidental: -1, octave: oct, diatonic: oct * 7 + i };
  }
  // Spell as the letter below, sharpened.
  let i = 0;
  for (let k = naturalPc.length - 1; k >= 0; k--) {
    if (naturalPc[k] < pc) { i = k; break; }
  }
  return { letter: LETTERS[i], accidental: 1, octave, diatonic: octave * 7 + i };
}

export function noteName(midi, preferFlats = false) {
  const s = spell(midi, preferFlats);
  return s.letter + (s.accidental === 1 ? '#' : s.accidental === -1 ? 'b' : '') + s.octave;
}

/** Note name without the octave digit — what you say out loud while practising. */
export function pitchClassName(midi, preferFlats = false) {
  const s = spell(midi, preferFlats);
  return s.letter + (s.accidental === 1 ? '#' : s.accidental === -1 ? 'b' : '');
}

export function isNatural(midi) {
  return spell(midi).accidental === 0;
}

// ---------------------------------------------------------------- fretboard

/** SOUNDING midi of a stopped note. string 1..6, fret 0..n */
export function soundingAt(string, fret, tuning = STANDARD_TUNING) {
  return tuning[string] + fret;
}

/** WRITTEN midi of a stopped note — what appears on the staff. */
export function writtenAt(string, fret, tuning = STANDARD_TUNING) {
  return soundingAt(string, fret, tuning) + OCTAVE_TRANSPOSITION;
}

export function soundingToWritten(midi) {
  return midi + OCTAVE_TRANSPOSITION;
}

export function writtenToSounding(midi) {
  return midi - OCTAVE_TRANSPOSITION;
}

/**
 * Every place a SOUNDING pitch can be played within the given constraints.
 * Guitar's defining awkwardness: the same pitch lives in up to six places, so a
 * drill must decide whether it wants "that pitch" or "that pitch there".
 */
export function positionsFor(soundingMidi, { strings = [1, 2, 3, 4, 5, 6], minFret = 0, maxFret = 12, tuning = STANDARD_TUNING } = {}) {
  const out = [];
  for (const s of strings) {
    const fret = soundingMidi - tuning[s];
    if (fret >= minFret && fret <= maxFret) out.push({ string: s, fret });
  }
  return out;
}

/** All playable notes in a region, de-duplicated by position. */
export function notesInRegion({ strings = [1, 2, 3], minFret = 0, maxFret = 3, naturalsOnly = true, tuning = STANDARD_TUNING } = {}) {
  const out = [];
  for (const s of strings) {
    for (let f = minFret; f <= maxFret; f++) {
      const sounding = soundingAt(s, f, tuning);
      if (naturalsOnly && !isNatural(sounding)) continue;
      out.push({ string: s, fret: f, sounding, written: sounding + OCTAVE_TRANSPOSITION });
    }
  }
  return out;
}

/** Stable id for a fretboard position — the key progress and scheduling hang off. */
export function positionId(string, fret) {
  return `s${string}f${fret}`;
}

export function parsePositionId(id) {
  const m = /^s(\d)f(\d+)$/.exec(id);
  if (!m) return null;
  return { string: Number(m[1]), fret: Number(m[2]) };
}
