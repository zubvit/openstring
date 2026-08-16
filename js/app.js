// Openstring - wiring the drills to the audio engine and the progress store.

import { AudioEngine, Metronome } from './audio.js';
import {
  soundingAt, writtenAt, hzToMidiFloat, centsFromTarget, noteName, pitchClassName,
  positionId, parsePositionId, positionsFor, midiToHz,
} from './theory.js';
import { renderNote, renderFretboard } from './staff.js';
import { pickNext, isFluent, emptyStat } from './srs.js';
import { Progress } from './progress.js';
import { STAGES, stageById, nextStage, poolFor, readyToAdvance, RHYTHMS, expectedOnsets } from './curriculum.js';
import { gradeTiming } from './onset.js';

const $ = (id) => document.getElementById(id);

const progress = new Progress();
const audio = new AudioEngine();
let stage = stageById(progress.data.stageId || STAGES[0].id);

// ------------------------------------------------------------------ tabs

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${tab.dataset.view}`));
    if (tab.dataset.view === 'progress') renderProgress();
  });
});

function setMic(state, label) {
  const el = $('micState');
  el.classList.toggle('live', state === 'live');
  el.classList.toggle('error', state === 'error');
  $('micLabel').textContent = label;
}

async function ensureAudio() {
  if (audio.running) return true;
  setMic('', 'starting…');
  try {
    await audio.start();
    setMic('live', audio.captureMode === 'worklet' ? 'listening' : 'listening (fallback)');
    $('latRange').value = String(audio.latencyOffsetMs);
    $('latOut').textContent = String(audio.latencyOffsetMs);
    return true;
  } catch (err) {
    setMic('error', 'mic unavailable');
    $('verdictMain').textContent = err.message;
    $('verdictMain').className = 'verdict-main bad';
    return false;
  }
}

// =================================================================== READING

const read = {
  active: false,
  target: null,      // { string, fret, sounding, written }
  shownAt: 0,
  graceUntil: 0,
  judged: false,
  asked: 0,
  correct: 0,
  times: [],
  startedAt: 0,
  lastId: null,
};

function renderStageHeader() {
  $('stageTitle').textContent = stage.title;
  $('stageBlurb').textContent = stage.blurb;
  $('stageAdvice').textContent = stage.advice || '';
  const pct = Math.round(progress.mastery(poolFor(stage)) * 100);
  $('masteryRing').style.setProperty('--pct', pct);
  $('masteryPct').textContent = `${pct}%`;
}

function nextQuestion() {
  const pool = poolFor(stage);
  const id = pickNext(pool, progress.data.stats, { avoid: read.lastId });
  read.lastId = id;
  const { string, fret } = parsePositionId(id);
  read.target = { string, fret, sounding: soundingAt(string, fret), written: writtenAt(string, fret) };
  read.shownAt = performance.now();
  // Ignore the tail of the previous note still ringing into the microphone.
  read.graceUntil = read.shownAt + 350;
  read.judged = false;
  audio.resetTracking();

  $('staffHost').innerHTML = renderNote(read.target.written, { label: '' });
  $('verdictMain').textContent = 'Play it.';
  $('verdictMain').className = 'verdict-main';
  $('verdictSub').textContent = '';
  updateHint();
}

function updateHint() {
  const host = $('hintHost');
  if (!$('showHint').checked || !read.target) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  host.innerHTML = renderFretboard({
    strings: stage.region.strings,
    minFret: stage.region.minFret,
    maxFret: Math.max(stage.region.minFret + 3, stage.region.maxFret),
    mark: { string: read.target.string, fret: read.target.fret },
  });
}
$('showHint').addEventListener('change', updateHint);

function judge(heardMidi, hz) {
  if (!read.target || read.judged) return;
  read.judged = true;

  const ms = performance.now() - read.shownAt;
  const target = read.target.sounding;
  const exact = heardMidi === target;
  // Same letter, wrong octave: right idea, wrong string. Worth saying so.
  const sameClass = ((heardMidi % 12) + 12) % 12 === ((target % 12) + 12) % 12;

  read.asked += 1;
  if (exact) read.correct += 1;
  if (exact) read.times.push(ms);

  progress.recordAnswer(positionId(read.target.string, read.target.fret), { correct: exact, ms });

  const main = $('verdictMain');
  const sub = $('verdictSub');
  if (exact) {
    const cents = centsFromTarget(hz, target);
    main.textContent = `${pitchClassName(target)} — yes`;
    main.className = 'verdict-main good';
    sub.textContent = `${(ms / 1000).toFixed(1)}s${Math.abs(cents) > 25 ? ` · ${cents > 0 ? 'a little sharp' : 'a little flat'} (${cents > 0 ? '+' : ''}${cents} cents)` : ''}`;
  } else {
    main.textContent = `That was ${noteName(heardMidi)} — wanted ${pitchClassName(target)}`;
    main.className = 'verdict-main bad';
    sub.textContent = sameClass
      ? 'Right note, wrong octave — you are on the wrong string.'
      : `It is string ${read.target.string}, fret ${read.target.fret}.`;
  }

  $('staffHost').innerHTML = renderNote(read.target.written, { state: exact ? 'correct' : 'wrong' });

  // Always show where it was after a mistake, hint setting or not.
  if (!exact) {
    const host = $('hintHost');
    host.hidden = false;
    const wrongPos = positionsFor(heardMidi, {
      strings: stage.region.strings, minFret: stage.region.minFret, maxFret: stage.region.maxFret + 2,
    })[0] || null;
    host.innerHTML = renderFretboard({
      strings: stage.region.strings,
      minFret: stage.region.minFret,
      maxFret: Math.max(stage.region.minFret + 3, stage.region.maxFret),
      mark: { string: read.target.string, fret: read.target.fret },
      wrongMark: wrongPos,
    });
  }

  updateSessionCard();
  renderStageHeader();
  setTimeout(() => { if (read.active) nextQuestion(); }, exact ? 750 : 1900);
}

function updateSessionCard() {
  $('sessionCard').hidden = read.asked === 0;
  $('sAsked').textContent = String(read.asked);
  $('sCorrect').textContent = String(read.correct);
  const med = read.times.length
    ? [...read.times].sort((a, b) => a - b)[Math.floor(read.times.length / 2)]
    : null;
  $('sSpeed').textContent = med ? `${(med / 1000).toFixed(1)}s` : '—';
}

audio.onPitch = (stable, raw) => {
  // Tuner + level readout, live regardless of drill state.
  if (raw) {
    const m = Math.round(hzToMidiFloat(raw.hz));
    $('heardNote').textContent = noteName(m);
    const cents = centsFromTarget(raw.hz, m);
    $('tunerNeedle').style.left = `${50 + Math.max(-50, Math.min(50, cents)) }%`;
  }
  if (!read.active || read.judged || !stable) return;
  if (performance.now() < read.graceUntil) return;
  judge(Math.round(hzToMidiFloat(stable.hz)), stable.hz);
};

audio.onLevel = (r) => {
  $('levelFill').style.width = `${Math.min(100, r * 900)}%`;
};

$('startRead').addEventListener('click', async () => {
  if (read.active) {
    endReadSession();
    return;
  }
  if (!(await ensureAudio())) return;
  read.active = true;
  read.asked = 0; read.correct = 0; read.times = []; read.startedAt = Date.now();
  $('startRead').textContent = 'Pause';
  $('skipNote').disabled = false;
  nextQuestion();
});

$('skipNote').addEventListener('click', () => {
  if (!read.active) return;
  if (read.target && !read.judged) {
    progress.recordAnswer(positionId(read.target.string, read.target.fret), { correct: false, ms: 8000 });
    read.asked += 1;
    updateSessionCard();
  }
  nextQuestion();
});

$('endSession').addEventListener('click', endReadSession);

function endReadSession() {
  if (read.asked > 0) {
    progress.recordSession({
      ms: Date.now() - read.startedAt, asked: read.asked, correct: read.correct, stageId: stage.id,
    });
  }
  read.active = false;
  read.target = null;
  $('startRead').textContent = 'Start listening';
  $('skipNote').disabled = true;
  $('verdictMain').textContent = read.asked ? `Session done — ${read.correct} of ${read.asked} right first time.` : 'Press start, then play the note you see.';
  $('verdictMain').className = 'verdict-main';
  renderStageHeader();
}

// ==================================================================== RHYTHM

const rhythm = { running: false, metro: null, expected: [], played: [], startTime: 0, raf: 0, endsAt: 0 };

function fillPatterns() {
  const sel = $('patternSelect');
  const allowed = stage.rhythm || Object.keys(RHYTHMS);
  sel.innerHTML = Object.entries(RHYTHMS)
    .map(([id, p]) => `<option value="${id}"${allowed.includes(id) ? '' : ' data-extra="1"'}>${p.title}${allowed.includes(id) ? '' : ' (beyond this stage)'}</option>`)
    .join('');
  sel.value = allowed[0];
}

$('bpmRange').addEventListener('input', (e) => { $('bpmOut').textContent = e.target.value; drawStrip(); });
$('patternSelect').addEventListener('change', drawStrip);
$('barsSelect').addEventListener('change', drawStrip);
$('latRange').addEventListener('input', (e) => {
  $('latOut').textContent = e.target.value;
  audio.latencyOffsetMs = Number(e.target.value);
});

function drawStrip(result = null) {
  const patternId = $('patternSelect').value;
  const bpm = Number($('bpmRange').value);
  const bars = Number($('barsSelect').value);
  const pat = RHYTHMS[patternId];
  if (!pat) return;
  const beat = 60 / bpm;
  const totalBeats = pat.meter[0] * bars;
  const total = totalBeats * beat;
  const expected = expectedOnsets(patternId, bpm, { bars });
  // Inset so a marker at t=0 is not sliced in half by the border.
  const pct = (t) => 4 + (t / total) * 92;

  const parts = [];
  for (let b = 0; b <= totalBeats; b++) {
    parts.push(`<div class="rs-beat${b % pat.meter[0] === 0 ? ' bar' : ''}" style="left:${pct(b * beat)}%"></div>`);
  }
  expected.forEach((t, i) => {
    let cls = '';
    if (result) {
      const m = result.matches[i];
      cls = m && m.played !== null ? ' hit' : ' miss';
    }
    parts.push(`<div class="rs-note${cls}" style="left:${pct(t)}%"></div>`);
  });
  if (result) {
    for (const p of rhythm.played) {
      if (p >= -0.2 && p <= total + 0.2) parts.push(`<div class="rs-played" style="left:${pct(Math.max(0, p))}%"></div>`);
    }
  }
  parts.push('<div class="rs-cursor" id="rsCursor" style="left:0%;display:none"></div>');
  $('rhythmStrip').innerHTML = parts.join('');
}

$('startRhythm').addEventListener('click', async () => {
  if (rhythm.running) return;
  if (!(await ensureAudio())) return;

  const patternId = $('patternSelect').value;
  const bpm = Number($('bpmRange').value);
  const bars = Number($('barsSelect').value);
  const pat = RHYTHMS[patternId];
  const beat = 60 / bpm;

  rhythm.running = true;
  rhythm.played = [];
  $('startRhythm').disabled = true;
  $('stopRhythm').disabled = false;
  $('timingPlot').hidden = true;

  const metro = new Metronome(audio.ctx);
  metro.beatsPerBar = pat.meter[0];
  rhythm.metro = metro;

  const COUNT_IN_BARS = 1;
  metro.start(bpm, { countInBars: COUNT_IN_BARS });
  // Beat 0 is the downbeat after the count-in.
  rhythm.startTime = metro.timeOfBeat(0);
  rhythm.expected = expectedOnsets(patternId, bpm, { bars, startAt: rhythm.startTime });
  rhythm.endsAt = rhythm.startTime + pat.meter[0] * bars * beat + 0.6;

  audio.resetTracking();
  $('rVerdictMain').textContent = 'Count-in…';
  $('rVerdictSub').textContent = '';
  drawStrip();

  const cursor = $('rsCursor');
  const total = pat.meter[0] * bars * beat;
  const tick = () => {
    if (!rhythm.running) return;
    const t = audio.now();
    if (cursor) {
      const rel = (t - rhythm.startTime) / total;
      cursor.style.display = rel >= 0 && rel <= 1 ? 'block' : 'none';
      cursor.style.left = `${4 + Math.max(0, Math.min(1, rel)) * 92}%`;
    }
    if (t > rhythm.startTime && $('rVerdictMain').textContent === 'Count-in…') {
      $('rVerdictMain').textContent = 'Playing…';
    }
    if (t >= rhythm.endsAt) { finishRhythm(); return; }
    rhythm.raf = requestAnimationFrame(tick);
  };
  tick();
});

$('stopRhythm').addEventListener('click', () => finishRhythm(true));

audio.onOnset = (tSeconds) => {
  if (!rhythm.running) return;
  // Already audio-clock seconds - the engine anchors the capture stream to the
  // audio clock on every reset, so this lines up with metronome beat times.
  rhythm.played.push(tSeconds);
};

function finishRhythm(aborted = false) {
  if (!rhythm.running) return;
  rhythm.running = false;
  cancelAnimationFrame(rhythm.raf);
  rhythm.metro?.stop();
  $('startRhythm').disabled = false;
  $('stopRhythm').disabled = true;

  if (aborted && rhythm.played.length === 0) {
    $('rVerdictMain').textContent = 'Stopped.';
    return;
  }

  const result = gradeTiming(rhythm.played, rhythm.expected);
  const main = $('rVerdictMain');
  const sub = $('rVerdictSub');

  if (result.hitCount === 0) {
    main.textContent = 'Nothing heard';
    main.className = 'verdict-main';
    sub.textContent = 'Check the microphone is picking you up — the level bar on the Read tab should move when you play.';
  } else {
    const words = {
      'in time': 'In time',
      'rushing': 'Rushing — you are ahead of the click',
      'dragging': 'Dragging — you are behind the click',
      'uneven': 'Uneven — no steady bias, just scattered',
    };
    main.textContent = words[result.verdict] || result.verdict;
    main.className = `verdict-main ${result.verdict === 'in time' ? 'good' : ''}`;
    const bits = [
      `${result.hitCount} of ${rhythm.expected.length} notes`,
      `typically ${result.meanAbsErrorMs} ms off`,
      `spread ${result.spreadMs} ms`,
    ];
    if (result.missed) bits.push(`${result.missed} missed`);
    if (result.extra) bits.push(`${result.extra} extra`);
    sub.textContent = bits.join(' · ');
    progress.recordRhythm({
      bpm: Number($('bpmRange').value),
      patternId: $('patternSelect').value,
      meanAbsErrorMs: result.meanAbsErrorMs,
      spreadMs: result.spreadMs,
      verdict: result.verdict,
    });
  }

  drawStrip(result);
  drawTimingPlot(result);
}

function drawTimingPlot(result) {
  const host = $('timingPlot');
  const errs = result.matches.map((m) => m.errorMs);
  if (!errs.some((e) => e !== null)) { host.hidden = true; return; }
  host.hidden = false;
  const scale = Math.max(60, ...errs.filter((e) => e !== null).map((e) => Math.abs(e)));
  host.innerHTML = errs.map((e) => {
    if (e === null) return '<div class="tp-bar" title="missed"></div>';
    const h = Math.min(50, (Math.abs(e) / scale) * 50);
    const top = e < 0 ? 50 - h : 50;
    return `<div class="tp-bar" title="${e > 0 ? '+' : ''}${Math.round(e)} ms"><span style="top:${top}%;height:${Math.max(2, h)}%"></span></div>`;
  }).join('');
}

// ================================================================== PROGRESS

function renderProgress() {
  const s = progress.summary();
  $('statsGrid').innerHTML = [
    ['Sessions', s.sessions],
    ['Notes asked', s.asked],
    ['Right first time', s.asked ? `${Math.round(s.accuracy * 100)}%` : '—'],
    ['Minutes', s.minutes],
    ['Day streak', s.currentStreak],
  ].map(([label, v]) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`).join('');

  renderHeatmap();

  const weak = progress.weakest(poolFor(stage), 5);
  $('weakList').innerHTML = weak.length
    ? weak.map(({ id, stat }) => {
        const { string, fret } = parsePositionId(id);
        const note = pitchClassName(soundingAt(string, fret));
        const why = stat.accuracy < 0.7 ? 'often wrong' : `slow (${(stat.avgMs / 1000).toFixed(1)}s)`;
        return `<li><strong>${note}</strong> — string ${string}, fret ${fret} · ${why}</li>`;
      }).join('')
    : '<li class="muted">Nothing is lagging behind. Either you are doing well or you have not played much yet.</li>';

  const check = readyToAdvance(stage, progress.data.stats);
  const nxt = nextStage(stage.id);
  $('advanceBox').innerHTML = check.ready
    ? (nxt
      ? `<p><strong>Ready for the next stage.</strong> ${nxt.title}.</p><button class="btn primary small" id="advanceBtn">Move on</button>`
      : '<p><strong>You have finished the whole plan.</strong> Keep the last stage running to stay sharp.</p>')
    : `<p class="muted">Not yet — ${check.reason}.</p>`;
  const btn = $('advanceBtn');
  if (btn) btn.addEventListener('click', () => {
    stage = nxt;
    progress.setStage(stage.id);
    renderStageHeader();
    fillPatterns();
    drawStrip();
    renderProgress();
  });

  $('stageList').innerHTML = STAGES.map((st, i) => {
    const done = readyToAdvance(st, progress.data.stats).ready;
    return `<div class="stage-row${st.id === stage.id ? ' current' : ''}">
      <span class="n">${i + 1}</span><span>${st.title}</span>
      ${done ? '<span class="done">✓</span>' : ''}</div>`;
  }).join('');
}

