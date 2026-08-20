import assert from 'node:assert/strict';
import {
  DRILL_POOL, targetFor, gradeNote, ChordAttempt, ChordProgress,
} from '../js/chord-drill.js';
import { renderChordStack } from '../js/staff.js';
import { soundingToWritten, noteName } from '../js/theory.js';
import { shapeNotes, shapesFor, parseChordName } from '../js/chords.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// ------------------------------------------------------------- the targets

t('every chord in the pool has a shape and notes to read', () => {
  for (const name of DRILL_POOL) {
    const target = targetFor(name);
    assert.ok(target, `${name} has no target`);
    assert.ok(target.sounding.length >= 3, `${name} has only ${target.sounding.length} notes`);
    // Ascending: the drill asks for the chord from the lowest string upward.
    for (let i = 1; i < target.sounding.length; i++) {
      assert.ok(target.sounding[i] > target.sounding[i - 1],
        `${name} is not in rising order: ${target.sounding.join(',')}`);
    }
  }
});

// The bug this app has to keep dodging, again: guitar sounds an octave below
// what is written. A chord read off the staff must be written an octave up
// from what the strings actually sound, or every chord is taught wrong.
t('what is written is an octave above what the strings sound', () => {
  const am = targetFor('Am');
  assert.deepEqual(am.written, am.sounding.map((m) => m + 12));
  assert.equal(noteName(am.sounding[0]), 'A2', 'the open A string sounds A2');
  assert.equal(noteName(am.written[0]), 'A3', 'and is written A3');
});

t('the drill pool is open shapes only - a barre teaches nothing about reading', () => {
  for (const name of DRILL_POOL) {
    assert.equal(targetFor(name).shape.open, true, `${name} is a barre`);
  }
});

t('an unknown chord gives no target rather than a broken one', () => {
  assert.equal(targetFor('Hm'), null);
  assert.equal(targetFor('Cdim7'), null, 'we can name it but have no shape');
});

// ------------------------------------------------------------- one attempt

t('playing the chord upward, correctly, finishes it', () => {
  const target = targetFor('Em');
  const a = new ChordAttempt(target);
  target.sounding.forEach((m, i) => {
    const r = a.play(m);
    assert.equal(r.verdict, 'right');
    assert.equal(r.done, i === target.sounding.length - 1);
  });
  assert.equal(a.clean, true);
  assert.equal(a.errors, 0);
});

t('a wrong note does not let you move on', () => {
  const target = targetFor('C');
  const a = new ChordAttempt(target);
  a.play(target.sounding[0]);
  const bad = a.play(target.sounding[0] + 1);
  assert.equal(bad.verdict, 'wrong');
  assert.equal(bad.index, 1, 'still waiting for the same note');
  assert.equal(a.errors, 1);
  assert.equal(a.clean, false);
  assert.equal(a.play(target.sounding[1]).index, 2, 'and it moves on once it is right');
});

t('the right note on the wrong string is called what it is', () => {
  const target = targetFor('Am');
  const a = new ChordAttempt(target);
  assert.equal(a.play(target.sounding[0] + 12).verdict, 'octave');
  assert.equal(a.play(target.sounding[0] - 12).verdict, 'octave');
  assert.equal(a.play(target.sounding[0] + 1).verdict, 'wrong');
});

t('silence is a wrong note, not a crash', () => {
  const a = new ChordAttempt(targetFor('G'));
  assert.equal(a.play(null).verdict, 'wrong');
});

t('a finished chord stays finished', () => {
  const target = targetFor('Em7');
  const a = new ChordAttempt(target);
  target.sounding.forEach((m) => a.play(m));
  assert.equal(a.done, true);
  assert.equal(a.play(0).done, true, 'more notes cannot un-finish it');
});

t('noteheads are marked as you go', () => {
  const target = targetFor('D');
  const a = new ChordAttempt(target);
  a.play(target.sounding[0]);
  a.play(target.sounding[1] + 3);
  assert.deepEqual(a.states, { 0: 'correct', 1: 'wrong' });
});

t('grading a note on its own', () => {
  assert.equal(gradeNote(60, 60), 'right');
  assert.equal(gradeNote(60, 72), 'octave');
  assert.equal(gradeNote(60, 48), 'octave');
  assert.equal(gradeNote(60, 61), 'wrong');
});

// ------------------------------------------------------------- scheduling

function memoryStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
}

t('chord practice is scheduled without touching the note statistics', () => {
  const store = memoryStore();
  const p = new ChordProgress(store);
  p.record('Am', { correct: true, ms: 3000 });
  // Only the chord store is written to; nothing here knows about positions.
  assert.deepEqual([...Object.keys(p.stats)], ['Am']);
  const reloaded = new ChordProgress(store);
  assert.equal(reloaded.stats.Am.attempts, 1);
});

