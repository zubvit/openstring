import assert from 'node:assert/strict';
import {
  makeChunks, makeSeam, mergeChunks, newChunkState, applyAttempt, chunkMastered,
  pickChunk, gradeChunk, LAYERS, LADDER,
} from '../js/practice.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

const note = (measure, beat, sounding, beats = 1, extra = {}) => ({ measure, beat, sounding, beats, isRest: false, ...extra });
const rest = (measure, beat, beats = 1) => ({ measure, beat, sounding: null, beats, isRest: true });

const SEQ = [
  note(1, 0, 55), note(1, 1, 57), note(1, 2, 59), note(1, 3, 60),
  note(2, 4, 62), note(2, 5, 64), note(2, 6, 65), note(2, 7, 67),
  note(3, 8, 65), note(3, 9, 64), note(3, 10, 62), note(3, 11, 60),
];

t('chunks split by bar and keep their notes', () => {
  const c = makeChunks(SEQ, { bars: 1 });
  assert.equal(c.length, 3);
  assert.equal(c[0].notes.length, 4);
  assert.equal(c[0].firstMeasure, 1);
  assert.equal(c[2].lastMeasure, 3);
  const two = makeChunks(SEQ, { bars: 2 });
  assert.equal(two.length, 2);
  assert.equal(two[0].notes.length, 8);
});

t('a bar of nothing but rests is not a practice chunk', () => {
  const withEmpty = [...SEQ, rest(4, 12, 4)];
  const c = makeChunks(withEmpty, { bars: 1 });
  assert.equal(c.length, 3, 'the empty bar should be skipped');
});

t('a seam is narrow and spans the join', () => {
  const [a, b] = makeChunks(SEQ, { bars: 1 });
  const s = makeSeam(a, b, { notesEachSide: 2 });
  assert.equal(s.kind, 'seam');
  assert.equal(s.notes.length, 4);
  // last two of bar 1 then first two of bar 2
  assert.deepEqual(s.notes.map((n) => n.sounding), [59, 60, 62, 64]);
  assert.deepEqual(s.joins, [a.id, b.id]);
});

t('merging adjacent chunks yields the larger unit', () => {
  const [a, b] = makeChunks(SEQ, { bars: 1 });
  const m = mergeChunks(a, b);
  assert.equal(m.notes.length, 8);
  assert.equal(m.firstMeasure, 1);
  assert.equal(m.lastMeasure, 2);
});

t('the ladder climbs in fours and retreats in twos', () => {
  let s = newChunkState(50);
  s = applyAttempt(s, { passed: true, targetBpm: 100 });
  assert.equal(s.bpm, 50, 'one clean run is not enough');
  s = applyAttempt(s, { passed: true, targetBpm: 100 });
  assert.equal(s.bpm, 54, 'two clean runs move it up by 4');
  s = applyAttempt(s, { passed: false, targetBpm: 100 });
  assert.equal(s.bpm, 52, 'a failure costs 2');
  assert.equal(s.cleanRuns, 0, 'and resets the run');
});

t('the ladder never sinks below a floor', () => {
  let s = newChunkState(34);
  for (let i = 0; i < 20; i++) s = applyAttempt(s, { passed: false, targetBpm: 100 });
  assert.equal(s.bpm, LADDER.minBpm);
});

t('at target tempo the demand rises instead of the speed', () => {
  let s = newChunkState(80);
  assert.equal(s.layerIndex, 0);
  s = applyAttempt(s, { passed: true, targetBpm: 80 });
  s = applyAttempt(s, { passed: true, targetBpm: 80 });
  assert.equal(s.bpm, 80, 'tempo stays put');
  assert.equal(s.layerIndex, 1, 'the next layer is demanded');
  assert.equal(LAYERS[s.layerIndex], 'timing');
});

