// The lessons, in order.
//
// A stage is a region of the neck; a lesson is a sitting. The two are not the
// same size and pretending they were is what went wrong: the stage ladder said
// "now the second string" and the app turned that into one undifferentiated
// slab of practice with no beginning, no end and no music in it.
//
// Every lesson here has the same shape, and it is the shape of a real lesson:
//
//   warm up on what you already know  ->  meet the new note by itself
//   ->  read them all mixed together  ->  play a piece  ->  play a duet
//
// The warm-up is not filler. Mixing old material in with new feels worse and
// works better - practising a new thing among old ones is the single most
// replicated result in the practice literature - and without it a note learned
// in lesson two is never seen again.
//
// The duet is the point of the lesson, not its dessert. It is last because it
// needs the notes, not because it matters least.

export const LESSONS = [
  {
    id: 'l1',
    n: 1,
    stage: 'landmarks',
    title: 'Three open strings',
    blurb: 'Three notes, and not one of them needs a finger. Get these three and every other note on the guitar can be found by stepping from the nearest one.',
    newNotes: ['s1f0', 's2f0', 's3f0'],
    advice: 'Say the name out loud as you play it. Out loud matters — it makes the name and the place arrive together instead of one after the other.',
    steps: [
      { kind: 'learn', positions: ['s3f0', 's2f0', 's1f0'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'bell-tower' },
      { kind: 'duet', piece: 'evening-round' },
    ],
  },
  {
    id: 'l2',
    n: 2,
    stage: 'string-3',
    title: 'A, on the third string',
    blurb: 'One new note — second fret of the third string. One is not a small ambition: it is what a method book gives you after the open strings, and four notes is already enough for a tune everybody knows.',
    newNotes: ['s3f2'],
    advice: 'Keep the finger down and close behind the fret. If the note buzzes it is almost always the finger sitting on the fret wire rather than behind it.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s3f2'] },
      { kind: 'read', goal: 'streak10' },
      { kind: 'duet', piece: 'hot-cross-buns' },
      { kind: 'play', piece: 'stepping-stones' },
    ],
  },
  {
    id: 'l3',
    n: 3,
    stage: 'strings-23',
    title: 'C and D, on the second string',
    blurb: 'Two new notes, and the set becomes six — a full hexachord. An astonishing amount of the world’s folk music lives inside six notes, and four of the pieces here are proof.',
    newNotes: ['s2f1', 's2f3'],
    advice: 'C is the first fret and D is the third, both on the B string. Use the first finger for C and the third for D and your hand never has to move.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s2f1', 's2f3'] },
      { kind: 'read', goal: 'streak20' },
      { kind: 'duet', piece: 'merrily-we-roll-along' },
      { kind: 'duet', piece: 'ode-to-joy' },
      { kind: 'duet', piece: 'au-clair-de-la-lune' },
      { kind: 'duet', piece: 'frere-jacques' },
    ],
  },
  {
    id: 'l4',
    n: 4,
    stage: 'open-top',
    title: 'F and G, on the first string',
    blurb: 'The octave closes: G at the bottom, G at the top, and nothing missing in between. From here a tune can go anywhere on the top three strings.',
    newNotes: ['s1f1', 's1f3'],
    advice: 'F is the first fret of the high E string and it is the note most often played by accident — check you are on the first string and not the second.',
    steps: [
      { kind: 'warmup', goal: 'notes20' },
      { kind: 'learn', positions: ['s1f1', 's1f3'] },
      { kind: 'read', goal: 'streak20' },
      { kind: 'duet', piece: 'lightly-row' },
    ],
  },
];
