// The Pieces tab: import a score, drill it chunk by chunk, join the chunks up.

import { parseMusicXML, toSequence, harmonySequence } from './musicxml.js';
import {
  makeChunks, makeSeam, newChunkState, applyAttempt, chunkMastered,
  pickChunk, gradeChunk, LAYERS, LAYER_LABELS,
} from './practice.js';
import { renderPhrase } from './staff.js';
import { Metronome } from './audio.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'openstring.piece.v1';

export function initPieceView({ audio, ensureAudio }) {
  const st = {
    piece: null,
    sequence: [],
    harmonies: [],
    chunks: [],
    states: {},
    current: null,
    running: false,
    events: [],
    metro: null,
    targetBpm: 80,
    lastChunkId: null,
    raf: 0,
  };

  // ---------------------------------------------------------------- storage

  function save() {
    if (!st.piece) { localStorage.removeItem(STORE_KEY); return; }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        piece: st.piece, sequence: st.sequence, states: st.states, targetBpm: st.targetBpm,
      }));
    } catch { /* practice still works without persistence */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      st.piece = d.piece; st.sequence = d.sequence; st.states = d.states || {};
      st.targetBpm = d.targetBpm || 80;
      // Recomputed rather than stored: a piece imported before chord symbols
      // existed simply has none, and gets them if it is imported again.
      st.harmonies = harmonySequence(st.piece);
      rebuildChunks();
      return true;
    } catch { return false; }
  }

  function rebuildChunks() {
    const base = makeChunks(st.sequence, { bars: 1 });
    const seams = [];
    for (let i = 0; i < base.length - 1; i++) {
      // A seam only becomes worth drilling once both its neighbours stand up.
      const a = st.states[base[i].id];
      const b = st.states[base[i + 1].id];
      if (a && b && chunkMastered(a, st.targetBpm) && chunkMastered(b, st.targetBpm)) {
        const s = makeSeam(base[i], base[i + 1]);
        if (s) seams.push(s);
      }
    }
    st.chunks = [...base, ...seams];
  }

  // ------------------------------------------------------------------- view

  function renderHead() {
    const has = !!st.piece;
    $('pieceEmpty').hidden = has;
    $('pieceHead').hidden = !has;
    $('pieceDrill').hidden = !has;
    $('chunkListCard').hidden = !has;
    if (!has) return;

    $('pieceTitle').textContent = st.piece.title;
    const bits = [st.piece.composer,
      t('piece.noteCount', { count: st.piece.noteCount }),
      t('piece.barCount', { count: st.chunks.filter((c) => c.kind === 'chunk').length })];
    $('pieceMeta').textContent = bits.filter(Boolean).join(' · ');

    const note = $('octaveNote');
    note.textContent = t(st.piece.octaveConvention.noteKey);
    note.classList.toggle('warn', ['assumed', 'unverified', 'inconsistent'].includes(st.piece.octaveConvention.basis));

    const solid = st.chunks.filter((c) => st.states[c.id] && chunkMastered(st.states[c.id], st.targetBpm)).length;
    const pct = st.chunks.length ? Math.round((solid / st.chunks.length) * 100) : 0;
    $('pieceRing').style.setProperty('--pct', pct);
    $('piecePct').textContent = `${pct}%`;
    $('targetOut').textContent = String(st.targetBpm);
    $('targetBpm').value = String(st.targetBpm);
  }

  function renderChunkList() {
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

  function renderChunkStaff(chunk) {
    $('chunkLabel').textContent = chunk.kind === 'seam'
      ? t('piece.joinLabel', { from: chunk.firstMeasure, to: chunk.lastMeasure })
      : (chunk.lastMeasure !== chunk.firstMeasure
          ? t('piece.barRange', { from: chunk.firstMeasure, to: chunk.lastMeasure })
          : t('piece.bar', { n: chunk.firstMeasure }));
    // Only the chord names that fall inside this chunk, or a two-bar excerpt
    // would carry the whole piece's harmony across the top of it.
    const beats = chunk.notes.map((n) => n.beat ?? 0);
    const from = Math.min(...beats);
    const to = Math.max(...beats.map((b, i) => b + (chunk.notes[i].beats ?? 1)));
    const chords = (st.harmonies || []).filter((h) => h.beat >= from && h.beat < to);
    $('chunkStaff').innerHTML = renderPhrase(chunk.notes, { width: 520, chords });
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
      st.piece = piece;
      st.sequence = seq;
      st.harmonies = harmonySequence(piece);
      st.states = {};
      st.targetBpm = piece.tempo ? Math.max(40, Math.min(160, Math.round(piece.tempo / 4) * 4)) : 80;
      rebuildChunks();
      save();
      renderHead(); renderChunkList();
      nextChunk();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message.includes('.mxl')
        ? ex.message
        : `${ex.message} ${t('piece.mxlHint')}`;
    }
  });

  $('dropPiece').addEventListener('click', () => {
    if (!confirm(t('piece.removeConfirm'))) return;
    st.piece = null; st.sequence = []; st.harmonies = []; st.chunks = []; st.states = {}; st.current = null;
    save(); renderHead();
  });

  $('targetBpm').addEventListener('input', (e) => {
    st.targetBpm = Number(e.target.value);
    $('targetOut').textContent = e.target.value;
    rebuildChunks(); save(); renderHead(); renderChunkList();
  });

  // ---------------------------------------------------------------- drilling

  function nextChunk() {
    if (!st.chunks.length) return;
    const c = pickChunk(st.chunks, st.states, { avoid: st.lastChunkId, targetBpm: st.targetBpm });
    st.current = c;
    st.lastChunkId = c.id;
    if (!st.states[c.id]) st.states[c.id] = newChunkState(Math.max(40, Math.round(st.targetBpm * 0.6 / 2) * 2));
    renderChunkStaff(c);
    renderLayers(st.states[c.id]);
    const s = st.states[c.id];
    $('chunkTempo').textContent = t('piece.tempoAiming', { bpm: s.bpm, target: st.targetBpm });
    $('pVerdictMain').textContent = t('piece.playAfterCountIn');
    $('pVerdictMain').className = 'verdict-main';
    $('pVerdictSub').textContent = '';
    renderChunkList();
  }

  $('startPiece').addEventListener('click', async () => {
    if (st.running || !st.current) return;
    if (!(await ensureAudio())) return;

    const chunk = st.current;
    const state = st.states[chunk.id];
    const bpm = state.bpm;
    const beat = 60 / bpm;

    st.running = true;
    st.events = [];
    $('startPiece').disabled = true;
    $('stopPiece').disabled = false;

    const metro = new Metronome(audio.ctx);
    metro.beatsPerBar = st.piece.beatsPerBar || 4;
    st.metro = metro;
    metro.start(bpm, { countInBars: 1 });

    const wanted = chunk.notes.filter((n) => !n.isRest);
    const first = wanted[0].beat;
    const last = wanted[wanted.length - 1];
    const startTime = metro.timeOfBeat(0);
    const endsAt = startTime + (last.beat - first + last.beats) * beat + 0.8;

    audio.resetTracking();
    $('pVerdictMain').textContent = 'Count-in…';

    const tick = () => {
      if (!st.running) return;
      const t = audio.now();
      if (t > startTime && $('pVerdictMain').textContent === 'Count-in…') $('pVerdictMain').textContent = 'Playing…';
      if (t >= endsAt) { finish(chunk, state, bpm, startTime); return; }
      st.raf = requestAnimationFrame(tick);
    };
    tick();
  });

  $('stopPiece').addEventListener('click', () => {
    if (!st.running) return;
    st.running = false;
    cancelAnimationFrame(st.raf);
    st.metro?.stop();
    $('startPiece').disabled = false;
    $('stopPiece').disabled = true;
    $('pVerdictMain').textContent = 'Stopped.';
  });

  audio.onNoteEvent = (ev) => {
    if (st.running && ev.sounding != null) st.events.push(ev);
  };

  function finish(chunk, state, bpm, startTime) {
    st.running = false;
    cancelAnimationFrame(st.raf);
    st.metro?.stop();
    $('startPiece').disabled = false;
    $('stopPiece').disabled = true;

    const layer = LAYERS[state.layerIndex];
    const g = gradeChunk(chunk.notes, st.events, { bpm, startTime, layer });

    const next = applyAttempt(state, { passed: g.passed, targetBpm: st.targetBpm });
    st.states[chunk.id] = next;

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

  if (load()) { renderHead(); renderChunkList(); nextChunk(); }
  else renderHead();

  return { hasPiece: () => !!st.piece };
}
