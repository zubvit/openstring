import assert from 'node:assert/strict';
import { parseMusicXML, toSequence, harmonySequence, performanceJoins } from '../js/musicxml.js';
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

// ===================================================== real-world scores
//
// Everything below is a shape that comes out of MuseScore, Sibelius or Guitar
// Pro and used to be parsed wrongly. The fixtures are raw XML rather than the
// tidy builder above, because the point is what real writers actually emit.

const raw = (parts) => `<?xml version="1.0"?><score-partwise version="3.1">${parts}</score-partwise>`;
const note = (step, oct, dur, extra = '') =>
  `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration>${extra}</note>`;
const fingered = (step, oct, dur, str, fret) =>
  note(step, oct, dur, `<notations><technical><string>${str}</string><fret>${fret}</fret></technical></notations>`);

// Melody and bass in one bar, joined by <backup>. This is THE notation for
// classical guitar, and the bass used to land after the end of the bar.
t('two voices joined by backup are read as one bar, in order', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    ${fingered('E', 5, 8, 1, 0)}${fingered('D', 5, 8, 2, 3)}
    <backup><duration>16</duration></backup>
    ${fingered('E', 3, 16, 6, 0)}
  </measure></part>`);
  const seq = toSequence(parseMusicXML(xml, P));
  assert.deepEqual(seq.map((n) => n.beat), [0, 0, 2], 'the bass starts with the bar, not after it');
  const bass = seq.find((n) => n.string === 6);
  assert.equal(bass.beat, 0, `the bass landed on beat ${bass.beat}`);
  assert.equal(bass.beats, 4, 'and lasts the whole bar');
});

t('forward moves the cursor too', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <forward><duration>8</duration></forward>${fingered('G', 4, 8, 3, 0)}
  </measure></part>`);
  const seq = toSequence(parseMusicXML(xml, P));
  assert.equal(seq[0].beat, 2, 'it was skipped over, so the note is on beat two');
});

// Holding a tie is what the notation asks for; it used to be graded as a miss
// because the grader expected a fresh attack on the far side.
t('a tie is one held note, not two', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    ${fingered('G', 4, 8, 3, 0).replace('</note>', '<tie type="start"/></note>')}
    ${fingered('G', 4, 8, 3, 0).replace('</note>', '<tie type="stop"/></note>')}
  </measure></part>`);
  const seq = toSequence(parseMusicXML(xml, P));
  assert.equal(seq.length, 1, `${seq.length} attacks, expected one`);
  assert.equal(seq[0].beats, 4, 'lasting both halves');
});

t('a tie across a barline is still one note', () => {
  const bar = (n, extra) => `<measure number="${n}">${n === 1
    ? '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}
    ${fingered('G', 4, 16, 3, 0).replace('</note>', `${extra}</note>`)}</measure>`;
  const seq = toSequence(parseMusicXML(raw(`<part id="P1">${bar(1, '<tie type="start"/>')}${bar(2, '<tie type="stop"/>')}</part>`), P));
  assert.equal(seq.length, 1);
  assert.equal(seq[0].beats, 8, 'two whole bars of one note');
});

t('notated ties count when the sounding tie is missing', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    ${fingered('G', 4, 8, 3, 0).replace('</note>', '<notations><tied type="start"/></notations></note>')}
    ${fingered('G', 4, 8, 3, 0).replace('</note>', '<notations><tied type="stop"/></notations></note>')}
  </measure></part>`);
  assert.equal(toSequence(parseMusicXML(xml, P)).length, 1);
});

t('a tie between DIFFERENT pitches is not a tie and is not swallowed', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    ${fingered('G', 4, 8, 3, 0)}
    ${fingered('A', 4, 8, 3, 2).replace('</note>', '<tie type="stop"/></note>')}
  </measure></part>`);
  assert.equal(toSequence(parseMusicXML(xml, P)).length, 2, 'a mislabelled tie must not eat a note');
});

// Adding beatsPerBar to a timeline measured in quarter notes: in 6/8 it opened
// a hole at every barline, in cut time the bars overlapped.
t('bars follow one another correctly in six-eight', () => {
  const bar = (n) => `<measure number="${n}">${n === 1
    ? '<attributes><divisions>4</divisions><time><beats>6</beats><beat-type>8</beat-type></time></attributes>' : ''}
    ${fingered('G', 4, 4, 3, 0)}${fingered('A', 4, 4, 3, 2)}${fingered('B', 4, 4, 2, 0)}</measure>`;
  const seq = toSequence(parseMusicXML(raw(`<part id="P1">${bar(1)}${bar(2)}</part>`), P));
  assert.deepEqual(seq.map((n) => n.beat), [0, 1, 2, 3, 4, 5], 'no gap at the barline');
});

t('bars do not overlap in cut time', () => {
  const bar = (n) => `<measure number="${n}">${n === 1
    ? '<attributes><divisions>4</divisions><time><beats>2</beats><beat-type>2</beat-type></time></attributes>' : ''}
    ${fingered('G', 4, 8, 3, 0)}${fingered('A', 4, 8, 3, 2)}</measure>`;
  const seq = toSequence(parseMusicXML(raw(`<part id="P1">${bar(1)}${bar(2)}</part>`), P));
  assert.deepEqual(seq.map((n) => n.beat), [0, 2, 4, 6], 'the second bar starts where the first ends');
});

// NaN spread through every beat and the drill never reached its end time.
t('an additive meter is a number, not NaN', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>3+2</beats><beat-type>8</beat-type></time></attributes>
    ${fingered('G', 4, 4, 3, 0)}</measure>`);
  const piece = parseMusicXML(xml, P);
  assert.equal(piece.beatsPerBar, 5, '3+2 is five');
  for (const n of toSequence(piece)) assert.ok(Number.isFinite(n.beat), `beat is ${n.beat}`);
  assert.ok(Number.isFinite(piece.measures[0].lengthBeats));
});

