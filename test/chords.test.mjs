import assert from 'node:assert/strict';
import {
  QUALITIES, QUALITY_ORDER, ROOTS, OPEN_SHAPES, rootPitchClass, chordPitchClasses, shapesFor,
  shapeNotes, shapePitchClasses, parseChordName, chordName, chordCatalogue, lowestFret,
} from '../js/chords.js';
import { STANDARD_TUNING, noteName } from '../js/theory.js';
import { renderChordBox } from '../js/staff.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// -------------------------------------------------------------------- names

t('roots are read, including the flats people actually write', () => {
  assert.equal(rootPitchClass('C'), 0);
  assert.equal(rootPitchClass('A'), 9);
  assert.equal(rootPitchClass('Bb'), rootPitchClass('A#'));
  assert.equal(rootPitchClass('Eb'), rootPitchClass('D#'));
  assert.equal(rootPitchClass('H'), null, 'not a note in this notation');
  assert.equal(rootPitchClass(''), null);
});

t('chord names parse, and rubbish does not', () => {
  assert.deepEqual(parseChordName('Am7'), { root: 'A', quality: 'm7' });
  assert.deepEqual(parseChordName('C'), { root: 'C', quality: '' });
  assert.deepEqual(parseChordName('F#m'), { root: 'F#', quality: 'm' });
  assert.deepEqual(parseChordName('Bbmaj7'), { root: 'Bb', quality: 'maj7' });
  assert.deepEqual(parseChordName('CM7'), { root: 'C', quality: 'maj7' }, 'the other way people write it');
  assert.equal(parseChordName('Hm'), null);
  assert.equal(parseChordName('Cxyz'), null);
  assert.equal(parseChordName(''), null);
});

t('names are spelled one way however they were typed', () => {
  assert.equal(chordName('Bb', 'm'), 'A#m');
  assert.equal(chordName('C', ''), 'C');
});

// ------------------------------------------------------------------- theory

t('a chord is the notes its name promises', () => {
  assert.deepEqual(chordPitchClasses('C', ''), [0, 4, 7]);
  assert.deepEqual(chordPitchClasses('A', 'm'), [9, 0, 4]);
  assert.deepEqual(chordPitchClasses('G', '7'), [7, 11, 2, 5]);
  assert.equal(chordPitchClasses('C', 'nonsense'), null);
});

// ------------------------------------------------------- the shapes are real
//
// The table is written by hand, so it is checked against the arithmetic rather
// than trusted. Every shape must sound exactly the notes of its chord: nothing
// missing, and nothing extra that would quietly make it a different chord.

// A guitar cannot always reach every note of a chord, and the note it drops is
// the perfect fifth - it adds no colour, so leaving it out changes nothing you
// can hear as a different chord. Dropping any OTHER note does change the chord,
// and a wrong extra note changes it too. So: nothing foreign, ever, and nothing
// missing except a plain fifth.
const PERFECT_FIFTH = 7;

function requiredTones(root, quality) {
  const pc = rootPitchClass(root);
  return QUALITIES[quality].intervals
    .filter((i) => i !== PERFECT_FIFTH)
    .map((i) => (pc + i) % 12);
}

t('no shape sounds a note that is not in its chord', () => {
  let checked = 0;
  for (const { root, quality, name } of chordCatalogue()) {
    const allowed = new Set(chordPitchClasses(root, quality));
    for (const s of shapesFor(root, quality)) {
      for (const pc of shapePitchClasses(s)) {
        assert.ok(allowed.has(pc),
          `${name} shape [${s.frets.join(',')}] sounds a ` +
          `${noteName(60 + pc).replace(/\d/, '')}, which is not in ${name}`);
      }
      checked++;
    }
  }
  assert.ok(checked > 100, `only ${checked} shapes checked - the table shrank`);
});

