import assert from 'node:assert/strict';
import {
  pitchToMidi, parseTune, fingerNote, compileTune, compileAccompaniment,
  pitchesUsed, positionsUsed,
} from '../js/tune.js';
import { notesInRegion } from '../js/theory.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// The notation exists so the pieces can be read and checked by eye. Everything
// here is about it failing LOUDLY when it is wrong, because a tune with a bar
// half a beat short still plays - it just puts every note after it at the wrong
// moment and then the grader blames the player for it.

t('a pitch name becomes sounding midi', () => {
  assert.equal(pitchToMidi('E4'), 64);   // open first string
  assert.equal(pitchToMidi('B3'), 59);
  assert.equal(pitchToMidi('G3'), 55);
  assert.equal(pitchToMidi('E2'), 40);   // open sixth
  assert.equal(pitchToMidi('F#4'), 66);
  assert.equal(pitchToMidi('Bb3'), 58);
});

t('a pitch it cannot read is an error, not a silent zero', () => {
  assert.throws(() => pitchToMidi('H4'));
  assert.throws(() => pitchToMidi('E'));
  assert.throws(() => pitchToMidi(''));
});

t('a bar that does not add up is refused', () => {
  assert.throws(() => parseTune('E4/1 E4/1', { name: 'short' }), /bar 2 is|bar 1 is/);
  assert.throws(() => parseTune('E4/4 | E4/1 E4/1 E4/1', { name: 'short' }), /bar 2 is 3 beats/);
  assert.throws(() => parseTune('E4/4 | E4/4 E4/1', { name: 'long' }), /bar 2 is 5 beats/);
});

t('a short FIRST bar is a pickup and is allowed', () => {
  const bars = parseTune('E4/1 | E4/4 | E4/4');
  assert.equal(bars.length, 3);
  assert.equal(bars[0].pickup, true);
  assert.equal(bars[0].lengthBeats, 1, 'the timeline moves by what the bar holds, not a whole bar');
  assert.equal(bars[1].pickup, false);
});

t('the meter decides how long a bar is, not a hardcoded four', () => {
  assert.doesNotThrow(() => parseTune('E4/3', { beatsPerBar: 3, beatUnit: 4 }));
  assert.throws(() => parseTune('E4/4', { beatsPerBar: 3, beatUnit: 4 }));
  // 6/8 is six eighths, which is three QUARTER-note beats.
  assert.doesNotThrow(() => parseTune('E4/0.5 E4/0.5 E4/0.5 E4/0.5 E4/0.5 E4/0.5',
    { beatsPerBar: 6, beatUnit: 8 }));
});

t('a rest takes up time and asks for no note', () => {
  const [bar] = parseTune('r/2 E4/2');
  assert.equal(bar.notes.length, 2);
  assert.equal(bar.notes[0].isRest, true);
  assert.equal(bar.notes[0].sounding, null);
  assert.equal(bar.notes[1].startBeat, 2, 'the rest moved the clock');
});

t('a tie has to have something to tie into', () => {
  assert.doesNotThrow(() => parseTune('E4/2~ E4/2'));
  assert.doesNotThrow(() => parseTune('E4/2 E4/2~ | E4/4'), 'across a barline too');
  assert.throws(() => parseTune('E4/2~ B3/2'), /tie/, 'a different pitch is not a tie');
  assert.throws(() => parseTune('E4/2 E4/2~'), /tie/, 'nothing after it at all');
});

t('the far side of a tie is marked, so the grader holds instead of striking again', () => {
  const [bar] = parseTune('E4/2~ E4/2');
  assert.equal(bar.notes[0].tieStart, true);
  assert.equal(bar.notes[1].tieStop, true);
});

t('written pitch is an octave above sounding, everywhere', () => {
  const [bar] = parseTune('E4/4');
  assert.equal(bar.notes[0].sounding, 64);
  assert.equal(bar.notes[0].written, 76, 'guitar music is written an octave up');
});