t('the next chord is drawn from the pool and is not the one just done', () => {
  const p = new ChordProgress(memoryStore());
  for (let i = 0; i < 50; i++) {
    const n = p.next({ avoid: 'Am' });
    assert.ok(DRILL_POOL.includes(n));
    assert.notEqual(n, 'Am');
  }
});

t('chords you keep getting right stop coming up as often', () => {
  const p = new ChordProgress(memoryStore());
  for (let i = 0; i < 12; i++) p.record('Em', { correct: true, ms: 1200 });
  for (let i = 0; i < 12; i++) p.record('G', { correct: false, ms: 9000 });
  let em = 0, g = 0;
  for (let i = 0; i < 600; i++) {
    const n = p.next({ pool: ['Em', 'G'] });
    if (n === 'Em') em++; else g++;
  }
  assert.ok(g > em, `the weak chord came up ${g} times, the fluent one ${em}`);
});

t('fluency is counted, and starts at nothing', () => {
  const p = new ChordProgress(memoryStore());
  assert.equal(p.fluentCount(), 0);
  for (let i = 0; i < 12; i++) p.record('Em', { correct: true, ms: 1000 });
  assert.equal(p.fluentCount(), 1);
  p.reset();
  assert.equal(p.fluentCount(), 0);
});

t('a browser with storage switched off still runs the drill', () => {
  const angry = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  const p = new ChordProgress(angry);
  p.record('Am', { correct: true, ms: 1000 });
  assert.ok(p.next());
});

// ---------------------------------------------------------- what is drawn

const count = (svg, cls) => (svg.match(new RegExp(cls, 'g')) || []).length;

t('a chord is drawn as a stack of noteheads on one stem', () => {
  const target = targetFor('C');            // five notes
  const svg = renderChordStack(target.written);
  assert.equal(count(svg, 'notehead'), 5);
  assert.equal(count(svg, 'class="stem"'), 1, 'one stem for the whole chord');
  assert.equal(count(svg, 'class="staff-line"') >= 5, true);
});

t('notes a second apart are moved aside instead of overlapping', () => {
  // Dsus2 is D A B E: the A and the B are neighbours on the staff.
  const target = targetFor('Dsus2') || { written: shapeNotes(shapesFor('D', 'sus2')[0]).map(soundingToWritten) };
  const svg = renderChordStack(target.written);
  const xs = [...svg.matchAll(/<ellipse cx="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(new Set(xs).size, 2, `heads sit at ${new Set(xs).size} x positions, expected two`);
});

t('a chord with no seconds keeps every head in one column', () => {
  const svg = renderChordStack(targetFor('Em').written);
  const xs = [...svg.matchAll(/<ellipse cx="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(new Set(xs).size, 1);
});

t('each note shows its progress state', () => {
  const target = targetFor('Am');
  const svg = renderChordStack(target.written, { states: { 0: 'correct', 1: 'wrong' } });
  assert.equal(count(svg, 'notehead correct'), 1);
  assert.equal(count(svg, 'notehead wrong'), 1);
});

t('an empty chord falls back to an empty staff rather than nothing', () => {
  const svg = renderChordStack([]);
  assert.ok(svg.includes('<svg'), 'still draws a staff');
  assert.equal(count(svg, 'notehead'), 0);
});

t('the stem stays inside the picture, however wide the chord', () => {
  for (const name of DRILL_POOL) {
    const svg = renderChordStack(targetFor(name).written, { width: 260 });
    const h = Number(/viewBox="0 0 \d+ ([\d.]+)"/.exec(svg)[1]);
    for (const m of svg.matchAll(/<line x1="[\d.]+" y1="([\d.-]+)" x2="[\d.]+" y2="([\d.-]+)" class="stem"/g)) {
      const [y1, y2] = [Number(m[1]), Number(m[2])];
      assert.ok(Math.min(y1, y2) >= 0 && Math.max(y1, y2) <= h,
        `${name}: stem runs from ${y1} to ${y2} on a canvas ${h} tall`);
    }
  }
});

t('a wide chord does not get a single note\'s long stem', () => {
  // C open spans two octaves; Dsus2 is compact. The wide one must not be given
  // the extra three and a half spaces on top of its own spread.
  const stemLen = (name) => {
    const svg = renderChordStack(targetFor(name).written);
    const m = /<line x1="[\d.]+" y1="([\d.-]+)" x2="[\d.]+" y2="([\d.-]+)" class="stem"/.exec(svg);
    return Math.abs(Number(m[1]) - Number(m[2]));
  };
  assert.ok(stemLen('C') < 120, `the widest chord's stem is ${stemLen('C')}px`);
});

console.log(`chord-drill: ${pass} groups passed`);