t('mastery needs both the tempo and the layer', () => {
  let s = newChunkState(80);
  s = applyAttempt(s, { passed: true, targetBpm: 80 });
  s = applyAttempt(s, { passed: true, targetBpm: 80 });
  assert.ok(chunkMastered(s, 80, { throughLayer: 'timing' }));
  assert.ok(!chunkMastered(s, 80, { throughLayer: 'evenness' }), 'evenness not reached yet');
  assert.ok(!chunkMastered(newChunkState(50), 80), 'slow chunk is not mastered');
});

t('unplayed chunks are chosen first, and seams get priority', () => {
  const chunks = makeChunks(SEQ, { bars: 1 });
  const states = {};
  chunks.forEach((c) => { states[c.id] = { ...newChunkState(80), attempts: 5, bestBpm: 80, layerIndex: 3, lastPlayed: Date.now() }; });
  const seam = makeSeam(chunks[0], chunks[1]);
  const all = [...chunks, seam];
  const counts = {};
  for (let i = 0; i < 2000; i++) {
    const c = pickChunk(all, states, { targetBpm: 80 });
    counts[c.kind === 'seam' ? 'seam' : c.id] = (counts[c.kind === 'seam' ? 'seam' : c.id] || 0) + 1;
  }
  // The unplayed seam should outweigh all three mastered chunks put together,
  // and be several times likelier than any one of them individually.
  const others = Object.entries(counts).filter(([k]) => k !== 'seam').map(([, v]) => v);
  assert.ok(counts.seam > 1000, `seam picked ${counts.seam}/2000, less than everything else combined`);
  assert.ok(counts.seam > Math.max(...others) * 3, `seam ${counts.seam} vs busiest chunk ${Math.max(...others)}`);
});

t('the same chunk does not come twice running', () => {
  const chunks = makeChunks(SEQ, { bars: 1 });
  for (let i = 0; i < 40; i++) {
    assert.notEqual(pickChunk(chunks, {}, { avoid: chunks[0].id }).id, chunks[0].id);
  }
});

// ------------------------------------------------------------------ grading

const play = (targets, { offsetMs = 0, loud = 0.4, jitterMs = 0, bright = 3 } = {}) =>
  targets.map((t, i) => ({
    time: t.at + offsetMs / 1000 + (i % 2 ? jitterMs : -jitterMs) / 1000,
    sounding: t.sounding,
    loudness: typeof loud === 'function' ? loud(i) : loud,
    brightness: bright,
  }));

function targetsFor(notes, bpm, startTime = 0) {
  const beat = 60 / bpm;
  const first = notes[0].beat;
  return notes.map((n) => ({ at: startTime + (n.beat - first) * beat, sounding: n.sounding }));
}

t('a clean performance passes the notes layer', () => {
  const notes = SEQ.slice(0, 4);
  const g = gradeChunk(notes, play(targetsFor(notes, 60)), { bpm: 60, layer: 'notes' });
  assert.ok(g.passed);
  assert.equal(g.results.notes.detail, 'every note correct');
});

t('a wrong note is caught and counted', () => {
  const notes = SEQ.slice(0, 4);
  const p = play(targetsFor(notes, 60));
  p[2].sounding += 1; // a semitone out
  const g = gradeChunk(notes, p, { bpm: 60, layer: 'notes' });
  assert.ok(!g.passed);
  assert.equal(g.results.notes.wrongPitch, 1);
});

t('missed and extra notes are distinguished', () => {
  const notes = SEQ.slice(0, 4);
  const p = play(targetsFor(notes, 60));
  p.splice(1, 1);                                  // missed one
  p.push({ time: 3.5, sounding: 70, loudness: 0.4 }); // and added one
  const g = gradeChunk(notes, p, { bpm: 60, layer: 'notes' });
  assert.equal(g.results.notes.missing, 1);
  assert.equal(g.results.notes.extra, 1);
});

t('right notes but late fails only once the timing layer is demanded', () => {
  const notes = SEQ.slice(0, 4);
  const late = play(targetsFor(notes, 60), { offsetMs: 90 });
  assert.ok(gradeChunk(notes, late, { bpm: 60, layer: 'notes' }).passed, 'notes layer ignores timing');
  const g = gradeChunk(notes, late, { bpm: 60, layer: 'timing' });
  assert.ok(!g.passed);
  assert.match(g.results.timing.detail, /behind the beat/);
});