function renderHeatmap() {
  const inPool = new Set(poolFor(stage));
  const strings = stage.region.strings;
  const lo = stage.region.minFret;
  const hi = stage.region.maxFret;
  const rows = [...strings].sort((a, b) => a - b);
  let html = '<table class="heatmap"><tr><th></th>';
  for (let f = lo; f <= hi; f++) html += `<th>${f}</th>`;
  html += '</tr>';
  for (const s of rows) {
    html += `<tr><th>${s}</th>`;
    for (let f = lo; f <= hi; f++) {
      const pid = positionId(s, f);
      const st = progress.data.stats[pid];
      let cls = inPool.has(pid) ? '' : 'off';
      let text = '';
      if (st && st.attempts) {
        text = String(st.attempts);
        if (isFluent(st)) cls = 'good';
        else if (st.accuracy >= 0.75) cls = 'slow';
        else cls = 'bad';
      }
      const name = pitchClassName(soundingAt(s, f));
      const why = !inPool.has(pid)
        ? ' · not part of this stage'
        : st?.attempts
          ? ` · ${st.attempts} tries, ${Math.round(st.accuracy * 100)}%, ${(st.avgMs / 1000).toFixed(1)}s`
          : ' · not asked yet';
      html += `<td><div class="hm-cell ${cls}" title="${name} · string ${s} fret ${f}${why}">${text}</div></td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  $('heatmapHost').innerHTML = html;
}

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([progress.export()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `openstring-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    progress.import(await file.text());
    stage = stageById(progress.data.stageId || STAGES[0].id);
    renderStageHeader();
    renderProgress();
  } catch (err) {
    alert(`That file could not be read: ${err.message}`);
  }
  e.target.value = '';
});