// A tune belonging to the third lesson has to be fingered inside the third
// lesson's strings, or the fretboard picture sends him somewhere he has not been
// taught yet - which is the exact failure this whole course was rebuilt to stop.
t('a note is fingered only where the lesson has been', () => {
  const taught = notesInRegion({ strings: [1, 2, 3], minFret: 0, maxFret: 3 });
  assert.deepEqual(fingerNote(64, taught), { string: 1, fret: 0 }, 'E4 is the open first string');
  assert.deepEqual(fingerNote(60, taught), { string: 2, fret: 1 }, 'C4 is first fret, second string');
  // The same pitch is also the second string at the fifth fret. Given only that
  // string, that is where it must go - being right about the pitch is not enough.
  const secondOnly = notesInRegion({ strings: [2], minFret: 0, maxFret: 12, naturalsOnly: false });
  assert.deepEqual(fingerNote(64, secondOnly), { string: 2, fret: 5 });
});

t('the taught set is a LIST, so it can have holes a rectangle cannot', () => {
  // The real case: by lesson three he knows the second and third strings AND
  // the open first string from lesson one - and no min/max fret describes that.
  const patchy = [
    ...notesInRegion({ strings: [2, 3], minFret: 0, maxFret: 3 }),
    ...notesInRegion({ strings: [1], minFret: 0, maxFret: 0 }),
  ];
  assert.deepEqual(fingerNote(64, patchy), { string: 1, fret: 0 }, 'the open first string is his');
  assert.deepEqual(fingerNote(65, patchy), { string: 1, fret: 1 },
    'F is not in the taught set at all, so it falls back rather than vanishing');
});

t('a pitch nobody has been taught still compiles, rather than vanishing', () => {
  const taught = notesInRegion({ strings: [1, 2, 3], minFret: 0, maxFret: 3 });
  const got = fingerNote(40, taught);
  assert.equal(got.string, 6, 'fell back to the whole neck');
  assert.equal(got.fret, 0);
});

t('a compiled tune is the same shape the MusicXML importer produces', () => {
  const piece = compileTune({
    id: 'x', title: 'X', meter: [4, 4], bpm: 70,
    taught: notesInRegion({ strings: [1, 2, 3], minFret: 0, maxFret: 3 }),
    melody: 'B3/1 A3/1 G3/2 | B3/4',
  });
  assert.equal(piece.title, 'X');
  assert.equal(piece.measures.length, 2);
  assert.equal(piece.noteCount, 4);
  assert.equal(piece.measures[0].lengthBeats, 4);
  assert.equal(piece.measures[0].number, 1);
  assert.equal(piece.measures[1].number, 2);
  // Downstream everything derives written from sounding; a built-in has nothing
  // to guess about, so it must not claim the octave was assumed.
  assert.equal(piece.octaveConvention.basis, 'sounding');
  assert.equal(piece.octaveConvention.shift, 0);
  for (const m of piece.measures) for (const n of m.notes) assert.equal(n.isChord, false);
});

t('the accompaniment is flat events on the piece timeline, not a second piece', () => {
  const evs = compileAccompaniment({
    id: 'x', meter: [4, 4], melody: 'B3/4 | B3/4', accomp: 'G2/2 D3/2 | r/2 G2/2',
  });
  assert.deepEqual(evs.map((e) => [e.sounding, e.beat, e.beats]), [
    [43, 0, 2], [50, 2, 2], [43, 6, 2],
  ]);
  assert.equal(evs.some((e) => e.isRest), false, 'rests are absences, not events');
});

t('no accompaniment means no events, not a crash', () => {
  assert.deepEqual(compileAccompaniment({ id: 'x', meter: [4, 4], melody: 'B3/4' }), []);
});

t('what a tune asks of the player can be listed without playing it', () => {
  const spec = {
    id: 'x', meter: [4, 4],
    taught: notesInRegion({ strings: [1, 2, 3], minFret: 0, maxFret: 3 }),
    melody: 'G3/1 A3/1 B3/1 G3/1 | r/2 E4/2',
  };
  assert.deepEqual(pitchesUsed(spec), [55, 57, 59, 64]);
  assert.deepEqual(positionsUsed(spec).sort(), ['s1f0', 's2f0', 's3f0', 's3f2']);
});

console.log(`tune: ${pass} ok`);
