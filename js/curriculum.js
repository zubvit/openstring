// The plan. This is the part a drill machine normally leaves to you.
//
// Nootka and its relatives will happily quiz you forever without ever saying
// "you are ready for the next thing" - so the learner has to be their own teacher
// exactly when they know least. Each stage here states its region of the neck in
// plain words, and advancement is earned by measured fluency (fast AND accurate
// across the whole region), never by time served or by a streak.
//
// Sequencing follows how classical guitar method books actually order things:
// open position first because it is where notation and the instrument line up
// most simply, one string group at a time, naturals before accidentals, and
// position shifts only once open position is genuinely automatic.

import { notesInRegion, positionId } from './theory.js';

export const STAGES = [
  {
    id: 'open-top',
    title: 'Open position, top three strings',
    blurb: 'E, B and G strings, first three frets, natural notes only. This is exactly one octave — G up to G — with nothing left over.',
    region: { strings: [1, 2, 3], minFret: 0, maxFret: 3, naturalsOnly: true },
    rhythm: ['quarters', 'half-quarters'],
    advice: 'Say each note name out loud as you play it. Out loud matters — it forces the name and the place to arrive together.',
  },
  {
    id: 'open-bottom',
    title: 'Open position, bottom three strings',
    blurb: 'D, A and low E strings, first three frets, naturals. The bass half of open position, learned the same way.',
    region: { strings: [4, 5, 6], minFret: 0, maxFret: 3, naturalsOnly: true },
    rhythm: ['quarters', 'half-quarters', 'eighths'],
    advice: 'These notes sit low on the staff and need ledger lines. Expect to be slower here than on the top strings at first.',
  },
  {
    id: 'open-all',
    title: 'All six strings, open position',
    blurb: 'The whole of open position, naturals only. The two halves you learned separately, now mixed.',
    region: { strings: [1, 2, 3, 4, 5, 6], minFret: 0, maxFret: 3, naturalsOnly: true },
    rhythm: ['quarters', 'eighths', 'with-rests'],
    advice: 'Mixing is harder than either half alone. If a note is slow, it is usually the string you are unsure of, not the pitch.',
  },
  {
    id: 'open-chromatic',
    title: 'Open position with sharps and flats',
    blurb: 'The same region, now including the notes between. Same places on the neck, more names to attach.',
    region: { strings: [1, 2, 3, 4, 5, 6], minFret: 0, maxFret: 4, naturalsOnly: false },
    rhythm: ['eighths', 'with-rests', 'dotted'],
    advice: 'An accidental changes the name, not the line it sits on. F and F sharp live on the same line.',
  },
  {
    id: 'position-v',
    title: 'Fifth position',
    blurb: 'Frets five to eight, all six strings. The first shift away from the open strings.',
    region: { strings: [1, 2, 3, 4, 5, 6], minFret: 5, maxFret: 8, naturalsOnly: true },
    advice: 'Nothing is open here, so your hand has no anchor. That is the point — this is where the neck starts to generalise.',
    rhythm: ['eighths', 'dotted', 'syncopated'],
  },
  {
    id: 'first-twelve',
    title: 'The first twelve frets',
    blurb: 'The whole neck up to the octave, naturals and accidentals. The same pitch now lives in several places and you choose.',
    region: { strings: [1, 2, 3, 4, 5, 6], minFret: 0, maxFret: 12, naturalsOnly: false },
    rhythm: ['dotted', 'syncopated', 'sixteenths'],
    advice: 'From here on, reading is about choosing the most comfortable place, not finding the only one.',
  },
];

/** Every fretboard position a stage can ask about. */
export function poolFor(stage) {
  return notesInRegion(stage.region).map((n) => positionId(n.string, n.fret));
}

/** Full note records (with pitches) for a stage. */
export function notesFor(stage) {
  return notesInRegion(stage.region);
}

export function stageById(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

export function nextStage(id) {
  const i = STAGES.findIndex((s) => s.id === id);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

/**
 * Ready to move on?
 * Requires most of the region fluent AND a floor of real attempts, so a lucky
 * handful of quick answers cannot promote you out of a stage you have not learned.
 */
export function readyToAdvance(stage, stats, { threshold = 0.8 } = {}) {
  const pool = poolFor(stage);
  const seen = pool.filter((id) => (stats[id]?.attempts || 0) >= 4).length;
  if (seen < pool.length) return { ready: false, reason: 'not every note has been asked enough times yet' };
  const fluent = pool.filter((id) => {
    const s = stats[id];
    return s && s.attempts >= 4 && s.accuracy >= 0.85 && s.avgMs <= 2000;
  }).length;
  const ratio = fluent / pool.length;
  return ratio >= threshold
    ? { ready: true, ratio }
    : { ready: false, ratio, reason: `${fluent} of ${pool.length} notes are fast and accurate` };
}

// ------------------------------------------------------------------ rhythm

/**
 * Rhythm patterns as note durations in beats. A rest is a negative duration:
 * time passes, no note is expected. Clapping or playing these against a click
 * is where timing is actually learned - reading pitch and keeping time are
 * separate skills and mixing them early means failing at both.
 */
export const RHYTHMS = {
  'quarters':      { title: 'Four steady beats',        meter: [4, 4], durations: [1, 1, 1, 1], bpm: [50, 90] },
  'half-quarters': { title: 'Halves and quarters',      meter: [4, 4], durations: [2, 1, 1], bpm: [50, 90] },
  'eighths':       { title: 'Eighth notes',             meter: [4, 4], durations: [0.5, 0.5, 1, 0.5, 0.5, 1], bpm: [50, 100] },
  'with-rests':    { title: 'Rests',                    meter: [4, 4], durations: [1, -1, 1, 1], bpm: [50, 90] },
  'dotted':        { title: 'Dotted rhythms',           meter: [4, 4], durations: [1.5, 0.5, 1, 1], bpm: [50, 88] },
  'syncopated':    { title: 'Off the beat',             meter: [4, 4], durations: [0.5, 1, 1, 1, 0.5], bpm: [50, 84] },
  'sixteenths':    { title: 'Sixteenths',               meter: [4, 4], durations: [0.25, 0.25, 0.25, 0.25, 1, 1, 1], bpm: [44, 76] },
};

/**
 * Expected onset times in seconds for a pattern at a tempo.
 * Rests advance the clock without producing an expected note.
 */
export function expectedOnsets(patternId, bpm, { startAt = 0, bars = 1 } = {}) {
  const pat = RHYTHMS[patternId];
  if (!pat) return [];
  const beat = 60 / bpm;
  const barBeats = pat.meter[0];
  const out = [];
  for (let bar = 0; bar < bars; bar++) {
    let t = startAt + bar * barBeats * beat;
    for (const d of pat.durations) {
      if (d > 0) out.push(t);
      t += Math.abs(d) * beat;
    }
  }
  return out;
}
