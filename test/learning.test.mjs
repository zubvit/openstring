import assert from 'node:assert/strict';
import { updateStat, emptyStat, weightFor, pickNext, isFluent, poolMastery, recentForm } from '../js/srs.js';
import { Progress, MemoryStorage } from '../js/progress.js';
import { STAGES, poolFor, readyToAdvance, expectedOnsets, RHYTHMS, nextStage } from '../js/curriculum.js';
import { yForDiatonic, ledgersFor, renderNote, renderFretboard, stringWeight, LINE_GAP } from '../js/staff.js';
import { spell, writtenAt } from '../js/theory.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// ------------------------------------------------------------------ scheduling

t('a wrong answer raises priority, a fast right one lowers it', () => {
  const now = Date.now();
  let good = emptyStat(); let bad = emptyStat();
  for (let i = 0; i < 6; i++) {
    good = updateStat(good, { correct: true, ms: 900, now });
    bad = updateStat(bad, { correct: false, ms: 5000, now });
  }
  assert.ok(weightFor(bad, { now }) > weightFor(good, { now }) * 3,
    `struggling note should be far more urgent: ${weightFor(bad,{now})} vs ${weightFor(good,{now})}`);
});

t('slow but correct is not treated as learned', () => {
  const now = Date.now();
  let slow = emptyStat();
  for (let i = 0; i < 8; i++) slow = updateStat(slow, { correct: true, ms: 4500, now });
  assert.ok(slow.accuracy > 0.9, 'accuracy is high');
  assert.ok(!isFluent(slow), 'but hunting for 4.5s is not fluency');
  assert.ok(weightFor(slow, { now }) > 1.5, 'so it should keep coming up');
});

t('unseen notes outrank everything', () => {
  const now = Date.now();
  let seen = emptyStat();
  for (let i = 0; i < 3; i++) seen = updateStat(seen, { correct: false, ms: 3000, now });
  assert.ok(weightFor(undefined, { now }) > 0, 'unseen has weight');
  // An unseen note beats a merely-average one.
  let ok = emptyStat();
  for (let i = 0; i < 5; i++) ok = updateStat(ok, { correct: true, ms: 1500, now });
  assert.ok(weightFor(undefined, { now }) > weightFor(ok, { now }));
});

t('the same note never comes twice in a row', () => {
  const pool = ['s1f0', 's1f1', 's1f3'];
  for (let i = 0; i < 50; i++) {
    assert.notEqual(pickNext(pool, {}, { avoid: 's1f0' }), 's1f0');
  }
});

t('a single-note pool still returns that note', () => {
  assert.equal(pickNext(['s1f0'], {}, { avoid: 's1f0' }), 's1f0');
});

t('weak notes are drawn far more often than strong ones', () => {
  const now = Date.now();
  const stats = {};
  let strong = emptyStat(); let weak = emptyStat();
  for (let i = 0; i < 10; i++) {
    strong = updateStat(strong, { correct: true, ms: 800, now });
    weak = updateStat(weak, { correct: false, ms: 5000, now });
  }
  stats['s1f0'] = strong; stats['s1f1'] = weak;
  let weakDraws = 0;
  for (let i = 0; i < 4000; i++) if (pickNext(['s1f0', 's1f1'], stats, { now }) === 's1f1') weakDraws++;
  assert.ok(weakDraws > 2800, `weak note drawn ${weakDraws}/4000 - should dominate`);
  assert.ok(weakDraws < 4000, 'but the strong note is not abandoned entirely');
});

// ------------------------------------------------------------------ progress

t('progress survives a save and reload', () => {
  const store = new MemoryStorage();
  const p = new Progress(store);
  p.recordAnswer('s1f3', { correct: true, ms: 1200 });
  p.recordSession({ ms: 600000, asked: 20, correct: 18, stageId: 'open-top' });
  const again = new Progress(store);
  assert.equal(again.statFor('s1f3').attempts, 1);
  assert.equal(again.summary().asked, 20);
});

t('corrupt storage does not break practice', () => {
  const store = new MemoryStorage();
  store.setItem('openstring.v1', '{ not json at all');
  const p = new Progress(store);
  assert.equal(p.summary().sessions, 0, 'falls back to a blank slate');
  p.recordAnswer('s1f0', { correct: true, ms: 900 });
  assert.equal(p.statFor('s1f0').attempts, 1);
});

