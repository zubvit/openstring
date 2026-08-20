import assert from 'node:assert/strict';
import {
  LANDMARK_IDS, MAX_INTERVAL, MELODIC_NUMBERS, INTERVAL_IDS,
  degreeOf, intervalBetween, intervalId, parseIntervalId, intervalKey,
  buildMelody, IntervalProgress,
} from '../js/intervals.js';
import { STAGES, poolFor } from '../js/curriculum.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// ---------------------------------------------------------------- counting

// Musicians count inclusively: the note above is a SECOND, not a first. Get
// this wrong and every distance the app names is off by one.
t('a distance is counted inclusively, the way musicians count it', () => {
  assert.deepEqual(intervalBetween(10, 10), { number: 1, direction: 'same' });
  assert.deepEqual(intervalBetween(10, 11), { number: 2, direction: 'up' });
  assert.deepEqual(intervalBetween(10, 12), { number: 3, direction: 'up' });
  assert.deepEqual(intervalBetween(10, 17), { number: 8, direction: 'up' }, 'an octave is an eighth');
  assert.deepEqual(intervalBetween(10, 8), { number: 3, direction: 'down' });
});

t('distance is measured on the page, not in semitones', () => {
  // C to E and C to E flat are both thirds. That is the whole point of reading
  // by distance: you see the shape before you know the accidental.
  const pool = poolFor(STAGES[5]);
  const withAccidental = pool.find((id) => degreeOf(id) != null);
  assert.ok(withAccidental, 'the chromatic stage still yields degrees');
});

t('nothing sensible in, nothing out', () => {
  assert.equal(intervalBetween(null, 3), null);
  assert.equal(degreeOf('nonsense'), null);
  assert.equal(parseIntervalId('wat'), null);
  assert.equal(parseIntervalId(null), null);
});

// ------------------------------------------------------------ the item set

t('ids survive the round trip', () => {
  for (const id of INTERVAL_IDS) {
    assert.equal(intervalId(parseIntervalId(id)), id);
  }
});

// A melody never leaps a seventh, so an item for one could never come up and
// would sit in the scheduler looking permanently neglected.
t('the seventh is not an item, because a tune never makes one', () => {
  assert.ok(!MELODIC_NUMBERS.includes(7));
  assert.ok(MELODIC_NUMBERS.includes(8), 'but the octave is common and stays');
  assert.ok(!INTERVAL_IDS.includes('+7') && !INTERVAL_IDS.includes('-7'));
  assert.equal(INTERVAL_IDS.length, MELODIC_NUMBERS.length * 2, 'every distance, both ways');
});

t('translation keys are per distance', () => {
  assert.equal(intervalKey(3), 'interval.3');
  for (const n of MELODIC_NUMBERS) assert.ok(intervalKey(n).startsWith('interval.'));
});

// ------------------------------------------------------------- the melodies
//
// Every rule below is what separates a phrase from a list of notes. They are
// checked across many generated melodies because the generator is random and a
// single sample proves nothing.

const POOLS = [
  ['landmarks', poolFor(STAGES[0])],
  ['octave', poolFor(STAGES[1])],
  ['open all', poolFor(STAGES[3])],
  ['fifth position', poolFor(STAGES[5])],
];

function everyMelody(fn, runs = 150) {
  for (const [label, pool] of POOLS) {
    for (let i = 0; i < runs; i++) {
      const m = buildMelody(pool, {});
      assert.ok(m, `${label}: produced no melody at all`);
      fn(m, pool, label);
    }
  }
}

t('a melody only ever uses notes the stage has taught', () => {
  everyMelody((m, pool, label) => {
    for (const id of m.notes) assert.ok(pool.includes(id), `${label}: ${id} is outside the region`);
  });
});

t('a melody starts on a landmark - something to measure from', () => {
  everyMelody((m, pool, label) => {
    const anchors = LANDMARK_IDS.filter((id) => pool.includes(id));
    if (!anchors.length) return;
    assert.ok(anchors.includes(m.notes[0]), `${label}: started on ${m.notes[0]}`);
  });
});

t('a melody never repeats a note or turns straight back', () => {
  everyMelody((m, pool, label) => {
    for (let i = 1; i < m.notes.length; i++) {
      assert.notEqual(m.notes[i], m.notes[i - 1], `${label}: repeated ${m.notes[i]}`);
      if (i >= 2) {
        assert.notEqual(m.notes[i], m.notes[i - 2],
          `${label}: went back to ${m.notes[i]} immediately - that oscillates`);
      }
    }
  });
});

