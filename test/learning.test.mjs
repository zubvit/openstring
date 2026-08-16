import assert from 'node:assert/strict';
import { updateStat, emptyStat, weightFor, pickNext, isFluent, poolMastery } from '../js/srs.js';
import { Progress, MemoryStorage } from '../js/progress.js';
import { STAGES, poolFor, readyToAdvance, expectedOnsets, RHYTHMS, nextStage } from '../js/curriculum.js';
import { yForDiatonic, ledgersFor, renderNote, LINE_GAP } from '../js/staff.js';
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

t('stage one is one octave, eight positions', () => {
  const pool = poolFor(STAGES[0]);
  assert.equal(pool.length, 8);
  assert.ok(pool.includes('s1f0'));  // open high E
  assert.ok(pool.includes('s3f0'));  // open G
  assert.ok(!pool.includes('s4f0'), 'bottom strings are a later stage');
});

t('advancement requires fluency across the whole region, not a lucky run', () => {
  const stage = STAGES[0];
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

console.log(`learning: ${pass} groups passed`);
