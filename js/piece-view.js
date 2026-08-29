// The Pieces tab: pick a piece, drill it chunk by chunk, join the chunks up,
// then play the whole thing with the app taking the other part.
//
// This tab used to have exactly one door into it: import a MusicXML file. So
// unless you owned notation software the app contained no music at all, and a
// beginner's entire experience of it was single notes on flashcards. He said so
// plainly - "it is not incremental", "I want the app to become my teacher" - and
// the missing half was never the drilling, which was already good. It was that
// nothing he did ever turned into a piece of music.
//
// So there is now a built-in library graded to the lessons (js/library.js), the
// app plays the accompaniment (js/accompany.js), and there is a button that
// plays a piece straight through without grading anything, because sometimes the
// point is to hear it rather than to be marked on it.

import { parseMusicXML, toSequence, harmonySequence, performanceJoins } from './musicxml.js';
import { readStore, writeStore, removeStore } from './stores.js';
import {
  makeChunks, makeSeam, newChunkState, applyAttempt, chunkMastered,
  pickChunk, gradeChunk, LAYERS,
} from './practice.js';
import { renderPhrase, renderFretboard } from './staff.js';
import { Metronome, playChord, outputContext } from './audio.js';
import { compileTune, compileAccompaniment } from './tune.js';
import { scheduleAccompaniment, isAccompaniment } from './accompany.js';
import { PIECES, pieceSpec } from './library.js';
import { whyThisChunk, whyThisMove, observe, summarise } from './coach.js';
import { lessonNotes } from './lesson.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
// Translations are data from a file; nothing here builds markup out of them raw.
const esc = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STORE_KEY = 'openstring.pieces.v2';
const OLD_KEY = 'openstring.piece.v1';
const IMPORTED = '@imported';

