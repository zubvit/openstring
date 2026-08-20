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
/**
 * MusicXML <kind> values, mapped to how the chord is written.
 *
 * An exact table, not a guess: a kind we do not know falls back to the text the
 * file itself supplies, and if there is none the harmony is dropped. Inventing
 * a label for an unrecognised kind would put a chord name over the music that
 * nobody wrote.
 */
export const HARMONY_KINDS = {
  'major': { symbol: '', quality: '' },
  'minor': { symbol: 'm', quality: 'm' },
  'dominant': { symbol: '7', quality: '7' },
  'major-seventh': { symbol: 'maj7', quality: 'maj7' },
  'minor-seventh': { symbol: 'm7', quality: 'm7' },
  'suspended-second': { symbol: 'sus2', quality: 'sus2' },
  'suspended-fourth': { symbol: 'sus4', quality: 'sus4' },
  'diminished': { symbol: 'dim', quality: 'dim' },
  // Known chords we can name but have no shape for; quality stays null so
  // nothing downstream offers a fingering that would be wrong.
  'diminished-seventh': { symbol: 'dim7', quality: null },
  'half-diminished': { symbol: 'm7b5', quality: null },
  'augmented': { symbol: 'aug', quality: null },
  'major-sixth': { symbol: '6', quality: null },
  'minor-sixth': { symbol: 'm6', quality: null },
  'dominant-ninth': { symbol: '9', quality: null },
  'power': { symbol: '5', quality: null },
  'none': null,
};

const STEP_ALTER = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };

/** Read one <harmony>, or null if it names nothing we can write down. */
function readHarmony(el) {
  const rootEl = el.getElementsByTagName('root')[0];
  const step = rootEl?.getElementsByTagName('root-step')[0]?.textContent?.trim();
  if (!step) return null;
  const alter = rootEl.getElementsByTagName('root-alter')[0]?.textContent?.trim() ?? '0';
  const root = step + (STEP_ALTER[String(Number(alter))] ?? '');

  const kindEl = el.getElementsByTagName('kind')[0];
  const kind = kindEl?.textContent?.trim();
  const known = Object.prototype.hasOwnProperty.call(HARMONY_KINDS, kind)
    ? HARMONY_KINDS[kind] : undefined;
  if (known === null) return null;                      // <kind>none</kind>

  let symbol;
  let quality = null;
  if (known) {
    symbol = known.symbol;
    quality = known.quality;
  } else {
    // Unknown kind: use the file's own display text if it gave one, else drop it.
    const text = kindEl?.getAttribute('text');
    if (!text) return null;
    symbol = text.trim();
  }

  const bassEl = el.getElementsByTagName('bass')[0];
  const bassStep = bassEl?.getElementsByTagName('bass-step')[0]?.textContent?.trim();
  const bassAlter = bassEl?.getElementsByTagName('bass-alter')[0]?.textContent?.trim() ?? '0';
  const bass = bassStep ? bassStep + (STEP_ALTER[String(Number(bassAlter))] ?? '') : null;

  return {
    root,
    quality,
    label: `${root}${symbol}${bass ? `/${bass}` : ''}`,
  };
}

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

    // Chord symbols sit between the notes in document order, before the note
    // they label, so they are read by walking the measure's children rather
    // than by pulling out the <note> elements alone.
    const harmonies = [];
    let hCursor = 0;
    for (const child of measureEl.children || []) {
      const tag = child.tagName;
      if (tag === 'harmony') {
        const h = readHarmony(child);
        const offset = num(child, 'offset') ?? 0;
        if (h) harmonies.push({ ...h, startBeat: (hCursor + offset) / divisions });
      } else if (tag === 'note') {
        if (child.getElementsByTagName('grace').length) continue;
        if (child.getElementsByTagName('chord').length) continue;
        hCursor += num(child, 'duration') ?? 0;
      } else if (tag === 'forward') {
        hCursor += num(child, 'duration') ?? 0;
      } else if (tag === 'backup') {
        hCursor -= num(child, 'duration') ?? 0;
      }
    }

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
      harmonies,
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
    harmonyCount: measures.reduce((n, m) => n + m.harmonies.length, 0),
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
      return { shift: 0, basis: 'fingering', noteKey: 'piece.octave.sounding' };
    }
    if (asWritten > 0 && asSounding === 0) {
      return { shift: -OCTAVE_TRANSPOSITION, basis: 'fingering', noteKey: 'piece.octave.written' };
    }
    // Mixed or matching neither: the file is internally inconsistent. Do not guess.
    if (asSounding === 0 && asWritten === 0) {
      return {
        shift: 0, basis: 'unverified', noteKey: 'piece.octave.unverified',
      };
    }
    return {
      shift: asSounding >= asWritten ? 0 : -OCTAVE_TRANSPOSITION,
      basis: 'inconsistent', noteKey: 'piece.octave.inconsistent',
    };
  }

  if (declaredShift !== null && declaredShift !== 0) {
    return { shift: declaredShift, basis: 'transpose', noteKey: 'piece.octave.transpose' };
  }

  return {
    shift: 0, basis: 'assumed', noteKey: 'piece.octave.assumed',
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

/**
 * The chord symbols, on the same beat timeline the note sequence uses.
 *
 * Separate from toSequence because they are not events you play: they label the
 * music, and folding them into the note list would put things in it that the
 * grader would then have to learn to ignore.
 */
export function harmonySequence(piece) {
  const out = [];
  let barStart = 0;
  for (const m of piece.measures) {
    for (const h of m.harmonies || []) {
      out.push({ ...h, beat: barStart + h.startBeat, measure: m.number });
    }
    barStart += m.beatsPerBar;
  }
  return out.sort((a, b) => a.beat - b.beat);
}