t('no shape drops a note that would change the chord', () => {
  for (const { root, quality, name } of chordCatalogue()) {
    const need = requiredTones(root, quality);
    for (const s of shapesFor(root, quality)) {
      const got = new Set(shapePitchClasses(s));
      for (const pc of need) {
        assert.ok(got.has(pc),
          `${name} shape [${s.frets.join(',')}] is missing its ` +
          `${noteName(60 + pc).replace(/\d/, '')}`);
      }
    }
  }
});

// Which shapes drop the fifth is worth seeing rather than discovering later.
t('the shapes that drop the fifth are the ones that traditionally do', () => {
  const dropped = [];
  for (const { root, quality, name } of chordCatalogue()) {
    const fifth = (rootPitchClass(root) + PERFECT_FIFTH) % 12;
    if (!QUALITIES[quality].intervals.includes(PERFECT_FIFTH)) continue;
    for (const s of shapesFor(root, quality)) {
      if (!shapePitchClasses(s).includes(fifth)) dropped.push(`${name} [${s.frets.join(',')}]`);
    }
  }
  // Only the open C7 voicing does this. If that list grows, someone changed the
  // table and should say so out loud.
  assert.deepEqual(dropped, ['C7 [,3,2,3,1,0]'], `shapes dropping the fifth:\n  ${dropped.join('\n  ')}`);
});

t('the lowest string you play is the root', () => {
  for (const { root, quality, name } of chordCatalogue()) {
    const pc = rootPitchClass(root);
    for (const s of shapesFor(root, quality)) {
      const notes = shapeNotes(s);
      assert.equal(notes[0] % 12, pc,
        `${name} [${s.frets.join(',')}] starts on ${noteName(notes[0])}, not the root`);
    }
  }
});

t('no shape asks for a fret a hand cannot hold', () => {
  for (const { root, quality, name } of chordCatalogue()) {
    for (const s of shapesFor(root, quality)) {
      const fretted = s.frets.filter((f) => f != null && f > 0);
      if (!fretted.length) continue;
      const span = Math.max(...fretted) - Math.min(...fretted);
      assert.ok(span <= 3, `${name} [${s.frets.join(',')}] spans ${span + 1} frets`);
    }
  }
});

t('a finger is named for every stopped string and none of the open ones', () => {
  for (const { root, quality, name } of chordCatalogue()) {
    for (const s of shapesFor(root, quality)) {
      assert.equal(s.frets.length, 6, name);
      assert.equal(s.fingers.length, 6, name);
      s.frets.forEach((f, i) => {
        const finger = s.fingers[i];
        if (f == null || f === 0) {
          assert.equal(finger, null, `${name}: string ${6 - i} is not stopped but has finger ${finger}`);
        } else {
          assert.ok(finger >= 1 && finger <= 4, `${name}: string ${6 - i} at fret ${f} has finger ${finger}`);
        }
      });
    }
  }
});

// --------------------------------------------------------------- what we get

t('the chords a beginner meets first are all open shapes', () => {
  for (const n of ['C', 'D', 'Dm', 'E', 'Em', 'G', 'A', 'Am', 'E7', 'A7', 'D7', 'G7', 'B7']) {
    const { root, quality } = parseChordName(n);
    const first = shapesFor(root, quality)[0];
    assert.ok(first, `${n} has no shape at all`);
    assert.equal(first.open, true, `${n} offers a barre before an open shape`);
  }
});

t('F and Bm exist even though they are barres', () => {
  for (const n of ['F', 'Bm', 'Fm', 'Bb']) {
    const { root, quality } = parseChordName(n);
    assert.ok(shapesFor(root, quality).length, `${n} has no shape`);
  }
});

t('easiest comes first', () => {
  const shapes = shapesFor('A', 'm');
  assert.equal(shapes[0].open, true);
  for (let i = 1; i < shapes.length; i++) {
    assert.ok(lowestFret(shapes[i]) >= lowestFret(shapes[i - 1]), 'shapes climb the neck in order');
  }
});