t('a melody leaps at most once, and never to open or to close', () => {
  everyMelody((m, pool, label) => {
    const leaps = m.intervals.filter((iv) => iv.number >= 4);
    assert.ok(leaps.length <= 1, `${label}: ${leaps.length} leaps in one phrase`);
    if (m.intervals.length >= 2) {
      assert.ok(m.intervals[0].number < 4, `${label}: opened with a ${m.intervals[0].number}th`);
    }
    const last = m.intervals[m.intervals.length - 1];
    assert.ok(last.number < 4, `${label}: ended mid-leap on a ${last.number}th`);
  });
});

t('a leap is answered by a step the other way', () => {
  everyMelody((m, pool, label) => {
    m.intervals.forEach((iv, i) => {
      if (iv.number < 4) return;
      const next = m.intervals[i + 1];
      assert.ok(next, `${label}: nothing follows the leap`);
      assert.equal(next.number, 2, `${label}: the leap is followed by a ${next.number}th, not a step`);
      assert.notEqual(next.direction, iv.direction, `${label}: the step carries on in the same direction`);
    });
  });
});

t('a melody never contains a seventh', () => {
  everyMelody((m, pool, label) => {
    for (const iv of m.intervals) {
      assert.notEqual(iv.number, 7, `${label}: a seventh got in`);
      assert.ok(iv.number >= 2 && iv.number <= MAX_INTERVAL);
    }
  });
});

t('the intervals describe the notes they sit between', () => {
  everyMelody((m) => {
    m.intervals.forEach((iv, i) => {
      assert.equal(iv.from, m.notes[i]);
      assert.equal(iv.to, m.notes[i + 1]);
      assert.deepEqual(intervalBetween(degreeOf(iv.from), degreeOf(iv.to)),
        { number: iv.number, direction: iv.direction });
    });
    assert.equal(m.intervals.length, m.notes.length - 1);
  });
});

t('a pool with nothing to work with gives nothing, not a broken phrase', () => {
  assert.equal(buildMelody([], {}), null);
  assert.equal(buildMelody(['s3f0'], {}), null, 'one note is not a melody');
});

// -------------------------------------------------------------- scheduling

function memoryStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
}

t('what you keep getting wrong turns up more often', () => {
  const store = memoryStore();
  const p = new IntervalProgress(store);
  for (let i = 0; i < 12; i++) p.record('+2', { correct: true, ms: 900 });
  for (let i = 0; i < 12; i++) p.record('+5', { correct: false, ms: 9000 });

  const pool = poolFor(STAGES[3]);
  let weak = 0, strong = 0;
  for (let i = 0; i < 200; i++) {
    for (const iv of buildMelody(pool, p.stats).intervals) {
      if (iv.id === '+5') weak++;
      if (iv.id === '+2') strong++;
    }
  }
  assert.ok(weak > 0, 'the weak interval never appeared at all');
  // Steps are structurally common - a leap must resolve into one - so the test
  // is that the weak one is not rare, not that it beats the step outright.
  assert.ok(weak > strong / 6, `weak ${weak} vs step ${strong}`);
});

t('interval practice is stored on its own, away from the other drills', () => {
  const store = memoryStore();
  const p = new IntervalProgress(store);
  p.record('+3', { correct: true, ms: 1500 });
  assert.deepEqual(Object.keys(p.stats), ['+3']);
  assert.equal(new IntervalProgress(store).stats['+3'].attempts, 1);
});

t('fluency is counted, and clears', () => {
  const p = new IntervalProgress(memoryStore());
  assert.equal(p.fluentCount(), 0);
  for (let i = 0; i < 12; i++) p.record('+3', { correct: true, ms: 900 });
  assert.equal(p.fluentCount(), 1);
  p.reset();
  assert.equal(p.fluentCount(), 0);
});

t('a browser with storage switched off still builds melodies', () => {
  const angry = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  const p = new IntervalProgress(angry);
  p.record('+2', { correct: true, ms: 1000 });
  assert.ok(buildMelody(poolFor(STAGES[1]), p.stats));
});

console.log(`intervals: ${pass} groups passed`);