t('export and import round trip', () => {
  const p = new Progress(new MemoryStorage());
  p.recordAnswer('s2f1', { correct: true, ms: 1000 });
  const json = p.export();
  const q = new Progress(new MemoryStorage());
  q.import(json);
  assert.equal(q.statFor('s2f1').attempts, 1);
  assert.throws(() => q.import('{"nope":1}'), /backup/);
});

t('streak counts consecutive days, not total', () => {
  const p = new Progress(new MemoryStorage());
  const day = 86400000;
  const now = Date.now();
  p.data.sessions = [
    { date: now - 2 * day, asked: 5, correct: 5 },
    { date: now - 1 * day, asked: 5, correct: 5 },
    { date: now, asked: 5, correct: 5 },
  ];
  const s = p.streak(now);
  assert.equal(s.currentStreak, 3);
  assert.equal(s.daysPractised, 3);
});

// ------------------------------------------------------------------ curriculum

// Stage one is three notes. The point of it is that reading starts by knowing a
// very few anchors cold, not by spelling upward from the bottom line, and on a
// guitar the anchors pick themselves: three open strings land ON staff lines.
t('stage one is the three landmarks, and they are all open strings', () => {
  const pool = poolFor(STAGES[0]);
  assert.equal(STAGES[0].id, 'landmarks');
  assert.deepEqual(pool.sort(), ['s1f0', 's2f0', 's3f0'], 'the three open treble strings');
  for (const id of pool) assert.ok(id.endsWith('f0'), `${id} needs a finger`);
});

// What makes a landmark a landmark is that it is instantly placeable: inside
// the staff, no ledger lines to count. Two of the three sit on lines and the
// third in the top space - the blurb has to say which, and said "top line"
// until this test disagreed.
t('every landmark is inside the staff, with no ledger lines to count', () => {
  const BOTTOM = 100;
  const place = (string) => {
    const d = spell(writtenAt(string, 0)).diatonic;
    const gaps = (BOTTOM - yForDiatonic(d, BOTTOM)) / LINE_GAP;
    return { onLine: gaps === Math.round(gaps), gaps, ledgers: ledgersFor(d) };
  };
  for (const [string, name] of [[3, 'G'], [2, 'B'], [1, 'E']]) {
    assert.deepEqual(place(string).ledgers, [],
      `${name} needs a ledger line, so it is not an easy landmark`);
  }
  assert.equal(place(3).onLine, true, 'open G is the second line - the one the clef curls around');
  assert.equal(place(2).onLine, true, 'open B is the middle line');
  assert.equal(place(1).onLine, false, 'open high E is the TOP SPACE, not the top line');
  assert.equal(place(1).gaps, 3.5, 'half a gap above the fourth line');
});

t('the octave stage follows, and it contains the landmarks', () => {
  const pool = poolFor(STAGES[1]);
  assert.equal(STAGES[1].id, 'open-top');
  assert.equal(pool.length, 8);
  assert.ok(pool.includes('s1f0'));  // open high E
  assert.ok(pool.includes('s3f0'));  // open G
  assert.ok(!pool.includes('s4f0'), 'bottom strings are a later stage');
  for (const id of poolFor(STAGES[0])) {
    assert.ok(pool.includes(id), `${id} was a landmark and must not disappear`);
  }
});

t('advancement requires fluency across the whole region, not a lucky run', () => {
  // The eight-position octave stage: its arithmetic needs a region big enough
  // for one weak spot to be outvoted.
  const stage = STAGES[1];
  const pool = poolFor(stage);
  const stats = {};

  // Nothing attempted yet.
  assert.equal(readyToAdvance(stage, stats).ready, false);

  // Every note fast and accurate except one that is accurate but slow.
  pool.forEach((id, i) => {
    stats[id] = { attempts: 8, correct: 8, accuracy: 0.95, avgMs: i === 0 ? 3800 : 1100, lastSeen: Date.now(), streak: 8 };
  });
  const r = readyToAdvance(stage, stats);
  // 7 of 8 fluent = 0.875, above the 0.8 bar, so this should pass.
  assert.equal(r.ready, true, `expected advance, got: ${r.reason}`);

  // Half the region slow - not ready.
  pool.slice(0, 4).forEach((id) => { stats[id].avgMs = 4000; });
  assert.equal(readyToAdvance(stage, stats).ready, false);
});