t('uneven touch fails the evenness layer but not the ones below', () => {
  const notes = SEQ.slice(0, 4);
  const spiky = play(targetsFor(notes, 60), { loud: (i) => (i === 1 ? 1.2 : 0.25) });
  assert.ok(gradeChunk(notes, spiky, { bpm: 60, layer: 'timing' }).passed);
  const g = gradeChunk(notes, spiky, { bpm: 60, layer: 'evenness' });
  assert.ok(!g.passed);
  assert.match(g.results.evenness.detail, /louder/);
});

t('an even, in-time performance passes every layer that can be measured', () => {
  const notes = SEQ.slice(0, 4);
  const good = play(targetsFor(notes, 60), { offsetMs: 5, loud: 0.4 });
  const g = gradeChunk(notes, good, { bpm: 60, layer: 'evenness' });
  assert.ok(g.passed, JSON.stringify(g.results));
  assert.equal(g.results.evenness.detail, 'very even');
});

t('dynamics are only judged when the music asks for them', () => {
  const flat = SEQ.slice(0, 4);
  assert.ok(gradeChunk(flat, play(targetsFor(flat, 60)), { bpm: 60, layer: 'dynamics' }).results.dynamics.skipped);

  const shaped = flat.map((n, i) => ({ ...n, dynamic: [0.2, 0.5, 0.8, 1.0][i] }));
  const targets = targetsFor(shaped, 60).map((t, i) => ({ ...t, dynamic: shaped[i].dynamic }));
  const grew = play(targets, { loud: (i) => [0.1, 0.25, 0.45, 0.6][i] });
  const gOk = gradeChunk(shaped, grew, { bpm: 60, layer: 'dynamics' });
  assert.ok(gOk.results.dynamics.ok, 'a real crescendo should pass');

  const flatPlayed = play(targets, { loud: 0.4 });
  const gBad = gradeChunk(shaped, flatPlayed, { bpm: 60, layer: 'dynamics' });
  assert.ok(!gBad.results.dynamics.ok, 'playing it all one volume should not');
});

t('legato reports gaps when note ends are known, and stays quiet when not', () => {
  const notes = SEQ.slice(0, 4);
  const targets = targetsFor(notes, 60);
  const choppy = play(targets).map((e, i) => ({ ...e, endTime: e.time + 0.4 })); // 600ms gaps
  const g = gradeChunk(notes, choppy, { bpm: 60, layer: 'legato' });
  assert.ok(!g.results.legato.ok);
  assert.match(g.results.legato.detail, /choppy/);
  const unknown = gradeChunk(notes, play(targets), { bpm: 60, layer: 'legato' });
  assert.ok(unknown.results.legato.skipped);
});

t('grading scales with tempo rather than assuming 60', () => {
  const notes = SEQ.slice(0, 4);
  // Played correctly at 120 bpm; graded at 120 it must pass, at 60 it must not.
  const fast = play(targetsFor(notes, 120));
  assert.ok(gradeChunk(notes, fast, { bpm: 120, layer: 'timing' }).passed);
  assert.ok(!gradeChunk(notes, fast, { bpm: 60, layer: 'timing' }).passed);
});

// ------------------------------------------------- a seam that runs backwards
//
// The jump to the start of a repeated section is a real join, and the awkward
// one, but it lands on a bar EARLIER in the piece. Left alone the second half
// carries beat numbers smaller than the first, which draws the notes out of
// order and gives the drill an end time before its start.

const chunkOf = (id, notes, first, last) => ({ id, notes, firstMeasure: first, lastMeasure: last, kind: 'chunk' });
const n = (beat, sounding = 60) => ({ beat, beats: 1, sounding, written: sounding + 12, isRest: false });

