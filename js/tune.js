// Music that ships with the app, written as text.
//
// The Pieces tab already knows how to drill a score: chunk it by bar, grade each
// chunk against a click, and push the tempo up as it comes clean. What it had no
// way to obtain was a score - the only door in was "import a MusicXML file", so
// unless you owned notation software the app had no music in it at all and could
// only ever show you flashcards. That is a strange thing for a music teacher to
// do, and it is exactly the gap this file closes.
//
// The notation is deliberately small and readable, because the pieces are checked
// by eye in review, not by a program:
//
//     'B3/1 A3/1 G3/2 | B3/1 A3/1 G3/2'
//
// A token is a pitch name, an octave digit, and a duration in QUARTER-note beats
// after the slash. `r` is a rest, `~` ties into the next note, `|` is a barline,
// and a missing duration means one beat. Pitches are SOUNDING pitch, the same
// convention the whole codebase uses - what the microphone would hear, an octave
// below what appears on the staff.

import {
  LETTER_SEMITONES, OCTAVE_TRANSPOSITION, STANDARD_TUNING, positionsFor,
} from './theory.js';

const NOTE = /^([A-Ga-g])(#|b)?(-?\d)(?:\/(\d+(?:\.\d+)?))?(~)?$/;
const REST = /^r(?:\/(\d+(?:\.\d+)?))?$/i;

/** 'F#4' -> sounding midi. Throws on anything it cannot read, loudly and early. */
export function pitchToMidi(name) {
  const m = NOTE.exec(String(name).trim());
  if (!m) throw new Error(`not a pitch: ${name}`);
  const [, letter, acc, octave] = m;
  const semis = LETTER_SEMITONES[letter.toUpperCase()] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
  return (Number(octave) + 1) * 12 + semis;
}

/**
 * Text to bars of note records.
 *
 * Bar lengths are checked against the meter rather than trusted. A tune with a
 * bar half a beat short still plays, but every note after it sits at the wrong
 * moment and the grader then blames the player for it - so a wrong bar is a
 * mistake in the file and is reported as one.
 */
export function parseTune(text, { beatsPerBar = 4, beatUnit = 4, name = 'tune' } = {}) {
  const barBeats = (beatsPerBar * 4) / beatUnit;
  const bars = [];
  const chunks = String(text).split('|').map((s) => s.trim()).filter(Boolean);

  chunks.forEach((chunk, index) => {
    const notes = [];
    let at = 0;
    for (const tok of chunk.split(/\s+/).filter(Boolean)) {
      const rest = REST.exec(tok);
      if (rest) {
        const beats = rest[1] ? Number(rest[1]) : 1;
        notes.push({ isRest: true, sounding: null, written: null, startBeat: at, beats });
        at += beats;
        continue;
      }
      const m = NOTE.exec(tok);
      if (!m) throw new Error(`${name}: cannot read "${tok}" in bar ${index + 1}`);
      const beats = m[4] ? Number(m[4]) : 1;
      const sounding = pitchToMidi(tok.replace(/[/~].*$/, ''));
      notes.push({
        isRest: false,
        sounding,
        written: sounding + OCTAVE_TRANSPOSITION,
        startBeat: at,
        beats,
        tieStart: !!m[5],
      });
      at += beats;
    }

    // A pickup is short on purpose and is always the first bar - and only if
    // there is a bar for it to lead into. A tune whose ONLY bar is short is a
    // typo, and calling it a pickup let that through silently.
    const pickup = index === 0 && chunks.length > 1 && at < barBeats;
    if (!pickup && Math.abs(at - barBeats) > 1e-6) {
      throw new Error(`${name}: bar ${index + 1} is ${at} beats, expected ${barBeats}`);
    }
    bars.push({ notes, lengthBeats: pickup ? at : barBeats, pickup });
  });

  // A tie has to be closed on the far side or toSequence will strike the note
  // again instead of holding it.
  for (let i = 0; i < bars.length; i++) {
    const notes = bars[i].notes;
    for (let j = 0; j < notes.length; j++) {
      if (!notes[j].tieStart) continue;
      const next = notes[j + 1] || bars[i + 1]?.notes[0];
      if (!next || next.isRest || next.sounding !== notes[j].sounding) {
        throw new Error(`${name}: a tie in bar ${i + 1} has nothing of the same pitch to tie into`);
      }
      next.tieStop = true;
    }
  }

  return bars;
}

/**
 * Where to put each note on the neck.
 *
 * Every pitch lives in several places on a guitar and the choice is the lesson:
 * a tune belonging to the third lesson must be fingered where the third lesson
 * has actually been, or the fretboard picture sends him to a string he has never
 * been shown.
 *
 * `taught` is the LIST of positions the lesson has covered, not a rectangle of
 * strings and frets. It has to be a list: stages build on each other, so by the
 * third lesson the set is "the second and third strings, plus the open first
 * string from lesson one" - a shape no min/max fret can describe. Trying it with
 * a rectangle fingered Hot Cross Buns on the third string only and put the open
 * B somewhere he had not been.
 *
 * Among the taught positions the lowest fret wins. Outside them - which happens
 * only for the app's own accompaniment - fall back to the whole neck, so the file
 * still compiles rather than silently losing a note.
 */
export function fingerNote(sounding, taught) {
  const inside = (taught || []).filter((p) => p.sounding === sounding);
  const anywhere = inside.length ? inside : positionsFor(sounding, { maxFret: 12 });
  if (!anywhere.length) return { string: null, fret: null };
  return anywhere
    .map((p) => ({ string: p.string, fret: p.fret }))
    .sort((a, b) => a.fret - b.fret || b.string - a.string)[0];
}

/**
 * A tune spec becomes exactly the object the MusicXML importer produces, so the
 * whole Pieces engine downstream cannot tell the two apart and no code had to
 * learn about a second kind of score.
 */
export function compileTune(spec) {
  const [beatsPerBar, beatUnit] = spec.meter || [4, 4];
  const bars = parseTune(spec.melody, { beatsPerBar, beatUnit, name: spec.id });

  const measures = bars.map((bar, i) => ({
    number: bar.pickup ? 0 : i + (bars[0].pickup ? 0 : 1),
    beatsPerBar,
    beatUnit,
    lengthBeats: bar.lengthBeats,
    notes: bar.notes.map((n) => ({
      ...n,
      isChord: false,
      ...(n.isRest ? { string: null, fret: null } : fingerNote(n.sounding, spec.taught)),
    })),
    harmonies: [],
    ...(i === 0 ? { repeatStart: !!spec.repeat } : {}),
    ...(i === bars.length - 1 ? { repeatEnd: !!spec.repeat } : {}),
  }));

  return {
    title: spec.title,
    composer: spec.composer || '',
    tempo: spec.bpm || 72,
    beatsPerBar,
    beatUnit,
    measures,
    // Built in, and fingered by this file from the pitches themselves, so there
    // is nothing to guess and nothing to warn him about.
    octaveConvention: { basis: 'sounding', shift: 0, noteKey: 'piece.octave.builtIn' },
    noteCount: measures.reduce((n, m) => n + m.notes.filter((x) => !x.isRest).length, 0),
    harmonyCount: 0,
  };
}

/**
 * The part the app plays underneath him, as flat events on the piece's own beat
 * timeline. Not a piece: it is never read, never graded and never chunked, so
 * giving it measures would only invite the rest of the app to treat it as music
 * he is responsible for.
 */
export function compileAccompaniment(spec) {
  if (!spec.accomp) return [];
  const [beatsPerBar, beatUnit] = spec.meter || [4, 4];
  const bars = parseTune(spec.accomp, { beatsPerBar, beatUnit, name: `${spec.id} accompaniment` });
  const out = [];
  let barStart = 0;
  for (const bar of bars) {
    for (const n of bar.notes) {
      if (!n.isRest) out.push({ sounding: n.sounding, beat: barStart + n.startBeat, beats: n.beats });
    }
    barStart += bar.lengthBeats;
  }
  return out.sort((a, b) => a.beat - b.beat);
}

/** Every distinct sounding pitch a tune asks the player for. */
export function pitchesUsed(spec) {
  const [beatsPerBar, beatUnit] = spec.meter || [4, 4];
  const bars = parseTune(spec.melody, { beatsPerBar, beatUnit, name: spec.id });
  const set = new Set();
  for (const bar of bars) for (const n of bar.notes) if (!n.isRest) set.add(n.sounding);
  return [...set].sort((a, b) => a - b);
}

/** Every fretboard position a tune asks the player for, as `s3f2` ids. */
export function positionsUsed(spec) {
  const [beatsPerBar, beatUnit] = spec.meter || [4, 4];
  const bars = parseTune(spec.melody, { beatsPerBar, beatUnit, name: spec.id });
  const set = new Set();
  for (const bar of bars) {
    for (const n of bar.notes) {
      if (n.isRest) continue;
      const p = fingerNote(n.sounding, spec.taught);
      if (p.string != null) set.add(`s${p.string}f${p.fret}`);
    }
  }
  return [...set];
}
