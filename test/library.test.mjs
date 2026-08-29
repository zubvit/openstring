import assert from 'node:assert/strict';
import { PIECES, pieceSpec, piecesForLesson } from '../js/library.js';
import { LESSONS } from '../js/course.js';
import { compileTune, compileAccompaniment, pitchesUsed, positionsUsed } from '../js/tune.js';
import { notesFor, stageById } from '../js/curriculum.js';
import { positionId, noteName } from '../js/theory.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// This suite exists because of one sentence: "it is not incremental, does not
// build on top of those 3." A piece whose melody strays one note outside the
// lesson that offers it recreates exactly that - and it does it quietly, because
// the app will happily draw a note he has never been shown and then mark him
// wrong for not finding it. So every note of every tune is checked here.

const lessonOf = (n) => LESSONS.find((l) => l.n === n);
const taught = (lesson) => notesFor(stageById(lesson.stage));
const allowed = (lesson) =>
  new Set(taught(lesson).map((n) => positionId(n.string, n.fret)));

t('every piece belongs to a lesson that exists', () => {
  for (const p of PIECES) {
    assert.ok(lessonOf(p.lesson), `${p.id} claims lesson ${p.lesson}, which is not in the course`);
  }
});

t('every piece compiles, so no bar is a beat out', () => {
  for (const p of PIECES) {
    assert.doesNotThrow(() => compileTune({ ...p, taught: region(p) }), `${p.id} melody`);
    assert.doesNotThrow(() => compileAccompaniment(p), `${p.id} accompaniment`);
  }
});

function region(p) {
  return taught(lessonOf(p.lesson));
}

t('NO melody asks for a note its lesson has not taught', () => {
  const strays = [];
  for (const p of PIECES) {
    const lesson = lessonOf(p.lesson);
    const ok = allowed(lesson);
    for (const id of positionsUsed({ ...p, taught: region(p) })) {
      if (!ok.has(id)) strays.push(`${p.id} (lesson ${p.lesson}) uses ${id}`);
    }
  }
  assert.deepEqual(strays, [], `these pieces reach outside their lesson:\n${strays.join('\n')}`);
});

t('a melody is fingered where the lesson has been, not wherever is lowest', () => {
  // Same pitch, different string, is a different lesson. Fingering a lesson-two
  // tune at the fifth fret would be right about the pitch and wrong about
  // everything the lesson is for.
  for (const p of PIECES) {
    const ok = allowed(lessonOf(p.lesson));
    for (const id of positionsUsed({ ...p, taught: region(p) })) {
      assert.ok(ok.has(id), `${p.id} fingers ${id}, which lesson ${p.lesson} has not taught`);
    }
  }
});

t('the accompaniment is allowed anywhere, because he never plays it', () => {
  // Deliberately the opposite rule to the melody. If the app's own part were
  // held to the lesson's notes there could be no bass under three open strings,
  // and the first lessons would have no music in them at all.
  const wide = PIECES.filter((p) => p.accomp)
    .filter((p) => compileAccompaniment(p).some((e) => e.sounding < 55));
  assert.ok(wide.length > 0, 'no accompaniment goes below the top three strings');
});

t('every piece says where it came from, because this repo is public', () => {
  for (const p of PIECES) {
    assert.ok(p.source, `${p.id} has no source`);
    const ok = p.source === 'trad' || p.source === 'original'
      || /^public-domain: .+, d\.\d{4}$/.test(p.source);
    assert.ok(ok, `${p.id} has an unusable source line: ${p.source}`);
    if (p.source.startsWith('public-domain:')) {
      const died = Number(p.source.match(/d\.(\d{4})/)[1]);
      assert.ok(died < 1900, `${p.id}: ${died} is not safely out of copyright`);
    }
  }
});

t('ids are unique and findable', () => {
  const ids = PIECES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate piece id');
  for (const id of ids) assert.equal(pieceSpec(id).id, id);
  assert.equal(pieceSpec('no-such-piece'), null);
});

t('every piece a lesson names actually exists', () => {
  for (const l of LESSONS) {
    for (const step of l.steps || []) {
      if (!step.piece) continue;
      assert.ok(pieceSpec(step.piece), `${l.id} names a missing piece: ${step.piece}`);
      assert.equal(pieceSpec(step.piece).lesson, l.n,
        `${l.id} uses ${step.piece}, which belongs to lesson ${pieceSpec(step.piece).lesson}`);
    }
  }
});

t('every lesson ends in music, and at least one of them is a duet', () => {
  for (const l of LESSONS) {
    const mine = piecesForLesson(l.n);
    assert.ok(mine.length >= 1, `lesson ${l.n} has no music at all`);
    assert.ok(mine.some((p) => p.kind === 'duet'),
      `lesson ${l.n} has no duet - the app never plays with him`);
    const kinds = (l.steps || []).map((s) => s.kind);
    assert.ok(['play', 'duet', 'ear'].some((k) => kinds.includes(k)),
      `lesson ${l.n} never sends him to a piece`);
    assert.ok(['play', 'duet', 'ear'].includes(kinds[kinds.length - 1]),
      `lesson ${l.n} does not END in music`);
  }
});

t('a duet has a part for the app to play', () => {
  for (const p of PIECES) {
    if (p.kind !== 'duet') continue;
    assert.ok(p.accomp, `${p.id} is called a duet but the app has nothing to play`);
    assert.ok(compileAccompaniment(p).length > 0, `${p.id} accompaniment is empty`);
  }
});

t('the melody and the app\'s part are the same length in bars, near enough', () => {
  // A round is deliberately short at the end - the app comes in late and stops
  // late - but an accompaniment that runs out halfway is a mistake.
  for (const p of PIECES) {
    if (!p.accomp) continue;
    const mel = compileTune({ ...p, taught: region(p) }).measures.length;
    const acc = compileTune({ ...p, melody: p.accomp, taught: region(p) }).measures.length;
    assert.ok(Math.abs(mel - acc) <= 2,
      `${p.id}: melody is ${mel} bars, accompaniment is ${acc}`);
  }
});

t('the first lessons are short enough to finish in a sitting', () => {
  for (const p of PIECES.filter((x) => x.lesson <= 2)) {
    const bars = compileTune({ ...p, taught: region(p) }).measures.length;
    assert.ok(bars <= 8, `${p.id} is ${bars} bars, which is a lot for lesson ${p.lesson}`);
  }
});

t('the music grows with the course rather than all arriving at once', () => {
  const byLesson = LESSONS.map((l) => piecesForLesson(l.n).length);
  assert.ok(byLesson.every((n) => n >= 1), `a lesson has no music: ${byLesson}`);
  // Named tunes cannot appear until enough notes exist for one; nothing before
  // that should be pretending otherwise.
  const l1 = piecesForLesson(1);
  assert.ok(l1.every((p) => p.source === 'original'),
    'lesson one claims a traditional tune, but three notes cannot make one');
});

console.log(`library: ${pass} ok`);