export function initPieceView({ audio, ensureAudio, lessonOf = () => 1, onProgress = null }) {
  const st = {
    id: null,            // library id, or IMPORTED
    spec: null,          // library spec, when this is a built-in
    piece: null,
    sequence: [],
    harmonies: [],
    accomp: [],
    chunks: [],
    states: {},
    byId: {},            // per piece: { states, targetBpm }
    imported: null,      // { piece, sequence } - the one file he may bring in
    current: null,
    running: false,
    wholeRun: false,
    events: [],
    appPlayed: [],
    metro: null,
    targetBpm: 80,
    lastChunkId: null,
    raf: 0,
    // Every attempt this sitting, for the coach. Deliberately NOT persisted:
    // "how you practised today" is about today, and a log that survives the
    // week would average his best sitting into his worst and describe neither.
    log: [],
  };

  // ---------------------------------------------------------------- storage

  function save() {
    if (st.id) st.byId[st.id] = { states: st.states, targetBpm: st.targetBpm };
    const payload = { current: st.id, byId: st.byId, imported: st.imported };
    // Nothing worth keeping: no built-in has been touched and no file imported.
    if (!Object.keys(st.byId).length && !st.imported) { removeStore(STORE_KEY); return; }
    try { writeStore(STORE_KEY, payload); } catch { /* practice still works without it */ }
    report();
  }

  /**
   * How far each piece has got, for the lesson list to read.
   *
   * Deliberately derived rather than stored: "this piece is done" is not a flag
   * somebody sets, it is a count of bars that stood up at tempo, and a flag
   * would let a lesson be finished by a piece that had since been reset.
   */
  function progressByPiece() {
    const out = {};
    for (const [id, rec] of Object.entries(st.byId)) {
      const spec = pieceSpec(id);
      if (!spec) continue;
      const target = rec.targetBpm || spec.bpm || 80;
      const bars = compileTune(withRegion(spec)).measures.length;
      const solid = Object.values(rec.states || {})
        .filter((s) => chunkMastered(s, target)).length;
      out[id] = { bars, solid: Math.min(solid, bars) };
    }
    return out;
  }

  function report() { onProgress?.(progressByPiece()); }

  function load() {
    try {
      const d = readStore(STORE_KEY) || migrate();
      if (!d) return false;
      st.byId = d.byId || {};
      st.imported = d.imported || null;
      if (d.current) openPiece(d.current, { silent: true });
      report();
      return true;
    } catch { return false; }
  }

  /** A piece imported before the library existed keeps its practice history. */
  function migrate() {
    const old = readStore(OLD_KEY);
    if (!old?.piece) return null;
    removeStore(OLD_KEY);
    const moved = {
      current: IMPORTED,
      byId: { [IMPORTED]: { states: old.states || {}, targetBpm: old.targetBpm || 80 } },
      imported: { piece: old.piece, sequence: old.sequence },
    };
    writeStore(STORE_KEY, moved);
    return moved;
  }

  // ------------------------------------------------------------------ pieces

  /**
   * A built-in tune is fingered only where its lesson has actually been, so the
   * fretboard picture can never point at a string he has not been taught.
   */
  function withRegion(spec) {
    return { ...spec, taught: spec.taught || lessonNotes(lessonOf(spec.lesson)) };
  }

  function openPiece(id, { silent = false } = {}) {
    if (id === IMPORTED) {
      if (!st.imported) return false;
      st.spec = null;
      st.piece = st.imported.piece;
      st.sequence = st.imported.sequence;
      st.accomp = [];
    } else {
      const spec = pieceSpec(id);
      if (!spec) return false;
      st.spec = withRegion(spec);
      st.piece = compileTune(st.spec);
      st.sequence = toSequence(st.piece);
      st.accomp = compileAccompaniment(st.spec);
    }
    st.id = id;
    st.harmonies = harmonySequence(st.piece);
    const rec = st.byId[id] || {};
    st.states = rec.states || {};
    st.targetBpm = rec.targetBpm || st.spec?.bpm || st.piece.tempo || 80;
    st.current = null;
    st.lastChunkId = null;
    st.log = [];
    rebuildChunks();
    if (!silent) { save(); renderAll(); nextChunk(); }
    return true;
  }

  function rebuildChunks() {
    const base = makeChunks(st.sequence, { bars: 1 });
    const byMeasure = new Map(base.map((c) => [c.firstMeasure, c]));

    // Seams follow the joins the music actually has. Pairing every chunk with
    // the next one on the page drilled the step from a first-time ending into a
    // second-time ending - a transition nobody ever plays - and never drilled
    // the jump back to the start of a repeat, which is the awkward one.
    const joins = st.piece?.measures
      ? performanceJoins(st.piece.measures)
      : base.slice(0, -1).map((c, i) => ({ from: c.firstMeasure, to: base[i + 1].firstMeasure }));

    const seams = [];
    const seen = new Set();
    for (const join of joins) {
      const a = byMeasure.get(join.from);
      const b = byMeasure.get(join.to);
      if (!a || !b || a.id === b.id) continue;
      // A seam only becomes worth drilling once both its neighbours stand up.
      const sa = st.states[a.id];
      const sb = st.states[b.id];
      if (!(sa && sb && chunkMastered(sa, st.targetBpm) && chunkMastered(sb, st.targetBpm))) continue;
      const seam = makeSeam(a, b);
      if (seam && !seen.has(seam.id)) { seen.add(seam.id); seams.push(seam); }
    }
    st.chunks = [...base, ...seams];
  }

  // ----------------------------------------------------------------- library

  let unlockedThrough = 1;

  /** Which lessons he has reached; anything beyond is shown but not playable. */
  function setUnlockedThrough(n) { unlockedThrough = n; renderLibrary(); }

  function libraryRow(spec, locked) {
    const done = progressByPiece()[spec.id];
    const pct = done && done.bars ? Math.round((done.solid / done.bars) * 100) : 0;
    const kind = t(`library.kind.${spec.kind}`);
    return `<button class="lib-row${locked ? ' locked' : ''}${st.id === spec.id ? ' current' : ''}"
        data-piece="${spec.id}"${locked ? ' disabled' : ''}>
      <span class="lib-name">${spec.title}</span>
      <span class="lib-kind">${kind}</span>
      <span class="lib-meta muted small">${t('library.lessonN', { n: spec.lesson })}</span>
      <span class="chunk-bar"><span style="width:${pct}%"></span></span>
    </button>`;
  }

  function renderLibrary() {
    const open = PIECES.filter((p) => p.lesson <= unlockedThrough);
    const shut = PIECES.filter((p) => p.lesson > unlockedThrough);
    $('libList').innerHTML = open.length
      ? open.map((p) => libraryRow(p, false)).join('')
      : `<p class="muted">${t('library.none')}</p>`;
    $('libLocked').innerHTML = shut.map((p) => libraryRow(p, true)).join('');
    $('libLocked').closest('details').hidden = !shut.length;
  }

  $('libList').addEventListener('click', (e) => {
    const row = e.target.closest('.lib-row');
    if (row?.dataset.piece) openPiece(row.dataset.piece);
  });

  // ------------------------------------------------------------------- view

  function renderAll() { renderHead(); renderLibrary(); renderChunkList(); }

  function renderHead() {
    const has = !!st.piece;
    $('pieceEmpty').hidden = has;
    $('pieceHead').hidden = !has;
    $('pieceDrill').hidden = !has;
    $('chunkListCard').hidden = !has;
    $('duetToggleWrap').hidden = !st.accomp.length;
    $('playWhole').hidden = !has;
    if (!has) { $('coachCard').hidden = true; return; }

    $('pieceTitle').textContent = st.piece.title;
    const bits = [st.spec ? sourceLine(st.spec) : st.piece.composer,
      t('piece.noteCount', { count: st.piece.noteCount }),
      t('piece.barCount', { count: st.chunks.filter((c) => c.kind === 'chunk').length })];
    $('pieceMeta').textContent = bits.filter(Boolean).join(' · ');

    const note = $('octaveNote');
    note.textContent = st.spec ? (st.spec.why || '') : t(st.piece.octaveConvention.noteKey);
    note.classList.toggle('warn', !st.spec
      && ['assumed', 'unverified', 'inconsistent'].includes(st.piece.octaveConvention.basis));

    const solid = st.chunks.filter((c) => st.states[c.id] && chunkMastered(st.states[c.id], st.targetBpm)).length;
    const pct = st.chunks.length ? Math.round((solid / st.chunks.length) * 100) : 0;
    $('pieceRing').style.setProperty('--pct', pct);
    $('piecePct').textContent = `${pct}%`;
    $('targetOut').textContent = String(st.targetBpm);
    $('targetBpm').value = String(st.targetBpm);
    $('dropPiece').hidden = st.id !== IMPORTED;
  }

  /**
   * The credit line. `source` carries the licence evidence - "public-domain:
   * Ludwig van Beethoven, d.1827" - because a public repo needs to be able to
   * show its working. Only the name belongs on screen.
   */
  function sourceLine(spec) {
    if (spec.source === 'trad') return t('library.source.trad');
    if (spec.source === 'original') return t('library.source.original');
    const name = spec.source.replace(/^public-domain:\s*/, '').replace(/,\s*d\.\d{4}\s*$/, '');
    return t('library.source.composer', { source: name });
  }

  function renderChunkList() {
    if (!st.piece) { $('chunkList').innerHTML = ''; return; }
    $('chunkList').innerHTML = st.chunks.map((c) => {
      const s = st.states[c.id] || newChunkState();
      const pct = Math.min(100, Math.round((s.bestBpm / st.targetBpm) * 100));
      const label = c.kind === 'seam'
        ? t('piece.seamRow', { from: c.firstMeasure, to: c.lastMeasure })
        : (c.lastMeasure !== c.firstMeasure
            ? t('piece.chunkRowRange', { from: c.firstMeasure, to: c.lastMeasure })
            : t('piece.chunkRow', { from: c.firstMeasure }));
      return `<div class="chunk-row ${c.kind === 'seam' ? 'seam' : ''} ${st.current?.id === c.id ? 'current' : ''}">
        <span>${label}<span class="muted small"> · ${t(`layer.${LAYERS[s.layerIndex]}`)}</span></span>
        <span class="bpm">${s.attempts ? `${s.bpm} bpm` : '—'}</span>
        <span class="chunk-bar"><span style="width:${pct}%"></span></span>
      </div>`;
    }).join('');
  }

  function renderChunkStaff(chunk, states = {}) {
    // A backward seam is the jump to the top of a repeat, and calling that "the
    // join between bars 3 and 1" would describe something the page does not do.
    $('chunkLabel').textContent = chunk.kind === 'seam'
      ? (chunk.backwards
          ? t('piece.repeatLabel', { from: chunk.firstMeasure, to: chunk.lastMeasure })
          : t('piece.joinLabel', { from: chunk.firstMeasure, to: chunk.lastMeasure }))
      : (chunk.lastMeasure !== chunk.firstMeasure
          ? t('piece.barRange', { from: chunk.firstMeasure, to: chunk.lastMeasure })
          : t('piece.bar', { n: chunk.firstMeasure }));
    const beats = chunk.notes.map((n) => n.beat ?? 0);
    const from = Math.min(...beats);
    const to = Math.max(...beats.map((b, i) => b + (chunk.notes[i].beats ?? 1)));
    const chords = (st.harmonies || []).filter((h) => h.beat >= from && h.beat < to);
    $('chunkStaff').innerHTML = renderPhrase(chunk.notes, { width: 520, chords, states });
    paintChunkHint(chunk, states);
  }

  /**
   * Where the fingers go for this bar, in order.
   *
   * The reading drill has always had this and the piece drill never did, so the
   * moment he opened a piece he was looking at two noteheads and nothing else.
   * Numbered, because four identical dots say where the fingers go and nothing
   * about which comes first.
   */
  function paintChunkHint(chunk, states = {}) {
    const host = $('chunkHint');
    if (!$('showChunkHint').checked) { host.hidden = true; host.innerHTML = ''; return; }
    const notes = chunk.notes.filter((n) => !n.isRest && n.string != null);
    if (!notes.length) { host.hidden = true; host.innerHTML = ''; return; }
    const frets = notes.map((n) => n.fret);
    host.hidden = false;
    host.innerHTML = renderFretboard({
      minFret: 0,
      maxFret: Math.max(3, Math.max(...frets)),
      marks: notes.map((n, i) => ({ string: n.string, fret: n.fret, n: i + 1 })),
      width: 300,
    });
  }

  /**
   * One line saying what to do RIGHT NOW.
   *
   * "idk what exactly I need to do" - looking at a staff, five buttons and a row
   * of grey chips. Everything on that screen was information; none of it was an
   * instruction.
   */
  function sayWhatToDo(chunk) {
    const played = st.states[chunk.id]?.attempts > 0;
    $('chunkDo').textContent = played
      ? t('piece.doAgain', { bpm: st.states[chunk.id].bpm })
      : t('piece.doFirst');
  }

  /** A reason line, or nothing at all - never a blank element holding space. */
  function sayWhy(id, why) {
    const el = $(id);
    if (!el) return;
    el.textContent = why ? t(why.key, why.vars) : '';
    el.hidden = !why;
  }

  /**
   * What kind of practice this sitting was.
   *
   * Deliberately not a score and deliberately short. The point is to name the
   * method so it transfers to a piece the app has never seen - if it reads as
   * marking, it gets ignored, and then it teaches nothing.
   */
  function renderCoach() {
    const seen = observe(st.log, { targetBpm: st.targetBpm });
    const card = $('coachCard');
    card.hidden = !seen.length;
    if (!seen.length) return;
    $('coachList').innerHTML = seen.map((o) =>
      `<li class="coach-item ${o.good ? 'good' : 'work'}">${esc(t(o.key, o.vars))}</li>`).join('');
    const n = summarise(st.log);
    $('coachCount').textContent = t('coach.tally', {
      attempts: n.attempts, clean: n.clean, drills: n.drills, runs: n.runs,
    });
  }

  function renderLayers(state, results = null) {
    $('layerRow').innerHTML = LAYERS.map((l, i) => {
      let cls = 'layer-chip';
      if (i < state.layerIndex) cls += ' ok';
      else if (i === state.layerIndex) cls += ' active';
      else cls += ' future';
      if (results && results[l] && i <= state.layerIndex) cls += results[l].ok ? ' ok' : ' fail';
      const detail = results?.[l]?.detail ? ` — ${results[l].detail}` : '';
      const label = t(`layer.${l}`);
      return `<span class="${cls}" title="${label}${detail}">${label}</span>`;
    }).join('');
  }

  // ----------------------------------------------------------------- import

  $('pieceFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const err = $('importError');
    err.hidden = true;
    try {
      const text = await file.text();
      const piece = parseMusicXML(text);
      const seq = toSequence(piece);
      if (!seq.some((n) => !n.isRest)) throw new Error(t('piece.noNotes'));
      st.imported = { piece, sequence: seq };
      st.byId[IMPORTED] = {
        states: {},
        targetBpm: piece.tempo ? Math.max(40, Math.min(160, Math.round(piece.tempo / 4) * 4)) : 80,
      };
      openPiece(IMPORTED);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message.includes('.mxl')
        ? ex.message
        : `${ex.message} ${t('piece.mxlHint')}`;
    }
  });

  $('dropPiece').addEventListener('click', () => {
    if (!confirm(t('piece.removeConfirm'))) return;
    st.imported = null;
    delete st.byId[IMPORTED];
    st.id = null; st.piece = null; st.sequence = []; st.harmonies = [];
    st.accomp = []; st.chunks = []; st.states = {}; st.current = null;
    save(); renderAll();
  });

  $('showChunkHint').addEventListener('change', () => {
    if (st.current) paintChunkHint(st.current);
  });

  $('targetBpm').addEventListener('input', (e) => {
    st.targetBpm = Number(e.target.value);
    $('targetOut').textContent = e.target.value;
    rebuildChunks(); save(); renderHead(); renderChunkList();
  });

  // ---------------------------------------------------------------- drilling

  function nextChunk() {
    if (!st.chunks.length) return;
    // A piece he has never touched starts at the beginning. The scheduler is
    // right to jump about once there is something to know about him, but its
    // first act on a new piece was to open at bar 6 of 8 - which reads as the
    // app losing its place, and gives him no way in.
    const untouched = !Object.keys(st.states).length;
    const c = untouched
      ? st.chunks.find((x) => x.kind !== 'seam') || st.chunks[0]
      : pickChunk(st.chunks, st.states, { avoid: st.lastChunkId, targetBpm: st.targetBpm });
    st.current = c;
    st.lastChunkId = c.id;
    if (!st.states[c.id]) st.states[c.id] = newChunkState(Math.max(40, Math.round(st.targetBpm * 0.6 / 2) * 2));
    renderChunkStaff(c);
    renderLayers(st.states[c.id]);
    const s = st.states[c.id];
    sayWhy('chunkWhy', whyThisChunk(c, s, { targetBpm: st.targetBpm }));
    sayWhatToDo(c);
    $('chunkMove').textContent = '';
    $('chunkTempo').textContent = t('piece.tempoAiming', { bpm: s.bpm, target: st.targetBpm });
    $('pVerdictMain').textContent = t('piece.playAfterCountIn');
    $('pVerdictMain').className = 'verdict-main';
    $('pVerdictSub').textContent = '';
    renderChunkList();
  }

  /** The stretch of the accompaniment that belongs to a chunk, moved to its start. */
  function accompFor(chunk) {
    if (!st.accomp.length || !$('duetToggle').checked) return [];
    const notes = chunk.notes.filter((n) => !n.isRest);
    if (!notes.length) return [];
    const from = Math.min(...chunk.notes.map((n) => n.beat ?? 0));
    const to = Math.max(...chunk.notes.map((n) => (n.beat ?? 0) + (n.beats ?? 1)));
    const first = notes[0].beat;
    return st.accomp
      .filter((e) => e.beat >= from - 1e-6 && e.beat < to - 1e-6)
      .map((e) => ({ ...e, beat: e.beat - first }));
  }

  async function begin({ whole }) {
    if (st.running) return;
    if (!whole && !st.current) return;
    if (!(await ensureAudio({ onError: (message) => {
      $('pVerdictMain').textContent = message;
      $('pVerdictMain').className = 'verdict-main bad';
    } }))) return;

    const chunk = whole ? wholePieceChunk() : st.current;
    const state = whole ? newChunkState(st.targetBpm) : st.states[chunk.id];
    const bpm = whole ? st.targetBpm : state.bpm;
    const beat = 60 / bpm;

    st.running = true;
    st.wholeRun = whole;
    st.events = [];
    st.appPlayed = [];
    $('startPiece').disabled = true;
    $('playWhole').disabled = true;
    $('stopPiece').disabled = false;

    const metro = new Metronome(audio.ctx);
    // The metronome ticks quarter notes, so the accent has to fall every
    // QUARTER-beat bar length - not every `beatsPerBar`, which counts eighths in
    // 6/8 and halves in cut time.
    const here = st.piece.measures.find((m) => m.number === chunk.firstMeasure);
    metro.beatsPerBar = Math.max(1, Math.round(here?.lengthBeats ?? st.piece.beatsPerBar ?? 4));
    st.metro = metro;
    metro.start(bpm, { countInBars: 1 });

    const wanted = chunk.notes.filter((n) => !n.isRest);
    const first = wanted[0].beat;
    const last = wanted[wanted.length - 1];
    const startTime = metro.timeOfBeat(0);
    const endsAt = startTime + (last.beat - first + last.beats) * beat + 0.8;

    // The app's part, scheduled on the audio clock so it lands with the click
    // rather than near it.
    const part = whole
      ? ($('duetToggle').checked ? st.accomp.map((e) => ({ ...e, beat: e.beat - first })) : [])
      : accompFor(chunk);
    st.appPlayed = scheduleAccompaniment(audio.ctx, part, {
      timeOfBeat: (b) => metro.timeOfBeat(b), bpm,
    });

    audio.resetTracking();
    $('pVerdictMain').textContent = t('drill.countingIn');
    let announced = false;

    const tick = () => {
      if (!st.running) return;
      const now = audio.now();
      if (!announced && now > startTime) {
        announced = true;
        $('pVerdictMain').textContent = whole ? t('piece.playingThrough') : t('drill.playing');
      }
      if (now >= endsAt) { finish(chunk, state, bpm, startTime, whole); return; }
      st.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /** The whole piece as one chunk, for playing it rather than being marked on it. */
  function wholePieceChunk() {
    const notes = st.sequence;
    return {
      id: '@whole', kind: 'chunk', notes,
      firstMeasure: notes[0]?.measure ?? 1,
      lastMeasure: notes[notes.length - 1]?.measure ?? 1,
    };
  }

  $('startPiece').addEventListener('click', () => begin({ whole: false }));
  $('playWhole').addEventListener('click', () => begin({ whole: true }));

  // Hearing it is not cheating - it is how you learn a piece above your reading
  // level, which is the only way anybody has ever had real music to play while
  // their reading catches up.
  $('hearChunk').addEventListener('click', () => {
    if (!st.current || st.running) return;
    const notes = st.current.notes.filter((n) => !n.isRest);
    if (!notes.length) return;
    // The microphone may never have been switched on - hearing a piece needs no
    // permission at all. Taking audio.ctx regardless left every `when` sitting
    // in the past on the real output clock, so all eight bars fired at once as
    // a single chord.
    const ctx = audio.ctx || outputContext();
    if (!ctx) return;
    const bpm = st.states[st.current.id]?.bpm || st.targetBpm;
    const beat = 60 / bpm;
    const first = notes[0].beat;
    const base = ctx.currentTime + 0.15;
    for (const n of notes) {
      playChord([n.sounding], {
        ctx, spreadS: 0, volume: 0.13,
        holdS: Math.min(2.4, (n.beats || 1) * beat * 0.95),
        when: base + (n.beat - first) * beat,
      });
    }
  });

  function stopPlaying() {
    if (!st.running) return;
    st.running = false;
    cancelAnimationFrame(st.raf);
    st.metro?.stop();
    $('startPiece').disabled = false;
    $('playWhole').disabled = false;
    $('stopPiece').disabled = true;
    $('pVerdictMain').textContent = t('drill.stopped');
  }

  $('stopPiece').addEventListener('click', stopPlaying);

  audio.onNoteEvent = (ev) => {
    if (st.running && ev.sounding != null) st.events.push(ev);
  };

  function finish(chunk, state, bpm, startTime, whole) {
    st.running = false;
    cancelAnimationFrame(st.raf);
    st.metro?.stop();
    $('startPiece').disabled = false;
    $('playWhole').disabled = false;
    $('stopPiece').disabled = true;

    // The microphone heard the app's own part too. Crediting those to him would
    // mark notes he never played as played; blaming him for them would be worse.
    const mine = st.events.filter((ev) => !isAccompaniment(st.appPlayed, ev.sounding, ev.time));

    if (whole) {
      const g = gradeChunk(chunk.notes, mine, { bpm, startTime, layer: 'notes' });
      st.log.push({ chunkId: '@whole', kind: 'whole', bpm, passed: g.passed, at: Date.now() });
      renderCoach();
      $('pVerdictMain').textContent = g.passed ? t('piece.playedItThrough') : t('piece.playedItAnyway');
      $('pVerdictMain').className = `verdict-main ${g.passed ? 'good' : ''}`;
      $('pVerdictSub').textContent = g.results?.notes?.detail || '';
      return;
    }

    const layer = LAYERS[state.layerIndex];
    const g = gradeChunk(chunk.notes, mine, { bpm, startTime, layer });

    const next = applyAttempt(state, { passed: g.passed, targetBpm: st.targetBpm });
    st.states[chunk.id] = next;
    st.log.push({
      chunkId: chunk.id, kind: chunk.kind === 'seam' ? 'seam' : 'chunk',
      bpm, passed: g.passed, at: Date.now(), label: $('chunkLabel').textContent,
    });
    sayWhy('chunkMove', whyThisMove(state, next, { targetBpm: st.targetBpm, passed: g.passed }));
    renderCoach();

    const main = $('pVerdictMain');
    const sub = $('pVerdictSub');
    if (g.passed) {
      main.textContent = next.bpm > bpm ? t('piece.cleanFaster', { bpm: next.bpm })
        : next.layerIndex > state.layerIndex ? t('piece.cleanNewLayer', { layer: t(`layer.${LAYERS[next.layerIndex]}`) })
        : t('piece.cleanAgain');
      main.className = 'verdict-main good';
    } else {
      const failed = g.checked.filter((l) => !g.results[l].ok);
      main.textContent = failed.length ? g.results[failed[0]].detail : t('piece.notQuite');
      main.className = 'verdict-main bad';
    }
    sub.textContent = g.checked.map((l) => `${t(`layer.${l}`)}: ${g.results[l].detail}`).join(' · ');

    renderLayers(next, g.results);
    // The thing he actually asked for: which notes he got. The grader already
    // knew and was reporting a sentence instead.
    const marks = {};
    (g.noteStates || []).forEach((v, i) => { marks[i] = v; });
    renderChunkStaff(chunk, marks);
    $('chunkDo').textContent = g.passed ? t('piece.doClean') : t('piece.doLook');
    $('chunkTempo').textContent = t('piece.tempoAiming', { bpm: next.bpm, target: st.targetBpm });

    rebuildChunks();
    save();
    renderHead();
    renderChunkList();
    setTimeout(() => { if (!st.running) nextChunk(); }, g.passed ? 1400 : 2600);
  }

  // ------------------------------------------------------------------- init

  // Redraw the piece view too - its labels are built in JavaScript.
  window.addEventListener('openstring:redraw', () => {
    renderLibrary();
    if (!st.piece) return;
    renderHead();
    renderChunkList();
    if (st.current) {
      const cur = st.states[st.current.id];
      renderChunkStaff(st.current);
      renderLayers(cur);
      $('chunkTempo').textContent = t('piece.tempoAiming', { bpm: cur.bpm, target: st.targetBpm });
    }
  });

  load();
  renderAll();
  if (st.piece) nextChunk();

  return {
    hasPiece: () => !!st.piece,
    isRunning: () => st.running,
    stop: stopPlaying,
    open: (id) => { const ok = openPiece(id); if (ok) renderAll(); return ok; },
    setUnlockedThrough,
    progress: progressByPiece,
  };
}