// Three notes leaves nowhere to hide: with so small a region, one note you have
// not got yet is a third of it, and the stage will not let you past.
t('the landmark stage needs all three, because there are only three', () => {
  const stage = STAGES[0];
  const pool = poolFor(stage);
  const fluent = { attempts: 8, correct: 8, accuracy: 0.95, avgMs: 1100, lastSeen: Date.now(), streak: 8 };
  const stats = Object.fromEntries(pool.map((id) => [id, { ...fluent }]));
  assert.equal(readyToAdvance(stage, stats).ready, true);

  stats[pool[0]].avgMs = 4000;
  assert.equal(readyToAdvance(stage, stats).ready, false, 'one slow landmark out of three is not ready');
});

t('stages chain and then stop', () => {
  assert.equal(nextStage('open-top').id, 'open-bottom');
  assert.equal(nextStage(STAGES[STAGES.length - 1].id), null);
});

t('rhythm patterns produce sane onset times', () => {
  // Four quarter notes at 60 bpm = one per second.
  assert.deepEqual(expectedOnsets('quarters', 60), [0, 1, 2, 3]);
  // At 120 bpm, half a second each.
  assert.deepEqual(expectedOnsets('quarters', 120), [0, 0.5, 1, 1.5]);
  // A rest advances the clock but expects no note.
  const rests = expectedOnsets('with-rests', 60);
  assert.deepEqual(rests, [0, 2, 3], 'the beat-2 rest produces no expected onset');
  // Two bars follow on correctly.
  assert.deepEqual(expectedOnsets('quarters', 60, { bars: 2 }), [0, 1, 2, 3, 4, 5, 6, 7]);
});

t('every rhythm pattern fills whole bars', () => {
  for (const [id, pat] of Object.entries(RHYTHMS)) {
    const total = pat.durations.reduce((a, d) => a + Math.abs(d), 0);
    assert.equal(total % pat.meter[0], 0, `${id} does not fill its bar: ${total} beats in ${pat.meter[0]}/4`);
  }
});

t('every stage names rhythms that exist', () => {
  for (const s of STAGES) {
    for (const r of s.rhythm || []) assert.ok(RHYTHMS[r], `${s.id} refers to missing rhythm "${r}"`);
  }
});

// ------------------------------------------------------------------ notation

t('notes sit at the right height on the staff', () => {
  const bottomY = 100;
  // E4 is the bottom line.
  assert.equal(yForDiatonic(spell(64).diatonic, bottomY), 100);
  // F4, the space just above, is half a gap higher.
  assert.equal(yForDiatonic(spell(65).diatonic, bottomY), 100 - LINE_GAP / 2);
  // F5 is the top line, four gaps up.
  assert.equal(yForDiatonic(spell(77).diatonic, bottomY), 100 - 4 * LINE_GAP);
  // Enharmonics share a line: F4 and F#4 are at the same height.
  assert.equal(yForDiatonic(spell(66).diatonic, bottomY), yForDiatonic(spell(65).diatonic, bottomY));
});

t('ledger lines appear only outside the staff', () => {
  assert.deepEqual(ledgersFor(spell(64).diatonic), [], 'E4 on the bottom line needs none');
  assert.deepEqual(ledgersFor(spell(77).diatonic), [], 'F5 on the top line needs none');
  assert.equal(ledgersFor(spell(60).diatonic).length, 1, 'middle C needs one below');
  assert.equal(ledgersFor(spell(57).diatonic).length, 2, 'A3 needs two below');
  assert.equal(ledgersFor(spell(79).diatonic).length, 0, 'G5 sits in the space above the top line');
  assert.equal(ledgersFor(spell(81).diatonic).length, 1, 'A5 is the first ledger above');
  assert.equal(ledgersFor(spell(84).diatonic).length, 2, 'C6 needs two above');
});

t('stage one written pitches all fit on the staff without ledger lines', () => {
  // A nice property of open position on the top strings, and a sanity check
  // that the octave transposition is being applied.
  for (const { string, fret } of [[1,0],[1,1],[1,3],[2,0],[2,1],[2,3],[3,0],[3,2]].map(([s,f]) => ({ string: s, fret: f }))) {
    const written = writtenAt(string, fret);
    assert.deepEqual(ledgersFor(spell(written).diatonic), [], `s${string}f${fret} (${written}) should sit on the staff`);
  }
});

