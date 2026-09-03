// The lessons, in order.
//
// A stage is a region of the neck; a lesson is a sitting. The two are not the
// same size, and pretending they were is what went wrong: the stage ladder said
// "now the second string" and the app turned that into one undifferentiated slab
// of practice with no beginning, no end and no music in it.
//
// So a stage is split until each lesson introduces ONE new note - or one pair
// that is genuinely one skill, like the two remaining open bass strings, or two
// frets of the same hand shape. That is what the method books do. Werner gives
// exactly one fingered note after the open strings; Noad takes string pairs;
// Shearer adds one, then two. Nobody deals out five.
//
// Every lesson has the same shape, and it is the shape of a real lesson:
//
//   warm up on what you already know  ->  meet the new note alone
//   ->  read them all mixed together  ->  play a piece  ->  play a duet
//
// The warm-up is not filler. Mixing old material in with new feels worse and
// works better, and without it a note learned in lesson two is never seen again.
// The duet is the point of the lesson, not its dessert; it comes last because it
// needs the notes, not because it matters least.
//
// `newNotes` is the whole truth about what a lesson costs. Everything else -
// what the drill may ask, what the warm-up draws on, which pieces are playable -
// is derived from the running total of these, in js/lesson.js. Nothing states a
// note set twice.

export const LESSONS = [
  {
    id: 'l1',
    n: 1,
    stage: 'landmarks',
    title: 'Two lines',
    blurb: 'Two notes, and neither needs a finger. G sits on the second line — the one the treble clef curls around, which is why it is called the G clef. B is the middle line. Two lines, two open strings, and by the end of this you will have played a duet.',
    newNotes: ['s3f0', 's2f0'],
    advice: 'Do not spell your way up from the bottom line. Look at where the note sits and recognise it. That recognition, not counting, is what reading is.',
    steps: [
      { kind: 'learn', positions: ['s3f0', 's2f0'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'evening-bells' },
      { kind: 'duet', piece: 'cuckoo-in-the-pines' },
    ],
  },
  {
    id: 'l2',
    n: 2,
    stage: 'landmarks',
    title: 'The top space',
    blurb: 'E, the thinnest string, in the top space just under the highest line. That is the third landmark, and with it every other note on the guitar can be found by stepping from whichever of the three is nearest.',
    newNotes: ['s1f0'],
    advice: 'Three landmarks is deliberately few. They are anchors, not a scale — the point is that you never count lines again, you measure from the nearest one you know.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s1f0'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'play', piece: 'three-lanterns' },
      { kind: 'duet', piece: 'starlight' },
    ],
  },
  {
    id: 'l3',
    n: 3,
    stage: 'string-3',
    title: 'Two frets along',
    blurb: 'The first note you actually finger: A, second fret of the third string. One note is not a small ambition — it is exactly what a method book gives you after the open strings, and four notes is already enough for a tune everybody knows.',
    newNotes: ['s3f2'],
    advice: 'Keep the finger close behind the fret, not on the wire. A buzz is almost always the finger sitting on top of the fret rather than behind it.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s3f2'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'hot-cross-buns' },
      { kind: 'play', piece: 'au-clair-de-la-lune' },
    ],
  },
  {
    id: 'l4',
    n: 4,
    stage: 'strings-23',
    title: 'One step higher',
    blurb: 'C, the first fret of the second string. Four notes become five, and one of the most famous four-note figures ever written is now under your hand.',
    newNotes: ['s2f1'],
    advice: 'First finger for C. Leave it there while you play the open strings around it — a hand that resets between every note is a hand that will never get fast.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s2f1'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'shchedryk' },
      { kind: 'play', piece: 'quiet-steps' },
    ],
  },
  {
    id: 'l5',
    n: 5,
    stage: 'strings-23',
    title: 'The five-note world',
    blurb: 'D, the third fret of the second string. Five notes, and the folk repertoire opens up properly — three of the pieces here are tunes you already know by heart.',
    newNotes: ['s2f3'],
    advice: 'Third finger for D, first for C, and the hand stays put. This is also the first lesson with a dotted rhythm, so count it out loud before you play it.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s2f3'] },
      { kind: 'rhythm', pattern: 'dotted' },
      { kind: 'read', goal: 'streak10' },
      { kind: 'play', piece: 'mary-had-a-little-lamb' },
      { kind: 'duet', piece: 'ode-to-joy' },
      { kind: 'ear', piece: 'jingle-bells' },
    ],
  },
  {
    id: 'l6',
    n: 6,
    stage: 'open-top',
    title: 'The first fret',
    blurb: 'F, the first fret of the thinnest string. It is a half step above E — the smallest distance on the instrument, and the one most often played by accident.',
    newNotes: ['s1f1'],
    advice: 'Check you are on the first string and not the second. F and the open E are one fret apart, which is why they get confused, and why hearing the difference matters more here than anywhere so far.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s1f1'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'april-air' },
      { kind: 'play', piece: 'the-half-step' },
    ],
  },
  {
    id: 'l7',
    n: 7,
    stage: 'open-top',
    title: 'The octave closed',
    blurb: 'G at the third fret of the first string — the same letter as the G you started on, an octave up. The top three strings are now complete and a tune can go anywhere on them.',
    newNotes: ['s1f3'],
    advice: 'Two Gs, one at each end. Play them one after the other and listen: that sameness is what an octave is, and hearing it is worth more than being told it.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s1f3'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'ode-to-joy-in-c' },
      { kind: 'play', piece: 'lightly-row' },
    ],
  },
  {
    id: 'l8',
    n: 8,
    stage: 'open-bass',
    title: 'Below the staff',
    blurb: 'D, the open fourth string — and the first note that will not fit on the staff at all. It gets its own short line underneath, a ledger line, and everything below the staff works that way.',
    newNotes: ['s4f0'],
    advice: 'Expect to be slower down here at first. Notes below the staff are counted from a line that is not printed until the note needs it, so they take longer to recognise. That is normal and it wears off.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s4f0'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'frere-jacques' },
      { kind: 'play', piece: 'deep-river-bells' },
    ],
  },
  {
    id: 'l9',
    n: 9,
    stage: 'open-bass',
    title: 'The floor of the instrument',
    blurb: 'The last two open strings, A and the low E. Two at once because they are one skill — no fingers, both below the staff, and the lowest notes the guitar has.',
    newNotes: ['s5f0', 's6f0'],
    advice: 'The low E is the hardest note for the app to hear and the easiest to play badly. Pluck it cleanly rather than hard; a thick string played hard goes sharp before it settles.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s5f0', 's6f0'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'the-foundation' },
      { kind: 'play', piece: 'six-open-strings' },
    ],
  },
  {
    id: 'l10',
    n: 10,
    stage: 'open-bottom',
    title: 'Fingers on the fourth',
    blurb: 'E and F on the fourth string, second and third frets. Two at once because it is one hand shape, and it is the same shape you will use on the fifth and sixth strings next.',
    newNotes: ['s4f2', 's4f3'],
    advice: 'Second finger for E, third for F. Same two fingers, same two frets, every bass string from here on — learn the shape once and the rest is bookkeeping.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s4f2', 's4f3'] },
      { kind: 'rhythm', pattern: 'eighths' },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'old-macdonald' },
      { kind: 'play', piece: 'the-fourth-string-song' },
    ],
  },
  {
    id: 'l11',
    n: 11,
    stage: 'open-bottom',
    title: 'Fingers on the fifth',
    blurb: 'B and C on the fifth string. The same shape as last time, one string down — which is the first moment the neck starts to feel like a system rather than a list.',
    newNotes: ['s5f2', 's5f3'],
    advice: 'If this felt easier than the fourth string did, that is the point. The shape is the same; only the names changed.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s5f2', 's5f3'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'play', piece: 'joy-descending' },
      { kind: 'duet', piece: 'walking-home' },
    ],
  },
  {
    id: 'l12',
    n: 12,
    stage: 'open-bottom',
    title: 'Fingers on the sixth',
    blurb: 'F and G on the lowest string, first and third frets. The last two notes of open position, and after them there is nothing left to add.',
    newNotes: ['s6f1', 's6f3'],
    advice: 'First finger for F, third for G — a different pair from the last two lessons, because the gap here is two frets rather than one. Look at the fretboard picture before you assume.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s6f1', 's6f3'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'ode-in-the-bass' },
      { kind: 'play', piece: 'old-bear' },
    ],
  },
  {
    id: 'l13',
    n: 13,
    stage: 'open-bottom',
    title: 'The whole open position',
    blurb: 'Nothing new. Seventeen notes, all six strings, everything you have learned mixed together — and the run to finish it is twenty in a row rather than ten, because this is the end of open position and it should feel like it.',
    // Deliberately empty. A consolidation lesson introduces nothing and is not a
    // gap in the course: mixing everything is a harder skill than any of the
    // notes in it, and it is the only place that skill gets practised.
    newNotes: [],
    advice: 'If a note is slow here it is almost never the pitch — it is the string you are unsure of. Notice which one it is and that is your practice for the week.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'read', goal: 'streak20' },
      { kind: 'duet', piece: 'frere-jacques-in-c' },
      { kind: 'play', piece: 'the-whole-house' },
    ],
  },
  {
    // The first accidental, and it is chosen so that nothing else has to change.
    // F sharp is the one gap left on the lowest string, so the three naturals he
    // already owns there - E, F, G - close up into a four-step chromatic run the
    // moment it arrives. One new note buys a whole new kind of line, which is the
    // cheapest lesson in the course and very nearly the largest.
    id: 'l14',
    n: 14,
    stage: 'open-chromatic',
    title: 'The note between',
    blurb: 'F sharp, second fret of the lowest string. One note, and it fills the last gap on that string — so E, F, F sharp, G becomes four steps with nothing missing in between. That run is the whole lesson, and both pieces are built on it.',
    newNotes: ['s6f2'],
    advice: 'Second finger, and leave the first one hovering over F. The point of this note is not the note — it is that the lowest string can now move a semitone at a time, which is what makes a line sound like it is walking instead of jumping.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s6f2'] },
      // Long rests before the reading, not after: both pieces stop dead in the
      // middle of a bar, and counting through that is a separate skill from
      // finding the note. Meeting it with no pitch to worry about first is the
      // same reason the dotted rhythm gets its own step back in lesson five.
      { kind: 'rhythm', pattern: 'sparse' },
      { kind: 'read', goal: 'streak10' },
      { kind: 'play', piece: 'the-note-between' },
      { kind: 'duet', piece: 'four-steps-and-a-door' },
    ],
  },
];
