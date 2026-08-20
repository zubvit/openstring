// Staff rendering, hand-drawn as SVG.
//
// No notation library and no webfont: both would be a download, and a font that
// fails to load leaves a tofu box where the clef should be. Everything here is
// paths and ellipses - including the clef, whose outline is baked in from a music
// font at build time - so the page is self-contained and works offline forever.
//
// Vertical placement is the part that has to be exactly right. Staff position is
// diatonic, not chromatic: F and F# sit on the same line, and the accidental says
// which one you mean. So every y comes from `diatonic` (octave * 7 + letterIndex),
// never from the midi number.

import { spell } from './theory.js';
import { G_CLEF, G_CLEF_8VB, UNITS_PER_SPACE } from './clef-glyphs.js';

export const LINE_GAP = 12;              // pixels between staff lines
const BOTTOM_LINE_DIATONIC = 4 * 7 + 2;  // E4 - the bottom line of a treble staff

/** y pixel for a diatonic index, given the y of the bottom staff line. */
export function yForDiatonic(diatonic, bottomY) {
  return bottomY - (diatonic - BOTTOM_LINE_DIATONIC) * (LINE_GAP / 2);
}

/** Ledger line diatonic positions needed for a note (empty when it sits on the staff). */
export function ledgersFor(diatonic) {
  const top = BOTTOM_LINE_DIATONIC + 8;  // F5, the top line
  const out = [];
  if (diatonic < BOTTOM_LINE_DIATONIC) {
    for (let d = BOTTOM_LINE_DIATONIC - 2; d >= diatonic; d -= 2) out.push(d);
  } else if (diatonic > top) {
    for (let d = top + 2; d <= diatonic; d += 2) out.push(d);
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** x of the clef's left edge. The staff lines start at 14; this leaves it air. */
const CLEF_X = 26;

/**
 * The treble clef, as an engraved outline.
 *
 * The glyph's own origin sits on the G line, so placement is a translate and a
 * scale - no fudge factors. y is flipped because font units point up.
 *
 * `withEight` picks the clef that carries its own 8 below (guitar sounds an
 * octave lower than written); the 8 is part of the engraved glyph rather than
 * a text element, so it can never drift out of alignment or pick up the page font.
 */
function trebleClef(bottomY, withEight) {
  const gy = yForDiatonic(4 * 7 + 4, bottomY);       // the G4 line
  const s = (LINE_GAP / UNITS_PER_SPACE).toFixed(5); // font units -> pixels
  const d = withEight ? G_CLEF_8VB : G_CLEF;
  return `<g transform="translate(${CLEF_X},${gy}) scale(${s},-${s})">`
    + `<path d="${d}" class="clef"/></g>`;
}

/**
 * Render one note on a treble staff.
 * @param writtenMidi  the WRITTEN pitch (already transposed for guitar)
 */
export function renderNote(writtenMidi, {
  width = 260, height = null, preferFlats = false, showOctaveEight = true,
  label = '', state = 'idle', // idle | correct | wrong
} = {}) {
  // Low notes on the bottom strings need three ledger lines, which at a fixed
  // height collide with the clef's tail and the caption. Grow the canvas instead
  // of moving the staff: a staff that jumps between questions makes reading
  // harder, which is precisely the opposite of the point.
  const pre = writtenMidi != null ? spell(writtenMidi, preferFlats) : null;
  const led = pre ? ledgersFor(pre.diatonic) : [];
  const below = led.filter((d) => d < BOTTOM_LINE_DIATONIC).length;
  const above = led.filter((d) => d > BOTTOM_LINE_DIATONIC).length;
  const headroom = Math.max(0, above - 1) * LINE_GAP;
  if (height == null) height = 152 + below * LINE_GAP + headroom;

  const bottomY = LINE_GAP * 4 + 28 + headroom;
  const noteX = width * 0.66;
  const parts = [];

  // Staff lines.
  for (let i = 0; i < 5; i++) {
    const y = bottomY - i * LINE_GAP;
    parts.push(`<line x1="14" y1="${y}" x2="${width - 14}" y2="${y}" class="staff-line"/>`);
  }

  parts.push(trebleClef(bottomY, showOctaveEight));

  if (writtenMidi != null) {
    const sp = spell(writtenMidi, preferFlats);
    const y = yForDiatonic(sp.diatonic, bottomY);

    for (const d of ledgersFor(sp.diatonic)) {
      const ly = yForDiatonic(d, bottomY);
      parts.push(`<line x1="${noteX - 13}" y1="${ly}" x2="${noteX + 13}" y2="${ly}" class="staff-line"/>`);
    }

    if (sp.accidental !== 0) {
      const glyph = sp.accidental === 1 ? '♯' : '♭';
      parts.push(`<text x="${noteX - 24}" y="${y + 5}" class="accidental" text-anchor="middle">${glyph}</text>`);
    }

    // Note head: an ellipse tilted the way a real one is.
    parts.push(
      `<ellipse cx="${noteX}" cy="${y}" rx="7.6" ry="5.6" class="notehead ${state}" transform="rotate(-20 ${noteX} ${y})"/>`
    );

    // Stem: down on the left when the note is high, up on the right when low.
    const middle = BOTTOM_LINE_DIATONIC + 4; // B4, the middle line
    if (sp.diatonic >= middle) {
      parts.push(`<line x1="${noteX - 7.2}" y1="${y + 1}" x2="${noteX - 7.2}" y2="${y + LINE_GAP * 3.5}" class="stem"/>`);
    } else {
      parts.push(`<line x1="${noteX + 7.2}" y1="${y - 1}" x2="${noteX + 7.2}" y2="${y - LINE_GAP * 3.5}" class="stem"/>`);
    }
  }

  if (label) {
    parts.push(`<text x="${width / 2}" y="${height - 4}" class="staff-label" text-anchor="middle">${esc(label)}</text>`);
  }

  return `<svg viewBox="0 0 ${width} ${height}" class="staff" role="img" aria-label="${esc(label || 'note on the staff')}">${parts.join('')}</svg>`;
}

/** A small fretboard diagram used for feedback after an answer. */
export function renderFretboard({
  strings = [1, 2, 3, 4, 5, 6], minFret = 0, maxFret = 4,
  mark = null,        // { string, fret } to highlight
  wrongMark = null,   // { string, fret } played by mistake
  width = 260,
} = {}) {
  const nFrets = maxFret - minFret;
  const padL = 34, padR = 14, padT = 16, padB = 18;
  const rowGap = 18;
  const height = padT + padB + (strings.length - 1) * rowGap;
  const colW = (width - padL - padR) / Math.max(1, nFrets);
  const parts = [];

  // Strings run left to right; string 1 (thin) drawn at the top, as you see it
  // looking down at the guitar in your lap.
  const ordered = [...strings].sort((a, b) => a - b);
  ordered.forEach((s, i) => {
    const y = padT + i * rowGap;
    parts.push(`<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" class="fb-string"/>`);
    parts.push(`<text x="${padL - 10}" y="${y + 4}" class="fb-label" text-anchor="end">${s}</text>`);
  });

  for (let f = 0; f <= nFrets; f++) {
    const x = padL + f * colW;
    const isNut = minFret + f === 0;
    parts.push(`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + (ordered.length - 1) * rowGap}" class="${isNut ? 'fb-nut' : 'fb-fret'}"/>`);
    if (minFret + f > 0) {
      parts.push(`<text x="${x - colW / 2}" y="${height - 5}" class="fb-num" text-anchor="middle">${minFret + f}</text>`);
    }
  }

  const dot = (m, cls) => {
    if (!m) return;
    const i = ordered.indexOf(m.string);
    if (i === -1 || m.fret < minFret || m.fret > maxFret) return;
    const y = padT + i * rowGap;
    // An open string is marked at the nut; a stopped note between its frets.
    const x = m.fret === 0 ? padL : padL + (m.fret - minFret - 0.5) * colW;
    parts.push(`<circle cx="${x}" cy="${y}" r="6.5" class="${cls}"/>`);
  };
  dot(wrongMark, 'fb-dot wrong');
  dot(mark, 'fb-dot');

  return `<svg viewBox="0 0 ${width} ${height}" class="fretboard" role="img" aria-label="fretboard diagram">${parts.join('')}</svg>`;
}

/**
 * A chord box - the vertical grid every chord book on earth uses.
 *
 * Deliberately NOT the horizontal fretboard above. That one answers "where is
 * this note", looking down at the guitar in your lap. This one answers "what
 * shape does my hand make", looking at the neck head-on, and every player
 * already reads it that way. Using the wrong orientation for either would make
 * both harder to read.
 *
 * @param shape  { frets, fingers, barre } with index 0 = sixth string
 */
export function renderChordBox(shape, { width = 132, showFingers = true } = {}) {
  if (!shape || !Array.isArray(shape.frets)) return '';

  const fretted = shape.frets.filter((f) => f != null && f > 0);
  const lowest = fretted.length ? Math.min(...fretted) : 1;
  const highest = fretted.length ? Math.max(...fretted) : 1;
  const SPAN = 4;                                    // frets shown in the grid
  // Open shapes always show the nut; a barre chord slides the window up to it.
  const startFret = highest <= SPAN ? 1 : lowest;
  const showNut = startFret === 1;

  const padL = 18, padR = 18, padT = 22, padB = 16;
  const colW = (width - padL - padR) / 5;            // 6 strings, 5 gaps
  const rowH = 20;
  const height = padT + padB + SPAN * rowH;
  const gridTop = padT;
  const gridBottom = padT + SPAN * rowH;
  const parts = [];

  // Strings, low E on the left, as you face the neck.
  for (let i = 0; i < 6; i++) {
    const x = padL + i * colW;
    parts.push(`<line x1="${x}" y1="${gridTop}" x2="${x}" y2="${gridBottom}" class="cb-string"/>`);
  }
  for (let f = 0; f <= SPAN; f++) {
    const y = gridTop + f * rowH;
    const nut = showNut && f === 0;
    parts.push(`<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" class="${nut ? 'cb-nut' : 'cb-fret'}"/>`);
  }
  if (!showNut) {
    parts.push(`<text x="${padL - 6}" y="${gridTop + rowH * 0.7}" class="cb-fretnum" text-anchor="end">${startFret}</text>`);
  }

  // Above the grid: a circle for an open string, a cross for one you do not play.
  shape.frets.forEach((f, i) => {
    const x = padL + i * colW;
    if (f == null) {
      parts.push(`<text x="${x}" y="${gridTop - 7}" class="cb-mute" text-anchor="middle">×</text>`);
    } else if (f === 0) {
      parts.push(`<circle cx="${x}" cy="${gridTop - 11}" r="4" class="cb-open"/>`);
    }
  });

  // A barre is one bar, not six separate dots - that is what the hand does.
  if (shape.barre) {
    const held = shape.frets
      .map((f, i) => (f === shape.barre.fret ? i : -1))
      .filter((i) => i >= 0);
    if (held.length > 1) {
      const y = gridTop + (shape.barre.fret - startFret + 0.5) * rowH;
      const x1 = padL + held[0] * colW;
      const x2 = padL + held[held.length - 1] * colW;
      parts.push(`<rect x="${x1 - 6.5}" y="${y - 6.5}" width="${x2 - x1 + 13}" height="13" rx="6.5" class="cb-barre"/>`);
    }
  }

  shape.frets.forEach((f, i) => {
    if (f == null || f === 0) return;
    if (shape.barre && f === shape.barre.fret) return;   // already under the bar
    const x = padL + i * colW;
    const y = gridTop + (f - startFret + 0.5) * rowH;
    parts.push(`<circle cx="${x}" cy="${y}" r="6.5" class="cb-dot"/>`);
    if (showFingers && shape.fingers?.[i]) {
      parts.push(`<text x="${x}" y="${y + 3.4}" class="cb-finger" text-anchor="middle">${shape.fingers[i]}</text>`);
    }
  });

  // The barre's own finger goes on the bar itself, once.
  if (shape.barre && showFingers) {
    const i = 6 - shape.barre.rootString;
    const finger = shape.fingers?.[i];
    if (finger) {
      const y = gridTop + (shape.barre.fret - startFret + 0.5) * rowH;
      parts.push(`<text x="${padL + i * colW}" y="${y + 3.4}" class="cb-finger" text-anchor="middle">${finger}</text>`);
    }
  }

  return `<svg viewBox="0 0 ${width} ${height}" class="chordbox" role="img" aria-label="chord diagram">${parts.join('')}</svg>`;
}

/**
 * A phrase on a single staff.
 *
 * Reading is a horizontal skill: you take in a line, not a series of isolated
 * cards. Rendering each note on its own staff would quietly turn piece practice
 * back into flashcards, which is the thing this app exists to avoid.
 *
 * @param notes  [{ written, beat, beats, isRest }] - beats position them
 */
export function renderPhrase(notes, {
  width = 520, preferFlats = false, showOctaveEight = true, states = {},
} = {}) {
  const sounded = notes.filter((n) => !n.isRest && n.written != null);
  if (!sounded.length) return renderNote(null, { width });

  const spelled = sounded.map((n) => ({ n, sp: spell(n.written, preferFlats) }));
  const ledgers = spelled.map(({ sp }) => ledgersFor(sp.diatonic));
  const below = Math.max(0, ...ledgers.map((l) => l.filter((d) => d < BOTTOM_LINE_DIATONIC).length));
  const above = Math.max(0, ...ledgers.map((l) => l.filter((d) => d > BOTTOM_LINE_DIATONIC).length));
  const headroom = Math.max(0, above - 1) * LINE_GAP;
  const height = 150 + below * LINE_GAP + headroom;
  const bottomY = LINE_GAP * 4 + 28 + headroom;

  const parts = [];
  for (let i = 0; i < 5; i++) {
    const y = bottomY - i * LINE_GAP;
    parts.push(`<line x1="14" y1="${y}" x2="${width - 14}" y2="${y}" class="staff-line"/>`);
  }
  parts.push(trebleClef(bottomY, showOctaveEight));

  // Space notes by musical position so the picture matches the rhythm.
  const first = notes[0].beat ?? 0;
  const span = Math.max(
    1,
    Math.max(...notes.map((n) => (n.beat ?? 0) + (n.beats ?? 1))) - first,
  );
  const left = 78;
  const right = width - 26;
  const xFor = (beat) => left + ((beat - first) / span) * (right - left);

  const middle = BOTTOM_LINE_DIATONIC + 4;
  spelled.forEach(({ n, sp }, i) => {
    const x = xFor(n.beat ?? i);
    const y = yForDiatonic(sp.diatonic, bottomY);
    for (const d of ledgersFor(sp.diatonic)) {
      const ly = yForDiatonic(d, bottomY);
      parts.push(`<line x1="${x - 11}" y1="${ly}" x2="${x + 11}" y2="${ly}" class="staff-line"/>`);
    }
    if (sp.accidental !== 0) {
      parts.push(`<text x="${x - 20}" y="${y + 5}" class="accidental" text-anchor="middle">${sp.accidental === 1 ? '♯' : '♭'}</text>`);
    }
    const state = states[i] || '';
    parts.push(`<ellipse cx="${x}" cy="${y}" rx="7" ry="5.2" class="notehead ${state}" transform="rotate(-20 ${x} ${y})"/>`);
    if (sp.diatonic >= middle) {
      parts.push(`<line x1="${x - 6.7}" y1="${y + 1}" x2="${x - 6.7}" y2="${y + LINE_GAP * 3.2}" class="stem"/>`);
    } else {
      parts.push(`<line x1="${x + 6.7}" y1="${y - 1}" x2="${x + 6.7}" y2="${y - LINE_GAP * 3.2}" class="stem"/>`);
    }
  });

  // Rests are drawn as a small mark so silence is visibly part of the line.
  for (const n of notes) {
    if (!n.isRest) continue;
    const x = xFor(n.beat ?? 0);
    parts.push(`<rect x="${x - 5}" y="${bottomY - LINE_GAP * 2.5}" width="10" height="4" class="rest-mark"/>`);
  }

  return `<svg viewBox="0 0 ${width} ${height}" class="staff phrase" role="img" aria-label="phrase of ${sounded.length} notes">${parts.join('')}</svg>`;
}
