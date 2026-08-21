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

/**
 * Additive meters are written "3+2". Number() makes NaN of that, and NaN then
 * spread through every beat in the piece: the drill's end time became NaN, the
 * comparison that stops it was never true, and it ran until the user found the
 * stop button.
 */
function readBeats(timeEl) {
  const raw = timeEl.getElementsByTagName('beats')[0]?.textContent?.trim();
  if (!raw) return null;
  const total = raw.split('+').reduce((sum, part) => sum + Number(part.trim()), 0);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Which part of the score is the guitar.
 *
 * It used to be whichever came first. A voice-and-guitar score or a duet
 * imported the wrong instrument with no message - and, because the octave
 * convention is decided from string/fret fingering, dropping the fingered part
 * also quietly downgraded that to a guess.
 */
export function choosePart(doc) {
  const parts = [...doc.getElementsByTagName('part')];
  if (!parts.length) return null;

  // Best evidence: the part that actually carries fingering.
  const fingered = parts.find((p) => {
    const tech = p.getElementsByTagName('technical');
    return [...tech].some((t) => t.getElementsByTagName('string').length && t.getElementsByTagName('fret').length);
  });
  if (fingered) return fingered;

  // Next best: the part the score itself calls a guitar.
  const names = new Map();
  for (const sp of doc.getElementsByTagName('score-part')) {
    const id = sp.getAttribute('id');
    const name = (sp.getElementsByTagName('part-name')[0]?.textContent || '')
      + ' ' + (sp.getElementsByTagName('instrument-name')[0]?.textContent || '');
    if (id) names.set(id, name.toLowerCase());
  }
  const named = parts.find((p) => /guitar|guitarra|gitarre|chitarra|гітар|гитар/.test(names.get(p.getAttribute('id')) || ''));
  if (named) return named;

  return parts[0];
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

  const part = choosePart(doc);
  if (!part) throw new Error('The score has no parts.');

  // <transpose> as declared by the file (may be absent or wrong).
  const transposeEl = part.getElementsByTagName('transpose')[0];
  const declaredShift = transposeEl
    ? (num(transposeEl, 'chromatic') || 0) + 12 * (num(transposeEl, 'octave-change') || 0)
    : null;

  let divisions = 0;
  let beatsPerBar = 4;
  let beatUnit = 4;
  let tempo = null;

  const measures = [];
  const rawNotes = [];

  for (const [index, measureEl] of [...part.getElementsByTagName('measure')].entries()) {
    const notes = [];
    const harmonies = [];

    // ONE walk over the measure, in document order, sharing ONE cursor.
    //
    // It used to be two: chord symbols walked the children and honoured
    // <backup>/<forward>, while the notes were pulled out with
    // getElementsByTagName and counted with a cursor that only ever went
    // forward. Real scores for this instrument are written in two voices -
    // melody and bass - joined by <backup>, so the bass line landed after the
    // end of the bar, the drill demanded the two voices be played one after the
    // other, and the chord symbols pointed at notes that were somewhere else.
    let cursor = 0;            // in divisions, from the start of the measure
    let lastOnset = 0;         // where the last non-chord note began
    let longest = 0;           // furthest point reached, for pickup bars

    for (const child of measureEl.children || []) {
      const tag = child.tagName;

      if (tag === 'attributes') {
        // Every attributes block, not just the first: writers emit more than
        // one per measure and the later ones were being dropped.
        const d = num(child, 'divisions');
        if (d > 0) divisions = d;
        const timeEl = child.getElementsByTagName('time')[0];
        if (timeEl) {
          const beats = readBeats(timeEl);
          if (beats) beatsPerBar = beats;
          const unit = num(timeEl, 'beat-type');
          if (unit > 0) beatUnit = unit;
        }
        continue;
      }

      if (tag === 'sound') {
        const tv = child.getAttribute('tempo');
        if (tv && !tempo) tempo = Number(tv);
        continue;
      }

      if (tag === 'harmony') {
        const h = readHarmony(child);
        const offset = num(child, 'offset') ?? 0;
        if (h) harmonies.push({ ...h, startDiv: cursor + offset });
        continue;
      }

      if (tag === 'forward') { cursor += num(child, 'duration') ?? 0; longest = Math.max(longest, cursor); continue; }
      if (tag === 'backup') { cursor -= num(child, 'duration') ?? 0; continue; }
      if (tag !== 'note') continue;

      // Grace notes carry no duration and would desynchronise the cursor.
      if (child.getElementsByTagName('grace').length) continue;
      if (!divisions) throw new Error('That score does not say how long its notes are (no divisions). Re-export it and try again.');

      const dur = num(child, 'duration') ?? 0;
      const isChord = child.getElementsByTagName('chord').length > 0;
      // An unpitched note is a percussion hit. It cannot be read or played on a
      // guitar, and left as a pitchless non-rest it scored as wrong forever.
      const unpitched = child.getElementsByTagName('unpitched').length > 0;
      const isRest = child.getElementsByTagName('rest').length > 0 || unpitched;
      const pitchEl = child.getElementsByTagName('pitch')[0];
      const filePitch = pitchEl ? pitchToMidi(pitchEl) : null;

      const tech = child.getElementsByTagName('technical')[0];
      const string = tech ? num(tech, 'string') : null;
      const fret = tech ? num(tech, 'fret') : null;

      // <tie> is the sounding tie; <tied> is the notated one. Some writers emit
      // only the latter, and then nothing was tied at all.
      const tieEls = [...child.getElementsByTagName('tie'), ...child.getElementsByTagName('tied')];
      const tieStop = tieEls.some((el) => el.getAttribute('type') === 'stop');
      const tieStart = tieEls.some((el) => el.getAttribute('type') === 'start');

      // A chord note shares the onset of the note it is stacked on. Taking
      // `cursor - dur` assumed its duration matched, which real exports break.
      const startDiv = isChord ? lastOnset : cursor;
      const note = {
        filePitch, isRest, isChord, string, fret, tieStart, tieStop,
        startBeat: startDiv / divisions,
        beats: dur / divisions,
      };
      notes.push(note);
      rawNotes.push(note);

      if (!isChord) { lastOnset = cursor; cursor += dur; }
      longest = Math.max(longest, startDiv + dur);
    }

    // Voices arrive interleaved once <backup> is honoured, so put the bar back
    // into the order it is read in.
    notes.sort((a, b) => a.startBeat - b.startBeat);

    const div = divisions || 1;
    for (const h of harmonies) { h.startBeat = h.startDiv / div; delete h.startDiv; }
    harmonies.sort((a, b) => a.startBeat - b.startBeat);

    // A pickup bar is short by design and says so. Advancing the timeline by a
    // full bar after one would insert silence that is not in the music.
    const implicit = measureEl.getAttribute('implicit') === 'yes';
    const fullBar = (beatsPerBar * 4) / beatUnit;
    const content = longest / div;

    const declared = Number(measureEl.getAttribute('number'));
    measures.push({
      // A pickup is numbered 0, and `|| fallback` treated that as missing -
      // renumbering it 1 and colliding with the real first bar.
      number: Number.isFinite(declared) ? declared : index + 1,
      beatsPerBar,
      beatUnit,
      // How far the timeline moves after this bar, in quarter-note beats.
      lengthBeats: implicit ? Math.min(content, fullBar) : fullBar,
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
export function toSequence(piece, { skipChordNotes = true, joinTies = true } = {}) {
  const seq = [];
  let barStart = 0;
  for (const m of piece.measures) {
    for (const n of m.notes) {
      // Only single notes are gradeable; the mic cannot separate simultaneous
      // pitches, so extra chord tones are carried but not judged.
      if (skipChordNotes && n.isChord) continue;

      const entry = {
        sounding: n.sounding,
        written: n.written,
        isRest: n.isRest,
        string: n.string,
        fret: n.fret,
        beat: barStart + n.startBeat,
        beats: n.beats,
        measure: m.number,
        tieStop: n.tieStop,
        tieStart: n.tieStart,
      };

      // A tie means hold, not strike again. The grader expected a fresh attack
      // on the far side of every tie, so holding one correctly - which is what
      // the notation asks for - was scored as a missed note. Fold the
      // continuation into the note it continues instead of emitting an attack.
      if (joinTies && n.tieStop && !n.isRest && n.sounding != null) {
        const prev = tiePartner(seq, n.sounding);
        if (prev) {
          prev.beats += n.beats;
          prev.tieStart = n.tieStart;   // a chain of ties keeps going
          continue;
        }
      }

      seq.push(entry);
    }
    // In quarter-note beats. Adding beatsPerBar mixed units: in 6/8 it opened a
    // three-beat hole at every barline, and in cut time consecutive bars
    // overlapped each other.
    barStart += m.lengthBeats ?? m.beatsPerBar;
  }
  return seq;
}

/**
 * Find the note a tie is continuing.
 *
 * NOT simply the previous note. Once two voices are read properly the entries
 * interleave, so the melody sits between a bass note and its own continuation -
 * and pairing with whatever came last silently refused to join the tie. A tie
 * stop belongs to the most recent note of the SAME pitch, preferring one that
 * says it started a tie.
 */
function tiePartner(seq, sounding) {
  const WINDOW = 24;   // a tie spans a note or two, never half the piece
  let fallback = null;
  for (let i = seq.length - 1; i >= 0 && i > seq.length - WINDOW; i--) {
    const e = seq[i];
    if (e.isRest || e.sounding !== sounding) continue;
    if (e.tieStart) return e;
    if (!fallback) fallback = e;   // some writers mark only the stop
  }
  return fallback;
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
    barStart += m.lengthBeats ?? m.beatsPerBar;
  }
  return out.sort((a, b) => a.beat - b.beat);
}