t('nothing is offered above the twelfth fret by default', () => {
  for (const { root, quality } of chordCatalogue()) {
    for (const s of shapesFor(root, quality)) {
      for (const f of s.frets) if (f != null) assert.ok(f <= 12, `fret ${f} is past the body`);
    }
  }
});

t('a barre sits where it puts the root under the finger', () => {
  const [barre] = shapesFor('F', '');
  assert.equal(barre.barre.fret, 1, 'F major barres at the first fret');
  assert.equal(barre.frets[0], 1, 'and the sixth string is that fret');
  const bm = shapesFor('B', 'm').find((s) => s.barre?.rootString === 5);
  assert.equal(bm.barre.fret, 2, 'Bm barres at the second fret on the A string');
});

t('an unknown chord gives nothing rather than something wrong', () => {
  assert.deepEqual(shapesFor('H', ''), []);
  assert.deepEqual(shapesFor('C', 'weird'), []);
});

// ------------------------------------------------------------- the diagram

const count = (svg, cls) => (svg.match(new RegExp(`class="${cls}"`, 'g')) || []).length;

t('an open chord shows the nut, its open strings and its muted ones', () => {
  const [am] = shapesFor('A', 'm');            // x 0 2 2 1 0
  const svg = renderChordBox(am);
  assert.equal(count(svg, 'cb-nut'), 1, 'the nut is drawn');
  assert.equal(count(svg, 'cb-open'), 2, 'A and top E ring open');
  assert.equal(count(svg, 'cb-mute'), 1, 'the low E is not played');
  assert.equal(count(svg, 'cb-dot'), 3, 'three stopped strings');
  assert.equal(count(svg, 'cb-fretnum'), 0, 'no fret number needed at the nut');
});

t('a barre is drawn as one bar, not as six dots', () => {
  const [f] = shapesFor('F', '');              // barre at 1
  const svg = renderChordBox(f);
  assert.equal(count(svg, 'cb-barre'), 1);
  // F is 1-3-3-2-1-1: three strings lie on the bar, three are stopped above it.
  assert.equal(count(svg, 'cb-dot'), 3, `got ${count(svg, 'cb-dot')} dots`);
  assert.equal(count(svg, 'cb-mute'), 0, 'every string sounds in an F barre');
});

t('a shape up the neck says which fret it starts on', () => {
  const up = shapesFor('A', 'm').find((sh) => !sh.open);
  const svg = renderChordBox(up);
  assert.equal(count(svg, 'cb-nut'), 0, 'the nut is nowhere near');
  assert.equal(count(svg, 'cb-fretnum'), 1, 'so the grid says where it is');
  assert.ok(svg.includes(`>${up.barre.fret}<`), 'and names the right fret');
});

t('every finger that presses something is printed once', () => {
  for (const name of ['C', 'Am', 'G7', 'F', 'Bm', 'Dmaj7']) {
    const { root, quality } = parseChordName(name);
    const shape = shapesFor(root, quality)[0];
    const wanted = shape.fingers.filter((f, i) => f && shape.frets[i] > 0).length;
    const drawn = count(renderChordBox(shape), 'cb-finger');
    // A barre's four strings share one finger, printed once.
    const onBarre = shape.barre
      ? shape.frets.filter((f) => f === shape.barre.fret).length - 1
      : 0;
    assert.equal(drawn, wanted - onBarre, `${name}: ${drawn} finger numbers, expected ${wanted - onBarre}`);
  }
});

t('nothing at all renders as nothing, not as a broken box', () => {
  assert.equal(renderChordBox(null), '');
  assert.equal(renderChordBox({}), '');
});

t('major comes before the seventh in the list people are shown', () => {
  // Object.keys would hoist '7' to the front because it looks like a number.
  assert.deepEqual(QUALITY_ORDER.slice(0, 3), ['', 'm', '7']);
  assert.deepEqual([...QUALITY_ORDER].sort(), Object.keys(QUALITIES).sort(),
    'the order lists every quality and invents none');
});

console.log(`chords: ${pass} groups passed`);