t('a backward seam is re-timed so its two halves run in order', () => {
  const end = chunkOf('bars-3-3', [n(8), n(9), n(10)], 3, 3);
  const start = chunkOf('bars-1-1', [n(0), n(1), n(2)], 1, 1);
  const seam = makeSeam(end, start);
  const beats = seam.notes.map((x) => x.beat);
  for (let i = 1; i < beats.length; i++) {
    assert.ok(beats[i] > beats[i - 1], `beats go backwards: ${beats.join(' ')}`);
  }
  assert.equal(seam.backwards, true, 'and it knows which way round it is');
});

t('an ordinary forward seam keeps its real spacing', () => {
  const a = chunkOf('bars-1-1', [n(0), n(1), n(2)], 1, 1);
  // Bar two starts a beat late - a rest sits at the join, and that gap is
  // part of what the seam is meant to teach.
  const b = chunkOf('bars-2-2', [n(5), n(6)], 2, 2);
  const seam = makeSeam(a, b);
  assert.deepEqual(seam.notes.map((x) => x.beat), [0, 1, 2, 5, 6]);
  assert.equal(seam.backwards, false);
});

t('re-timing does not damage the original chunk', () => {
  const start = chunkOf('bars-1-1', [n(0), n(1)], 1, 1);
  makeSeam(chunkOf('bars-9-9', [n(40)], 9, 9), start);
  assert.deepEqual(start.notes.map((x) => x.beat), [0, 1], 'the bar itself is untouched');
});

// He asked for this in as many words: "is it possible to visually show me what
// notes I played right". The grader already knew and was reporting a sentence.
t('the grade says what happened to each note, in written order', () => {
  const notes = [
    { sounding: 55, beat: 0, beats: 1, isRest: false },
    { sounding: 59, beat: 1, beats: 1, isRest: false },
    { sounding: 64, beat: 2, beats: 1, isRest: false },
  ];
  const played = [{ time: 0, sounding: 55 }, { time: 1, sounding: 60 }];
  const g = gradeChunk(notes, played, { bpm: 60, startTime: 0, layer: 'notes' });
  assert.deepEqual(g.noteStates, ['correct', 'wrong', 'missed']);
});

t('a note never played and a note played wrong are told apart', () => {
  // Different mistakes with different fixes. Merging them would tell him to fix
  // his reading when his hand simply never got there.
  const notes = [
    { sounding: 55, beat: 0, beats: 1, isRest: false },
    { sounding: 59, beat: 1, beats: 1, isRest: false },
  ];
  const nothing = gradeChunk(notes, [], { bpm: 60, startTime: 0 });
  assert.deepEqual(nothing.noteStates, ['missed', 'missed']);
  const wrong = gradeChunk(notes, [{ time: 0, sounding: 54 }, { time: 1, sounding: 58 }],
    { bpm: 60, startTime: 0 });
  assert.deepEqual(wrong.noteStates, ['wrong', 'wrong']);
});

t('rests are not notes and do not take a colour', () => {
  const notes = [
    { sounding: 55, beat: 0, beats: 1, isRest: false },
    { sounding: null, beat: 1, beats: 1, isRest: true },
    { sounding: 59, beat: 2, beats: 1, isRest: false },
  ];
  const g = gradeChunk(notes, [{ time: 0, sounding: 55 }, { time: 2, sounding: 59 }],
    { bpm: 60, startTime: 0 });
  assert.equal(g.noteStates.length, 2, 'one state per sounded note, so the staff can index it');
  assert.deepEqual(g.noteStates, ['correct', 'correct']);
});

t('every note right is every notehead green', () => {
  const notes = [
    { sounding: 55, beat: 0, beats: 1, isRest: false },
    { sounding: 59, beat: 1, beats: 1, isRest: false },
  ];
  const g = gradeChunk(notes, [{ time: 0, sounding: 55 }, { time: 1, sounding: 59 }],
    { bpm: 60, startTime: 0 });
  assert.ok(g.noteStates.every((x) => x === 'correct'));
  assert.equal(g.results.notes.ok, true);
});

console.log(`practice: ${pass} groups passed`);
