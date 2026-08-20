import assert from 'node:assert/strict';
import { parseMusicXML, toSequence, harmonySequence } from '../js/musicxml.js';
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
  // The message is a translation key now, so the module stays language-neutral.
  assert.equal(p.octaveConvention.noteKey, 'piece.octave.assumed');
});

t('a file whose fingering contradicts its pitches is flagged, not silently trusted', () => {
  // Fingering says open G, pitch says something unrelated (a fifth away).
  const bogus = [{ midi: 62, string: 3, fret: 0, dur: 4 }, { midi: 67, string: 2, fret: 1, dur: 4 }, { midi: 71, string: 1, fret: 0, dur: 4 }];
  const p = parseMusicXML(score({ notes: bogus }), P);
  assert.equal(p.octaveConvention.basis, 'unverified');
  assert.equal(p.octaveConvention.noteKey, 'piece.octave.unverified');
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

// --------------------------------------------------------- chord symbols

/** A two-bar score whose measures carry <harmony> elements. */
function harmonyScore(bars) {
  const measures = bars.map((bar, i) => {
    const body = bar.map((item) => item.harmony
      ? `<harmony><root><root-step>${item.harmony.step}</root-step>`
        + (item.harmony.alter != null ? `<root-alter>${item.harmony.alter}</root-alter>` : '')
        + `</root>`
        + `<kind${item.harmony.text ? ` text="${item.harmony.text}"` : ''}>${item.harmony.kind}</kind>`
        + (item.harmony.bass ? `<bass><bass-step>${item.harmony.bass}</bass-step></bass>` : '')
        + `</harmony>`
      : `<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>`
        + `<notations><technical><string>1</string><fret>0</fret></technical></notations></note>`).join('');
    return `<measure number="${i + 1}"><attributes><divisions>4</divisions>`
      + `<time><beats>4</beats><beat-type>4</beat-type></time></attributes>${body}</measure>`;
  }).join('');
  return `<?xml version="1.0"?><score-partwise version="3.1"><part id="P1">${measures}</part></score-partwise>`;
}

const N = {};   // a plain note

t('chord symbols are read, with their sharps, flats and slash basses', () => {
  const xml = harmonyScore([[
    { harmony: { step: 'A', kind: 'minor' } }, N,
    { harmony: { step: 'B', alter: -1, kind: 'major-seventh' } }, N,
    { harmony: { step: 'G', kind: 'dominant', bass: 'B' } }, N,
  ]]);
  const piece = parseMusicXML(xml, P);
  const hs = harmonySequence(piece);
  assert.deepEqual(hs.map((h) => h.label), ['Am', 'Bbmaj7', 'G7/B']);
  assert.equal(piece.harmonyCount, 3);
});

t('a chord symbol lands on the note it labels, not at the start of the bar', () => {
  const xml = harmonyScore([[
    { harmony: { step: 'C', kind: 'major' } }, N, N,
    { harmony: { step: 'G', kind: 'dominant' } }, N, N,
  ]]);
  const hs = harmonySequence(parseMusicXML(xml, P));
  // Four divisions per quarter note: the second symbol sits before the third note.
  assert.equal(hs[0].beat, 0);
  assert.equal(hs[1].beat, 2, `landed on beat ${hs[1].beat}`);
});

t('symbols keep counting across bar lines', () => {
  const xml = harmonyScore([
    [{ harmony: { step: 'C', kind: 'major' } }, N, N, N, N],
    [{ harmony: { step: 'F', kind: 'major' } }, N, N, N, N],
  ]);
  const hs = harmonySequence(parseMusicXML(xml, P));
  assert.equal(hs[0].beat, 0);
  assert.equal(hs[1].beat, 4, 'the second bar starts at beat four');
  assert.equal(hs[1].measure, 2);
});

t('a chord we can finger says so; one we cannot keeps its name and admits it', () => {
  const xml = harmonyScore([[
    { harmony: { step: 'A', kind: 'minor-seventh' } }, N,
    { harmony: { step: 'B', kind: 'half-diminished' } }, N,
  ]]);
  const hs = harmonySequence(parseMusicXML(xml, P));
  assert.deepEqual(hs.map((h) => [h.label, h.quality]), [['Am7', 'm7'], ['Bm7b5', null]]);
});

t('a kind we do not know falls back to the file\'s own text, never to a guess', () => {
  // MusicXML's kind text is the suffix only - the root is written separately -
  // so it is appended to the root rather than replacing the whole symbol.
  const known = harmonyScore([[{ harmony: { step: 'C', kind: 'dominant-11th', text: '11' } }, N]]);
  assert.deepEqual(harmonySequence(parseMusicXML(known, P)).map((h) => h.label), ['C11']);

  const silent = harmonyScore([[{ harmony: { step: 'C', kind: 'dominant-11th' } }, N]]);
  assert.deepEqual(harmonySequence(parseMusicXML(silent, P)), [],
    'no text and no known kind means nothing is written above the music');
});

t('"no chord" is not a chord', () => {
  const xml = harmonyScore([[{ harmony: { step: 'C', kind: 'none' } }, N]]);
  assert.deepEqual(harmonySequence(parseMusicXML(xml, P)), []);
});

t('a score without any harmony is unaffected', () => {
  const piece = parseMusicXML(harmonyScore([[N, N, N, N]]), P);
  assert.equal(piece.harmonyCount, 0);
  assert.deepEqual(harmonySequence(piece), []);
  assert.equal(toSequence(piece).length, 4, 'and the notes are untouched');
});

console.log(`musicxml: ${pass} groups passed`);
