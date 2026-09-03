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
    // Landmarks first.
    //
    // The usual way to start is the acronyms - Every Good Boy, FACE - which
    // make you spell your way up from the bottom line every time you meet a
    // note. That is not reading, it is decoding, and it stays slow because the
    // work does not shrink with practice.
    //
    // The alternative is to memorise a very few anchors and read everything
    // else as a distance from the nearest one. On a guitar those anchors pick
    // themselves: three open strings land exactly on staff lines, so the
    // beginner's first three notes need no fingers at all and cannot be
    // fumbled. Second line G is the line the treble clef curls around, which
    // is why it is called the G clef; B is the middle line and E is the top
    // space. Two lines and a space, all three of them open strings.
    //
    // Three notes is a deliberately tiny first stage. It is meant to be
    // finished in a sitting.
    id: 'landmarks',
    title: 'Three landmarks',
    blurb: 'Three notes only, and all three are open strings — nothing to finger. G sits on the second line, the one the clef curls around. B is the middle line. E is the top space, just under the highest line. Learn where these three are and every other note can be found by stepping from the nearest one.',
    region: { strings: [1, 2, 3], minFret: 0, maxFret: 0, naturalsOnly: true },
    rhythm: ['quarters'],
    advice: 'Do not spell your way up from the bottom line. Look at where the note sits and ask first whether it is one of these three — that recognition, not counting, is what reading is.',
  },
  {
    // ONE new note.
    //
    // The stage that used to sit here opened the whole top of the neck at once:
    // eight positions, five of them never seen before. That is not a step, it
    // is a cliff, and it is the opposite of what every method book does. Werner
    // adds a single fingered note after the open strings, Noad takes the first
    // and second strings alone, Shearer adds one note to the third string and
    // then two to the second. Nobody deals out five.
    //
    // The third string goes first because its shape is the odd one - open then
    // second fret - where the first and second strings share a shape between
    // them. Learning the exception on its own leaves the pair to be learned as
    // one thing, which is what the next two stages do.
    id: 'string-3',
    title: 'The third string',
    blurb: 'One new note. G is already yours — the open third string, the first of your landmarks. A sits two frets along the same string, and that is the whole stage.',
    region: { strings: [3], minFret: 0, maxFret: 3, naturalsOnly: true },
    builds: true,
    rhythm: ['quarters'],
    advice: 'A is the next letter up from G, so on the staff it sits in the space directly above the line G lives on. One step up the page, two frets along the string.',
  },
  {
    id: 'strings-23',
    title: 'Second and third strings',
    blurb: 'Two new notes, C and D, both on the second string — B there is already a landmark. Five notes now, across two strings.',
    region: { strings: [2, 3], minFret: 0, maxFret: 3, naturalsOnly: true },
    builds: true,
    rhythm: ['quarters', 'half-quarters'],
    advice: 'Watch the shape. On the second string the notes fall on the open string, the first fret and the third. The first string uses exactly the same shape, so learning it here makes the next stage half free.',
  },
  {
    id: 'open-top',
    title: 'Open position, top three strings',
    blurb: 'Two last notes: F and G on the first string — E there is already a landmark. The first string repeats the shape you just learned on the second: open, first fret, third fret. That completes an octave, G up to G, with nothing left over.',
    region: { strings: [1, 2, 3], minFret: 0, maxFret: 3, naturalsOnly: true },
    builds: true,
    rhythm: ['quarters', 'half-quarters'],
    advice: 'Say each note name out loud as you play it. Out loud matters — it forces the name and the place to arrive together. When a note is unfamiliar, find the landmark nearest it and step from there.',
  },
  {
    // The bass half opens the same way the top half did, and for the same
    // reason: three open strings, no fingers, nothing that can be fumbled.
    // Without this the bass arrived as nine notes at once - the identical
    // cliff, one stage later.
    id: 'open-bass',
    title: 'The three bass strings, open',
    blurb: 'Three notes again, and again nothing to finger: the open D, A and low E. They sit below the staff on ledger lines, which is the only thing that is new about them.',
    region: { strings: [4, 5, 6], minFret: 0, maxFret: 0, naturalsOnly: true },
    builds: true,
    rhythm: ['quarters'],
    advice: 'Ledger lines are just the staff continuing past its own edge. Count down from the bottom line rather than trying to recognise them whole.',
  },
  {
    // This used to be followed by an "all six strings" stage whose whole point
    // was mixing the two halves back together. Now that every stage keeps what
    // came before, they were never apart, and that stage had nothing left to
    // say - so this one IS the whole of open position.
    id: 'open-bottom',
    title: 'Open position, bottom three strings',
    blurb: 'The frets on the bass strings now: six new notes joining the three open ones you have. That is the whole of open position, all six strings, naturals only.',
    region: { strings: [4, 5, 6], minFret: 0, maxFret: 3, naturalsOnly: true },
    builds: true,
    rhythm: ['quarters', 'half-quarters', 'eighths'],
    advice: 'These notes sit low on the staff and need ledger lines. Expect to be slower here than on the top strings at first.',
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
    rhythm: ['eighths', 'dotted', 'syncopated', 'swing'],
  },
  {
    id: 'first-twelve',
    title: 'The first twelve frets',
    blurb: 'The whole neck up to the octave, naturals and accidentals. The same pitch now lives in several places and you choose.',
    region: { strings: [1, 2, 3, 4, 5, 6], minFret: 0, maxFret: 12, naturalsOnly: false },
    rhythm: ['dotted', 'syncopated', 'swing', 'sparse', 'sixteenths'],
    advice: 'From here on, reading is about choosing the most comfortable place, not finding the only one.',
  },
];