// A pickup is numbered 0, and `|| fallback` treated that as missing.
t('a pickup bar keeps its own number and its own length', () => {
  const xml = raw(`<part id="P1">
    <measure number="0" implicit="yes">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      ${fingered('G', 4, 4, 3, 0)}</measure>
    <measure number="1">${fingered('A', 4, 16, 3, 2)}</measure></part>`);
  const piece = parseMusicXML(xml, P);
  assert.deepEqual(piece.measures.map((m) => m.number), [0, 1], 'the pickup does not collide with bar one');
  const seq = toSequence(piece);
  assert.equal(seq[1].beat, 1, 'the downbeat follows the single pickup note, not three beats of silence');
});

t('the guitar is chosen from a score that has other instruments', () => {
  const xml = raw(`
    <part-list>
      <score-part id="P1"><part-name>Voice</part-name></score-part>
      <score-part id="P2"><part-name>Guitar</part-name></score-part>
    </part-list>
    <part id="P1"><measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      ${note('C', 5, 16)}</measure></part>
    <part id="P2"><measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      ${fingered('G', 4, 16, 3, 0)}</measure></part>`);
  const seq = toSequence(parseMusicXML(xml, P));
  assert.equal(seq[0].string, 3, 'the fingered part won, not the first one');
});

t('a chord note whose duration differs still shares the onset', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    ${fingered('G', 4, 4, 3, 0)}
    ${fingered('B', 4, 4, 2, 0)}
    ${fingered('E', 5, 16, 1, 0).replace('<pitch>', '<chord/><pitch>')}
  </measure></part>`);
  const piece = parseMusicXML(xml, P);
  const chordNote = piece.measures[0].notes.find((n) => n.isChord);
  assert.equal(chordNote.startBeat, 1, 'stacked on the note before it, whatever it lasts');
});

t('percussion notes are silence, not permanent mistakes', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>8</duration></note>
    ${fingered('G', 4, 8, 3, 0)}</measure></part>`);
  const seq = toSequence(parseMusicXML(xml, P));
  assert.equal(seq[0].isRest, true, 'nothing to play, so nothing to get wrong');
});

