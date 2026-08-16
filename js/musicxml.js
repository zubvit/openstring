// MusicXML import.
//
// THE OCTAVE TRAP, again, and worse than before. Guitar is a transposing
// instrument: it sounds an octave below what is written. MusicXML says <pitch>
// holds the WRITTEN pitch and <transpose> tells you how to reach the sounding
// one - but real exporters disagree. Guitar Pro and MuseScore commonly write the
// SOUNDING pitch and merely draw the clef with a little 8, which is the opposite
// convention. Guess wrong and every note in the piece is an octave out, which
// looks like a broken pitch detector rather than a broken importer.
//
// Rather than guess, this resolves it deterministically whenever the file carries
// fingering: string + fret gives the sounding pitch by arithmetic, so comparing
// that against <pitch> says which convention the file uses. Exact integers, no
// threshold, no "close enough". Only when a file has no fingering at all do we
// fall back to <transpose>, and failing that we say plainly that we assumed.

import { STANDARD_TUNING, OCTAVE_TRANSPOSITION, LETTER_SEMITONES } from './theory.js';

const text = (el, tag) => el?.getElementsByTagName(tag)?.[0]?.textContent?.trim() ?? null;
const num = (el, tag) => {
  const v = text(el, tag);
  return v === null ? null : Number(v);
};

function pitchToMidi(pitchEl) {
  const step = text(pitchEl, 'step');
  const octave = num(pitchEl, 'octave');
  const alter = num(pitchEl, 'alter') || 0;
  if (step == null || octave == null) return null;
  return (octave + 1) * 12 + LETTER_SEMITONES[step] + alter;
}

/**
 * Parse MusicXML into a piece we can practise.
 * `xmlText` is the document; `DOMParserImpl` lets tests inject a parser.
 */
export function parseMusicXML(xmlText, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('That file is not valid XML.');

  const scoreEl = doc.getElementsByTagName('score-partwise')[0];
  if (!scoreEl) throw new Error('Not a MusicXML score (expected score-partwise). If you exported a compressed .mxl, unzip it first.');

  const title = text(doc.getElementsByTagName('work')[0], 'work-title')
    || text(doc.getElementsByTagName('movement-title')[0] ? doc : null, 'movement-title')
    || 'Untitled';
  const creators = [...doc.getElementsByTagName('creator')];
  const composer = creators.find((c) => c.getAttribute('type') === 'composer')?.textContent?.trim() || '';

  const part = doc.getElementsByTagName('part')[0];
  if (!part) throw new Error('The score has no parts.');

  // <transpose> as declared by the file (may be absent or wrong).
  const transposeEl = part.getElementsByTagName('transpose')[0];
  const declaredShift = transposeEl
    ? (num(transposeEl, 'chromatic') || 0) + 12 * (num(transposeEl, 'octave-change') || 0)
    : null;

  let divisions = 1;
  let beatsPerBar = 4;
  let beatUnit = 4;
  let tempo = null;

  const measures = [];
  const rawNotes = [];

  for (const measureEl of part.getElementsByTagName('measure')) {
    const attrs = measureEl.getElementsByTagName('attributes')[0];
    if (attrs) {
      const d = num(attrs, 'divisions');
      if (d) divisions = d;
      const timeEl = attrs.getElementsByTagName('time')[0];
      if (timeEl) {
        beatsPerBar = num(timeEl, 'beats') ?? beatsPerBar;
        beatUnit = num(timeEl, 'beat-type') ?? beatUnit;
      }
    }
    for (const s of measureEl.getElementsByTagName('sound')) {
      const tv = s.getAttribute('tempo');
      if (tv && !tempo) tempo = Number(tv);
    }

    const notes = [];
    let cursor = 0; // in divisions, from the start of the measure

    for (const noteEl of measureEl.getElementsByTagName('note')) {
      // Grace notes carry no duration and would desynchronise the cursor.
      if (noteEl.getElementsByTagName('grace').length) continue;

      const dur = num(noteEl, 'duration') ?? 0;
      const isRest = noteEl.getElementsByTagName('rest').length > 0;
      const isChord = noteEl.getElementsByTagName('chord').length > 0;
      const pitchEl = noteEl.getElementsByTagName('pitch')[0];
      const filePitch = pitchEl ? pitchToMidi(pitchEl) : null;

      const tech = noteEl.getElementsByTagName('technical')[0];
      const string = tech ? num(tech, 'string') : null;
      const fret = tech ? num(tech, 'fret') : null;

      const tieStop = [...noteEl.getElementsByTagName('tie')].some((t) => t.getAttribute('type') === 'stop');
      const tieStart = [...noteEl.getElementsByTagName('tie')].some((t) => t.getAttribute('type') === 'start');

      const startDiv = isChord ? cursor - dur : cursor; // a chord note shares the previous onset
      const note = {
        filePitch, isRest, isChord, string, fret, tieStart, tieStop,
        startBeat: (startDiv / divisions),
        beats: dur / divisions,
      };
      notes.push(note);
      rawNotes.push(note);
      if (!isChord) cursor += dur;
    }

    measures.push({
      number: Number(measureEl.getAttribute('number')) || measures.length + 1,
      beatsPerBar,
      beatUnit,
      notes,
    });
  }

  const convention = resolveOctaveConvention(rawNotes, declaredShift);

  // Apply the resolved convention: everything downstream deals in sounding pitch,
  // and derives written pitch from it, exactly like the rest of the app.
  for (const n of rawNotes) {
    if (n.isRest || n.filePitch == null) { n.sounding = null; n.written = null; continue; }
    n.sounding = n.filePitch + convention.shift;
    n.written = n.sounding + OCTAVE_TRANSPOSITION;
  }

  return {
    title, composer, tempo,
    beatsPerBar, beatUnit,
    measures,
    octaveConvention: convention,
    noteCount: rawNotes.filter((n) => !n.isRest).length,
  };
}

