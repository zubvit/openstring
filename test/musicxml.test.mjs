import assert from 'node:assert/strict';
import { parseMusicXML, toSequence } from '../js/musicxml.js';
import { ShimDOMParser } from './xml-shim.mjs';
import { noteName, soundingAt } from '../js/theory.js';

const P = ShimDOMParser;

/** Build a one-part score. `pitchMode` decides which octave convention the file uses. */
function score({ notes, divisions = 4, transpose = null, includeFingering = true, pitchShift = 0 }) {
  const noteXml = notes.map((n) => {
    if (n.rest) return `<note><rest/><duration>${n.dur}</duration></note>`;
    const midi = n.midi + pitchShift;
    const step = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'][midi % 12];
    const alter = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0][midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    const tech = includeFingering && n.string
      ? `<notations><technical><string>${n.string}</string><fret>${n.fret}</fret></technical></notations>`
      : '';
    return `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`
      + `<duration>${n.dur}</duration>${tech}</note>`;
  }).join('');
  return `<?xml version="1.0"?><score-partwise version="3.1">
<work><work-title>Test Study</work-title></work>
<identification><creator type="composer">Carcassi</creator></identification>
<part id="P1"><measure number="1">
<attributes><divisions>${divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
${transpose ? `<transpose><chromatic>0</chromatic><octave-change>${transpose}</octave-change></transpose>` : ''}
</attributes>
<sound tempo="72"/>
${noteXml}
</measure></part></score-partwise>`;
}

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// Open G (string 3, fret 0) sounds G3 = midi 55. Written it is G4 = 67.
const OPEN_G = { midi: 55, string: 3, fret: 0, dur: 4 };
const B1 = { midi: 60, string: 2, fret: 1, dur: 4 };  // C4, B string first fret
const E0 = { midi: 64, string: 1, fret: 0, dur: 4 };  // E4, open high E

t('reads title, composer, tempo and time signature', () => {
  const p = parseMusicXML(score({ notes: [OPEN_G, B1, E0, { rest: true, dur: 4 }] }), P);
  assert.equal(p.title, 'Test Study');
  assert.equal(p.composer, 'Carcassi');
  assert.equal(p.tempo, 72);
  assert.equal(p.beatsPerBar, 4);
  assert.equal(p.noteCount, 3);
});

t('a file written at SOUNDING pitch is detected from its own fingering', () => {
  const p = parseMusicXML(score({ notes: [OPEN_G, B1, E0] }), P);
  assert.equal(p.octaveConvention.basis, 'fingering');
  assert.equal(p.octaveConvention.shift, 0);
  const seq = toSequence(p);
  assert.equal(seq[0].sounding, 55);
  assert.equal(noteName(seq[0].sounding), 'G3');
  assert.equal(noteName(seq[0].written), 'G4');
});

t('a file written at WRITTEN pitch is also detected, and corrected', () => {
  // Same notes, but pitches an octave up - the other common export convention.
  const p = parseMusicXML(score({ notes: [OPEN_G, B1, E0], pitchShift: 12 }), P);
  assert.equal(p.octaveConvention.basis, 'fingering');
  assert.equal(p.octaveConvention.shift, -12);
  const seq = toSequence(p);
  // Must land on the same real notes as the sounding-pitch file above.
  assert.equal(seq[0].sounding, 55, 'open G must sound G3 either way');
  assert.equal(seq[1].sounding, 60);
  assert.equal(seq[2].sounding, 64);
});

t('both conventions produce identical music - the point of the whole exercise', () => {
  const a = toSequence(parseMusicXML(score({ notes: [OPEN_G, B1, E0] }), P)).map((n) => n.sounding);
  const b = toSequence(parseMusicXML(score({ notes: [OPEN_G, B1, E0], pitchShift: 12 }), P)).map((n) => n.sounding);
  assert.deepEqual(a, b);
});

t('fingering always agrees with the string and fret arithmetic', () => {
  const p = parseMusicXML(score({ notes: [OPEN_G, B1, E0] }), P);
  for (const n of toSequence(p)) {
    if (n.isRest) continue;
    assert.equal(n.sounding, soundingAt(n.string, n.fret),
      `s${n.string}f${n.fret} should sound ${soundingAt(n.string, n.fret)}, got ${n.sounding}`);
  }
});

t('without fingering it falls back to the declared transposition', () => {
  const p = parseMusicXML(score({ notes: [{ midi: 67, dur: 4 }, { midi: 72, dur: 4 }], includeFingering: false, transpose: -1 }), P);
  assert.equal(p.octaveConvention.basis, 'transpose');
  assert.equal(p.octaveConvention.shift, -12);
  assert.equal(toSequence(p)[0].sounding, 55);
});

t('with neither, it assumes sounding pitch and SAYS so', () => {
  const p = parseMusicXML(score({ notes: [{ midi: 55, dur: 4 }, { midi: 60, dur: 4 }], includeFingering: false }), P);
  assert.equal(p.octaveConvention.basis, 'assumed');
  assert.match(p.octaveConvention.note, /octave switch/);
});

t('a file whose fingering contradicts its pitches is flagged, not silently trusted', () => {
  // Fingering says open G, pitch says something unrelated (a fifth away).
  const bogus = [{ midi: 62, string: 3, fret: 0, dur: 4 }, { midi: 67, string: 2, fret: 1, dur: 4 }, { midi: 71, string: 1, fret: 0, dur: 4 }];
  const p = parseMusicXML(score({ notes: bogus }), P);
  assert.equal(p.octaveConvention.basis, 'unverified');
  assert.match(p.octaveConvention.note, /could not be confirmed/);
});

t('durations become beats, and rests are kept', () => {
  const p = parseMusicXML(score({ notes: [OPEN_G, { rest: true, dur: 2 }, B1], divisions: 4 }), P);
  const seq = toSequence(p);
  assert.equal(seq[0].beats, 1, 'quarter note at 4 divisions = 1 beat');
  assert.equal(seq[1].isRest, true);
  assert.equal(seq[1].beats, 0.5, 'eighth rest');
  assert.equal(seq[1].beat, 1, 'rest starts after the first beat');
  assert.equal(seq[2].beat, 1.5, 'and the next note follows the rest');
});

t('rejects things that are not scores, with a readable reason', () => {
  assert.throws(() => parseMusicXML('<html><body>nope</body></html>', P), /score-partwise/);
  assert.throws(() => parseMusicXML('<score-partwise/>', P), /no parts/);
});

console.log(`musicxml: ${pass} groups passed`);