t('renderNote produces valid self-contained svg', () => {
  const svg = renderNote(writtenAt(1, 3), { label: 'G' });
  assert.ok(svg.startsWith('<svg'), 'is an svg');
  assert.ok(svg.includes('</svg>'));
  assert.ok(svg.includes('notehead'), 'draws a note head');
  assert.ok(!/https?:\/\//.test(svg), 'no external references');
  // Balanced tags is a decent proxy for well-formedness here.
  const open = (svg.match(/</g) || []).length;
  const close = (svg.match(/>/g) || []).length;
  assert.equal(open, close, 'tags balance');
});

// ------------------------------------------------------------- the fretboard

t('the hint shows the whole neck, not just the stage you are on', () => {
  // It used to draw only the stage's strings, so early on you saw three lines
  // floating with no idea which three. You are looking at a guitar; show one.
  const svg = renderFretboard({ mark: { string: 3, fret: 0 } });
  assert.equal((svg.match(/class="fb-string"/g) || []).length, 6);
});

t('lower strings are drawn thicker, in the ratio a real set has', () => {
  const w = [1, 2, 3, 4, 5, 6].map(stringWeight);
  for (let i = 1; i < w.length; i++) {
    assert.ok(w[i] > w[i - 1], `string ${i + 1} is not thicker than string ${i}`);
  }
  const ratio = w[5] / w[0];
  // .011 to .043 inches is about 3.9x. Anything near 1 would be invisible.
  assert.ok(ratio > 3 && ratio < 5, `sixth string is ${ratio.toFixed(1)}x the first`);
  assert.ok(w[0] >= 0.5, 'the thinnest string still has to be visible');
});

t('the drawn thickness follows the string, not the row it happens to be in', () => {
  const svg = renderFretboard({ strings: [4, 5, 6], mark: null });
  const widths = [...svg.matchAll(/class="fb-string" stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(widths, [stringWeight(4), stringWeight(5), stringWeight(6)]);
});

// ------------------------------------------------------------- recent form

// The session card used to be running totals. Two hundred notes in, sixteen
// good ones in a row could not move it, so it stopped describing the practice
// you were actually doing.
t('recent form describes the last few notes, not the whole sitting', () => {
  const bad = Array.from({ length: 200 }, () => ({ clean: false, ms: 5000 }));
  const good = Array.from({ length: 20 }, () => ({ clean: true, ms: 900 }));
  const form = recentForm([...bad, ...good], { window: 20 });
  assert.equal(form.count, 20);
  assert.equal(form.clean, 20, 'a good run shows as a good run');
  assert.equal(form.medianMs, 900);
});

t('a short session reports what there is, not a padded window', () => {
  const form = recentForm([{ clean: true, ms: 1000 }, { clean: false, ms: 3000 }], { window: 20 });
  assert.equal(form.count, 2);
  assert.equal(form.clean, 1);
});

t('nothing played reports nothing rather than zero out of twenty', () => {
  const form = recentForm([], { window: 20 });
  assert.deepEqual([form.count, form.clean, form.medianMs, form.octaveSlips], [0, 0, null, 0]);
});

// The displayed time counts fumbles too. How long a note took to find IS the
// reading speed; dropping the slow ones would flatter it.
t('the typical time includes the notes that took hunting', () => {
  const form = recentForm([
    { clean: true, ms: 500 }, { clean: false, ms: 4000 }, { clean: true, ms: 600 },
  ], { window: 20 });
  assert.equal(form.medianMs, 600, 'median of all three, not of the clean two');
});

t('octave slips are counted, because a run of them is a clue', () => {
  const form = recentForm([
    { clean: false, ms: 2000, octaves: 2 },
    { clean: true, ms: 800 },
    { clean: false, ms: 2000, octaves: 1 },
  ], { window: 20 });
  assert.equal(form.octaveSlips, 3);
});

// The ring is a different measurement and was already rolling: the per-note
// averages are exponential, so recent playing dominates without a window.
t('a position recovers from a bad patch within a handful of good answers', () => {
  let stat = emptyStat();
  for (let i = 0; i < 20; i++) stat = updateStat(stat, { correct: false, ms: 5000 });
  assert.ok(stat.accuracy < 0.1, 'thoroughly wrong');
  for (let i = 0; i < 8; i++) stat = updateStat(stat, { correct: true, ms: 900 });
  assert.ok(stat.accuracy > 0.85, `eight good answers brought it back to ${stat.accuracy.toFixed(2)}`);
  assert.ok(isFluent(stat), 'and it counts as fluent again without erasing history');
});

console.log(`learning: ${pass} groups passed`);