/**
 * Decide whether <pitch> in this file is sounding or written pitch.
 * Fingering settles it by arithmetic when present; otherwise fall back, and say so.
 */
function resolveOctaveConvention(notes, declaredShift) {
  const fingered = notes.filter((n) => !n.isRest && n.filePitch != null
    && n.string != null && n.fret != null
    && STANDARD_TUNING[n.string] != null);

  if (fingered.length >= 3) {
    let asSounding = 0;
    let asWritten = 0;
    for (const n of fingered) {
      const trueSounding = STANDARD_TUNING[n.string] + n.fret;
      if (n.filePitch === trueSounding) asSounding++;
      else if (n.filePitch === trueSounding + OCTAVE_TRANSPOSITION) asWritten++;
    }
    // Require agreement from the file itself, not a majority vote on ambiguous data.
    if (asSounding > 0 && asWritten === 0) {
      return { shift: 0, basis: 'fingering', note: 'Pitches match the string and fret positions exactly, so they are sounding pitch.' };
    }
    if (asWritten > 0 && asSounding === 0) {
      return { shift: -OCTAVE_TRANSPOSITION, basis: 'fingering', note: 'Pitches sit an octave above the string and fret positions, so they are written pitch.' };
    }
    // Mixed or matching neither: the file is internally inconsistent. Do not guess.
    if (asSounding === 0 && asWritten === 0) {
      return {
        shift: 0, basis: 'unverified',
        note: 'The fingering in this file does not agree with its own pitches, so the octave could not be confirmed. Assuming the pitches are what the guitar sounds.',
      };
    }
    return {
      shift: asSounding >= asWritten ? 0 : -OCTAVE_TRANSPOSITION,
      basis: 'inconsistent',
      note: 'This file mixes both octave conventions. Check a few notes before trusting it.',
    };
  }

  if (declaredShift !== null && declaredShift !== 0) {
    return { shift: declaredShift, basis: 'transpose', note: 'Used the transposition declared in the file.' };
  }

  return {
    shift: 0, basis: 'assumed',
    note: 'This file has no fingering and declares no transposition, so the pitches were taken as what the guitar sounds. If every note comes out an octave wrong, flip the octave switch.',
  };
}

/** Flatten to a practice sequence: one entry per attack, rests preserved. */
export function toSequence(piece, { skipChordNotes = true } = {}) {
  const seq = [];
  let barStart = 0;
  for (const m of piece.measures) {
    for (const n of m.notes) {
      // Only single notes are gradeable; the mic cannot separate simultaneous
      // pitches, so extra chord tones are carried but not judged.
      if (skipChordNotes && n.isChord) continue;
      seq.push({
        sounding: n.sounding,
        written: n.written,
        isRest: n.isRest,
        string: n.string,
        fret: n.fret,
        beat: barStart + n.startBeat,
        beats: n.beats,
        measure: m.number,
        tieStop: n.tieStop,
      });
    }
    barStart += m.beatsPerBar;
  }
  return seq;
}