/**
 * Full note records for a stage: its rectangle of the neck, and - when the
 * stage `builds` - everything the stages before it taught.
 *
 * Reading is cumulative, and a drill that quietly drops what you already know
 * reads as going backwards. It also loses the mixing: practising a new note
 * among old ones is harder in the moment and remembered better afterwards,
 * which is why the plan is one growing pool rather than a series of separate
 * boxes. The flag is per stage because the jump out of open position is a
 * genuine change of subject, not another handful of notes.
 */
export function notesFor(stage) {
  const notes = notesInRegion(stage.region);
  if (!stage.builds) return notes;
  const i = STAGES.findIndex((s) => s.id === stage.id);
  if (i <= 0) return notes;
  const seen = new Set(notes.map((n) => positionId(n.string, n.fret)));
  for (const n of notesFor(STAGES[i - 1])) {
    const id = positionId(n.string, n.fret);
    if (seen.has(id)) continue;
    seen.add(id);
    notes.push(n);
  }
  return notes;
}

/** Every fretboard position a stage can ask about. */
export function poolFor(stage) {
  return notesFor(stage).map((n) => positionId(n.string, n.fret));
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
  // A reason KEY, not a sentence: this string is shown to the user and must be
  // translatable. Returning English here leaked into every other language.
  if (seen < pool.length) return { ready: false, reasonKey: 'progress.notEnoughAttempts', reasonVars: {} };
  const fluent = pool.filter((id) => {
    const s = stats[id];
    return s && s.attempts >= 4 && s.accuracy >= 0.85 && s.avgMs <= 2000;
  }).length;
  const ratio = fluent / pool.length;
  return ratio >= threshold
    ? { ready: true, ratio }
    : { ready: false, ratio, reasonKey: 'progress.fluentRatio', reasonVars: { fluent, total: pool.length } };
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
  // Swing, written the way swing is actually written: three to one, a dotted
  // eighth and a sixteenth. Played swing sits nearer two to one and drifts with
  // tempo, but two thirds and one third cannot be held exactly in binary floating
  // point - eight of them sum to 3.9999999999999996, and the bar-length check
  // below is right to reject that. Three to one is exact, it is what appears on
  // the page, and it is the difference the ear has to learn first: the second note
  // of the pair arrives late, not halfway.
  'swing':         { title: 'Swing',                    meter: [4, 4], durations: [0.75, 0.25, 0.75, 0.25, 0.75, 0.25, 0.75, 0.25], bpm: [50, 88] },
  // Long rests. 'with-rests' takes away a single beat, which you can ride through
  // on momentum without ever really counting. This takes away two of the four and
  // puts the first note on the second half of beat one, so the bar opens with
  // silence and you enter off the beat with no note behind you to lean on. The
  // pulse has to still be running in your head - which is the one thing a click
  // can actually check.
  'sparse':        { title: 'Long rests',               meter: [4, 4], durations: [-0.5, 0.5, -1, 0.5, -0.5, 1], bpm: [50, 90] },
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

/**
 * Which stages you are allowed to switch to: back freely, forward when earned.
 *
 * Going back is not cheating - revisiting a stage you have already done is
 * ordinary practice, and until now there was no way to do it at all: the only
 * route between stages was the advance button, which only ever moved forward.
 * Someone who moved on too early was simply stuck there.
 *
 * Going forward stays gated, and that gate is the point of the whole project.
 * An app that decides what to drill next stops deciding the moment you can jump
 * anywhere from a dropdown, and then you are your own teacher again exactly
 * when you know least.
 *
 * Nothing new is stored: a stage is open if it is one you have already been at,
 * or if the one before it is finished. That heals itself if you jump back - the
 * stages you had earned stay earned, because the statistics behind them do.
 */
export function unlockedStages(currentId, stats = {}, stages = STAGES) {
  const currentIndex = Math.max(0, stages.findIndex((s) => s.id === currentId));
  return stages.map((st, i) => ({
    stage: st,
    index: i,
    current: i === currentIndex,
    done: readyToAdvance(st, stats).ready,
    unlocked: i === 0 || i <= currentIndex || readyToAdvance(stages[i - 1], stats).ready,
  }));
}