// Notes divided by the wrong number turned into bars minutes long - a hang
// with no error rather than a refusal.
t('a score that never says how long its notes are is refused, not guessed at', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    ${note('G', 4, 480)}</measure></part>`);
  assert.throws(() => parseMusicXML(xml, P), /how long its notes are/);
});

t('a second attributes block in the same bar is not dropped', () => {
  const xml = raw(`<part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    ${fingered('G', 4, 16, 3, 0)}
    <attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
  </measure>
  <measure number="2">${fingered('A', 4, 12, 3, 2)}</measure></part>`);
  const piece = parseMusicXML(xml, P);
  assert.equal(piece.measures[1].beatsPerBar, 3, 'the change was seen');
});

// Caught in a browser, not by the tests above: once two voices are read
// properly the entries interleave, so a tie's two halves are no longer
// adjacent and pairing with "the previous note" quietly refused to join them.
t('a tie joins across the other voice sitting between its halves', () => {
  const f = (st, o, d, str, fr, extra = '') =>
    `<note><pitch><step>${st}</step><octave>${o}</octave></pitch><duration>${d}</duration>` +
    `<notations><technical><string>${str}</string><fret>${fr}</fret></technical></notations>${extra}</note>`;
  const xml = raw(`<part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>6</beats><beat-type>8</beat-type></time></attributes>
      ${f('G',4,2,3,0)}${f('A',4,2,3,2)}${f('B',4,2,2,0)}
      <backup><duration>6</duration></backup>
      ${f('E',3,6,6,0,'<tie type="start"/>')}
    </measure>
    <measure number="2">${f('E',3,6,6,0,'<tie type="stop"/>')}</measure></part>`);
  const seq = toSequence(parseMusicXML(xml, P));
  const bass = seq.filter((n) => n.string === 6);
  assert.equal(bass.length, 1, `the bass was struck ${bass.length} times, expected once`);
  assert.equal(bass[0].beat, 0);
  assert.equal(bass[0].beats, 3, 'held across both bars');
  assert.equal(seq.filter((n) => n.string !== 6).length, 3, 'and the melody is untouched');
});

// ============================================== repeats and first/second endings
//
// The drill practises the joins BETWEEN bars, on the argument that joins are
// where a piece comes apart. That only holds if the joins are real. Read
// straight off the page a first-time ending is followed by a second-time
// ending, but nobody ever plays that - and meanwhile the joins that DO exist at
// a repeat are the awkward ones, and were never drilled at all.

const bars = (bodies) => raw(`<part id="P1">${bodies.map((b, i) =>
  `<measure number="${i + 1}">${i === 0
    ? '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}`
  + b + '</measure>').join('')}</part>`);
const plain = (step) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>16</duration>`
  + `<notations><technical><string>3</string><fret>0</fret></technical></notations></note>`;
const leftBar = (inner) => `<barline location="left">${inner}</barline>`;
const rightBar = (inner) => `<barline location="right">${inner}</barline>`;
const joinsOf = (xml) => performanceJoins(parseMusicXML(xml, P).measures)
  .map((j) => `${j.from}${j.kind === 'next' ? '>' : j.kind === 'repeat' ? '@' : '~'}${j.to}`);

t('a piece with no repeat signs just runs from one bar to the next', () => {
  assert.deepEqual(joinsOf(bars([plain('G'), plain('A'), plain('B')])), ['1>2', '2>3']);
});

t('a repeated section adds the jump back to its start', () => {
  const xml = bars([
    leftBar('<repeat direction="forward"/>') + plain('G'),
    plain('A'),
    plain('B') + rightBar('<repeat direction="backward"/>'),
    plain('C'),
  ]);
  const j = joinsOf(xml);
  assert.ok(j.includes('3@1'), `the jump back is missing: ${j.join(' ')}`);
  assert.ok(j.includes('3>4'), 'and the way out of the repeat is still there');
});

t('a repeat with no opening sign goes back to the beginning', () => {
  const xml = bars([plain('G'), plain('A') + rightBar('<repeat direction="backward"/>')]);
  assert.ok(joinsOf(xml).includes('2@1'));
});

// The whole point of the exercise.
t('the first-time bar never leads to the second-time bar', () => {
  const xml = bars([
    leftBar('<repeat direction="forward"/>') + plain('G'),
    plain('A'),
    leftBar('<ending number="1" type="start"/>') + plain('B')
      + rightBar('<ending number="1" type="stop"/><repeat direction="backward"/>'),
    leftBar('<ending number="2" type="start"/>') + plain('C')
      + rightBar('<ending number="2" type="discontinue"/>'),
  ]);
  const j = joinsOf(xml);
  assert.ok(!j.includes('3>4'), `a join nobody ever plays: ${j.join(' ')}`);
  assert.ok(j.includes('3@1'), 'at the end of the first ending you go back');
  assert.ok(j.includes('2~4'), 'and the second time round you come out of bar 2 into the second ending');
  assert.ok(j.includes('1>2'), 'the ordinary joins are untouched');
});

t('an ending written for both times is not treated as a second one', () => {
  const xml = bars([
    leftBar('<repeat direction="forward"/>') + plain('G'),
    leftBar('<ending number="1,2" type="start"/>') + plain('A')
      + rightBar('<ending number="1,2" type="stop"/>'),
    plain('B'),
  ]);
  const j = joinsOf(xml);
  assert.ok(j.includes('2>3'), `nothing to suppress here: ${j.join(' ')}`);
});

t('joins never point at a bar that is not there', () => {
  const xml = bars([plain('G'), plain('A') + rightBar('<repeat direction="backward"/>')]);
  const piece = parseMusicXML(xml, P);
  for (const j of performanceJoins(piece.measures)) {
    assert.ok(piece.measures.some((m) => m.number === j.from), `no bar ${j.from}`);
    assert.ok(piece.measures.some((m) => m.number === j.to), `no bar ${j.to}`);
  }
});

t('a score with no barline elements at all is unaffected', () => {
  const piece = parseMusicXML(bars([plain('G'), plain('A')]), P);
  assert.equal(piece.measures[0].repeatStart, undefined);
  assert.equal(piece.measures[0].endingStart, undefined);
});

console.log(`musicxml: ${pass} groups passed`);
