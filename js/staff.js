// Staff rendering, hand-drawn as SVG.
//
// No notation library and no music font: both would be a download, and a missing
// glyph renders as a tofu box, which is worse than no clef at all. Everything here
// is paths and ellipses, so the page is self-contained and works offline forever.
//
// Vertical placement is the part that has to be exactly right. Staff position is
// diatonic, not chromatic: F and F# sit on the same line, and the accidental says
// which one you mean. So every y comes from `diatonic` (octave * 7 + letterIndex),
// never from the midi number.

import { spell } from './theory.js';

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

/**
 * A treble clef drawn as a path. Hand-fitted rather than taken from a font, so it
 * is approximate - but it reads unmistakably as a G clef at the size used here,
 * and it costs no download.
 */
function trebleClefPaths(x, bottomY) {
  // Everything is anchored to the G4 line - that is what a G clef declares, and
  // the spiral must wrap it or the symbol is simply wrong.
  const gy = yForDiatonic(4 * 7 + 4, bottomY);
  const g = LINE_GAP;
  const p = (px, py) => `${(x + px * g).toFixed(2)},${(gy + py * g).toFixed(2)}`;

  // The vertical stroke: down from above the staff, through the spiral, ending
  // in the tail that hooks left below the staff.
  const stem = [
    `M ${p(0.45, -3.30)}`,
    `C ${p(0.45, -2.00)} ${p(0.22, -1.00)} ${p(0.06, 0.20)}`,
    `C ${p(-0.10, 1.40)} ${p(-0.20, 2.40)} ${p(-0.35, 3.10)}`,
    `C ${p(-0.50, 3.75)} ${p(-1.10, 3.65)} ${p(-1.08, 3.00)}`,
  ].join(' ');

  // The sweep: upper hook, across and down the right side, round the big lower
  // loop, then spiralling back in to sit on the G line.
  const sweep = [
    `M ${p(0.45, -3.30)}`,
    `C ${p(-0.55, -2.95)} ${p(-1.05, -2.00)} ${p(-0.92, -1.10)}`,
    `C ${p(-0.80, -0.15)} ${p(0.90, 0.30)} ${p(0.96, 1.20)}`,
    `C ${p(1.02, 2.05)} ${p(0.10, 2.55)} ${p(-0.55, 2.02)}`,
    `C ${p(-1.18, 1.50)} ${p(-1.00, 0.40)} ${p(-0.08, 0.05)}`,
  ].join(' ');

  return [stem, sweep];
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

  for (const d of trebleClefPaths(40, bottomY)) parts.push(`<path d="${d}" class="clef"/>`);
  if (showOctaveEight) {
    // The little 8 below the clef: guitar sounds an octave lower than written.
    parts.push(`<text x="40" y="${bottomY + LINE_GAP * 3.05}" class="clef-eight" text-anchor="middle">8</text>`);
  }

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
  for (const d of trebleClefPaths(40, bottomY)) parts.push(`<path d="${d}" class="clef"/>`);
  if (showOctaveEight) {
    parts.push(`<text x="40" y="${bottomY + LINE_GAP * 3.05}" class="clef-eight" text-anchor="middle">8</text>`);
  }

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