$('resetBtn').addEventListener('click', () => {
  if (!confirm('Erase all progress on this machine? This cannot be undone.')) return;
  progress.reset();
  stage = STAGES[0];
  renderStageHeader();
  renderProgress();
});

// ================================================================ first run

// The welcome doubles as the landing page. Shown when there is no history yet,
// or on demand from the "?" button. A stranger arriving from a link needs to know
// what this is, that it wants a microphone and why, and that nothing is uploaded -
// before a permission prompt appears, not after.
const welcome = $('welcome');

function showWelcome() {
  $('unsupported').hidden = audio.supported;
  welcome.hidden = false;
  document.body.style.overflow = 'hidden';
}

function hideWelcome() {
  welcome.hidden = true;
  document.body.style.overflow = '';
  progress.data.seenWelcome = true;
  progress.save();
}

$('welcomeStart').addEventListener('click', async () => {
  hideWelcome();
  // Go straight into a session: the button promised a start, so start.
  if (!read.active) $('startRead').click();
});
$('welcomeSkip').addEventListener('click', hideWelcome);
$('helpBtn').addEventListener('click', showWelcome);

/** Warn if progress cannot actually be saved - private browsing, full quota. */
function checkStorage() {
  const el = $('storageWarn');
  if (progress.save()) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = 'This browser is not letting the page save anything, so your progress '
    + 'will vanish when you close the tab. Private browsing usually causes this.';
}

// ===================================================================== init

if (!progress.data.seenWelcome && progress.data.sessions.length === 0) showWelcome();
checkStorage();
renderStageHeader();
fillPatterns();
drawStrip();
$('bpmOut').textContent = $('bpmRange').value;
