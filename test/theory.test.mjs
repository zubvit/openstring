import assert from 'node:assert/strict';
import {
  midiToHz, hzToMidiFloat, centsOff, centsFromTarget, spell, noteName, pitchClassName, isNatural,
  soundingAt, writtenAt, positionsFor, notesInRegion, STANDARD_TUNING,
} from '../js/theory.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

t('A440 round trip', () => {
  assert.equal(midiToHz(69), 440);
  near(hzToMidiFloat(440), 69, 1e-9, 'a4');
});

t('open string frequencies match the real instrument', () => {
  // Published standard-tuning frequencies.
  near(midiToHz(STANDARD_TUNING[6]), 82.41, 0.01, 'low E');
  near(midiToHz(STANDARD_TUNING[5]), 110.0, 0.01, 'A');
  near(midiToHz(STANDARD_TUNING[4]), 146.83, 0.01, 'D');
  near(midiToHz(STANDARD_TUNING[3]), 196.0, 0.01, 'G');
  near(midiToHz(STANDARD_TUNING[2]), 246.94, 0.01, 'B');
  near(midiToHz(STANDARD_TUNING[1]), 329.63, 0.01, 'high E');
});

t('cents deviation', () => {
  assert.equal(centsOff(440), 0);
  near(centsOff(440 * Math.pow(2, 30 / 1200)), 30, 1, 'sharp by 30c');
  near(centsOff(440 * Math.pow(2, -30 / 1200)), -30, 1, 'flat by 30c');
  // Exactly 50 cents is equidistant from two semitones - either sign is defensible.
  assert.equal(Math.abs(centsOff(440 * Math.pow(2, 50 / 1200))), 50);
});

t('cents from a known target has no tie ambiguity', () => {
  assert.equal(centsFromTarget(440, 69), 0);
  near(centsFromTarget(440 * Math.pow(2, 50 / 1200), 69), 50, 1, 'sharp of target');
  near(centsFromTarget(440 * Math.pow(2, -50 / 1200), 69), -50, 1, 'flat of target');
  // A whole semitone sharp of the target reads as +100, not 0.
  near(centsFromTarget(midiToHz(70), 69), 100, 1, 'semitone sharp');
});

t('spelling naturals and accidentals', () => {
  assert.equal(noteName(60), 'C4');           // middle C
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(61), 'C#4');
  assert.equal(noteName(61, true), 'Db4');
  assert.equal(noteName(70, true), 'Bb4');
  assert.equal(pitchClassName(64), 'E');
  assert.ok(isNatural(64));
  assert.ok(!isNatural(63));
});

t('diatonic index is monotonic and octave-consistent', () => {
  assert.equal(spell(60).diatonic, spell(72).diatonic - 7); // C4 vs C5
  assert.ok(spell(62).diatonic > spell(60).diatonic);       // D4 above C4
  // B4 sits on the middle line of the treble staff.
  assert.equal(spell(71).letter, 'B');
  assert.equal(spell(71).octave, 4);
});

t('guitar is written an octave above what it sounds', () => {
  // Open low E sounds E2 (midi 40) and is written E3 (midi 52).
  assert.equal(soundingAt(6, 0), 40);
  assert.equal(writtenAt(6, 0), 52);
  assert.equal(noteName(soundingAt(6, 0)), 'E2');
  assert.equal(noteName(writtenAt(6, 0)), 'E3');
  // Open high E sounds E4, written E5.
  assert.equal(noteName(soundingAt(1, 0)), 'E4');
  assert.equal(noteName(writtenAt(1, 0)), 'E5');
});

t('fretboard arithmetic', () => {
  assert.equal(soundingAt(1, 3), 67);            // high E, 3rd fret = G4
  assert.equal(noteName(soundingAt(1, 3)), 'G4');
  assert.equal(noteName(soundingAt(2, 1)), 'C4'); // B string 1st fret = middle C
  assert.equal(noteName(soundingAt(5, 3)), 'C3');
  // 12th fret is the octave of the open string.
  for (let s = 1; s <= 6; s++) assert.equal(soundingAt(s, 12), soundingAt(s, 0) + 12);
});

t('the same pitch lives in several places', () => {
  const g4 = 67; // sounding G4
  const pos = positionsFor(g4, { maxFret: 12 });
  // high E fret 3, B string fret 8, G string fret 12
  assert.ok(pos.some((p) => p.string === 1 && p.fret === 3));
  assert.ok(pos.some((p) => p.string === 2 && p.fret === 8));
  assert.ok(pos.some((p) => p.string === 3 && p.fret === 12));
});

t('month one region is exactly one octave of naturals', () => {
  const notes = notesInRegion({ strings: [1, 2, 3], minFret: 0, maxFret: 3, naturalsOnly: true });
  const names = notes.map((x) => noteName(x.sounding)).sort();
  // G string: G3 A3 | B string: B3 C4 D4 | high E: E4 F4 G4
  assert.deepEqual(names, ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G3', 'G4']);
  assert.equal(notes.length, 8);
  const lo = Math.min(...notes.map((x) => x.sounding));
  const hi = Math.max(...notes.map((x) => x.sounding));
  assert.equal(hi - lo, 12); // spans exactly an octave, G3 to G4
});

console.log(`theory: ${n} groups passed`);
