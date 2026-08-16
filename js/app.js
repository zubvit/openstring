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
import { initPieceView } from './piece-view.js';
import { Sync } from './sync.js';
import { initI18n, setLocale, getLocale, availableLocales, applyToDom, t } from './i18n.js';

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
  setMic('', t('mic.starting'));
  try {
    await audio.start();
    setMic('live', t(audio.captureMode === 'worklet' ? 'mic.listening' : 'mic.fallback'));
    $('latRange').value = String(audio.latencyOffsetMs);
    $('latOut').textContent = String(audio.latencyOffsetMs);
    return true;
  } catch (err) {
    setMic('error', t('mic.unavailable'));
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
  $('stageTitle').textContent = t(`stage.${stage.id}.title`);
  $('stageBlurb').textContent = t(`stage.${stage.id}.blurb`);
  $('stageAdvice').textContent = t(`stage.${stage.id}.advice`);
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
  $('verdictMain').textContent = t('read.playIt');
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
    main.textContent = t('read.correct', { note: pitchClassName(target) });
    main.className = 'verdict-main good';
    const tuning = Math.abs(cents) > 25 ? ` · ${t(cents > 0 ? 'read.sharp' : 'read.flat')} (${cents > 0 ? '+' : ''}${cents})` : '';
    sub.textContent = t('read.seconds', { seconds: (ms / 1000).toFixed(1) }) + tuning;
  } else {
    main.textContent = t('read.wrong', { heard: noteName(heardMidi), wanted: pitchClassName(target) });
    main.className = 'verdict-main bad';
    sub.textContent = sameClass
      ? t('read.wrongOctave')
      : t('read.whereItWas', { string: read.target.string, fret: read.target.fret });
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
  $('startRead').textContent = t('read.pause');
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
  $('startRead').textContent = t('read.start');
  $('skipNote').disabled = true;
  $('verdictMain').textContent = read.asked
    ? t('read.sessionDone', { correct: read.correct, asked: read.asked })
    : t('read.prompt');
  $('verdictMain').className = 'verdict-main';
  renderStageHeader();
}

// ==================================================================== RHYTHM

const rhythm = { running: false, metro: null, expected: [], played: [], startTime: 0, raf: 0, endsAt: 0 };

function fillPatterns() {
  const sel = $('patternSelect');
  const allowed = stage.rhythm || Object.keys(RHYTHMS);
  sel.innerHTML = Object.entries(RHYTHMS)
    .map(([id]) => {
      const title = t(`rhythmPattern.${id}`);
      const label = allowed.includes(id) ? title : t('rhythmPattern.beyondStage', { title });
      return `<option value="${id}">${label}</option>`;
    })
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
  $('rVerdictMain').textContent = t('rhythm.countingIn');
  $('rVerdictSub').textContent = '';
  drawStrip();

  const cursor = $('rsCursor');
  const total = pat.meter[0] * bars * beat;
  const tick = () => {
    if (!rhythm.running) return;
    const tNow = audio.now();
    if (cursor) {
      const rel = (tNow - rhythm.startTime) / total;
      cursor.style.display = rel >= 0 && rel <= 1 ? 'block' : 'none';
      cursor.style.left = `${4 + Math.max(0, Math.min(1, rel)) * 92}%`;
    }
    if (tNow > rhythm.startTime && $('rVerdictMain').textContent === t('rhythm.countingIn')) {
      $('rVerdictMain').textContent = t('rhythm.playing');
    }
    if (tNow >= rhythm.endsAt) { finishRhythm(); return; }
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
    $('rVerdictMain').textContent = t('rhythm.stopped');
    return;
  }

  const result = gradeTiming(rhythm.played, rhythm.expected);
  const main = $('rVerdictMain');
  const sub = $('rVerdictSub');

  if (result.hitCount === 0) {
    main.textContent = t('rhythm.nothingHeard');
    main.className = 'verdict-main';
    sub.textContent = t('rhythm.nothingHeardWhy');
  } else {
    const verdictKey = { 'in time': 'rhythm.inTime', rushing: 'rhythm.rushing', dragging: 'rhythm.dragging', uneven: 'rhythm.uneven' }[result.verdict];
    main.textContent = verdictKey ? t(verdictKey) : result.verdict;
    main.className = `verdict-main ${result.verdict === 'in time' ? 'good' : ''}`;
    const bits = [
      t('rhythm.noteCount', { count: result.hitCount, total: rhythm.expected.length }),
      t('rhythm.typicallyOff', { ms: result.meanAbsErrorMs }),
      t('rhythm.spread', { ms: result.spreadMs }),
    ];
    if (result.missed) bits.push(t('rhythm.missed', { count: result.missed }));
    if (result.extra) bits.push(t('rhythm.extra', { count: result.extra }));
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
  const nudge = $('backupNudge');
  nudge.hidden = !progress.needsBackup();
  if (!nudge.hidden) {
    nudge.textContent = t('data.backupNudge');
  }
  $('statsGrid').innerHTML = [
    [t('progress.sessions'), s.sessions],
    [t('progress.notesAsked'), s.asked],
    [t('progress.rightFirstTime'), s.asked ? `${Math.round(s.accuracy * 100)}%` : '—'],
    [t('progress.minutes'), s.minutes],
    [t('progress.dayStreak'), s.currentStreak],
  ].map(([label, v]) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`).join('');

  renderHeatmap();

  const weak = progress.weakest(poolFor(stage), 5);
  $('weakList').innerHTML = weak.length
    ? weak.map(({ id, stat }) => {
        const { string, fret } = parsePositionId(id);
        const note = pitchClassName(soundingAt(string, fret));
        const why = stat.accuracy < 0.7 ? t('progress.oftenWrong') : t('progress.slow', { seconds: (stat.avgMs / 1000).toFixed(1) });
        return `<li><strong>${note}</strong> — ${t('progress.weakItem', { string, fret })} · ${why}</li>`;
      }).join('')
    : `<li class="muted">${t('progress.weakNone')}</li>`;

  const check = readyToAdvance(stage, progress.data.stats);
  const nxt = nextStage(stage.id);
  $('advanceBox').innerHTML = check.ready
    ? (nxt
      ? `<p><strong>${t('progress.readyNext')}</strong> ${t(`stage.${nxt.id}.title`)}.</p><button class="btn primary small" id="advanceBtn">${t('progress.moveOn')}</button>`
      : `<p><strong>${t('progress.finishedPlan')}</strong></p>`)
    : `<p class="muted">${t('progress.notYet', { reason: t(check.reasonKey, check.reasonVars) })}</p>`;
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
      <span class="n">${i + 1}</span><span>${t(`stage.${st.id}.title`)}</span>
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
    alert(t('data.importFailed', { message: err.message }));
  }
  e.target.value = '';
});

$('resetBtn').addEventListener('click', () => {
  if (!confirm(t('data.eraseConfirm'))) return;
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
  el.textContent = t('data.storageBlocked');
}

// ====================================================================== sync

const sync = new Sync(progress);

function renderSync() {
  const inEl = $('syncIn');
  const outEl = $('syncOut');
  inEl.hidden = !sync.signedIn;
  outEl.hidden = sync.signedIn;
  if (sync.signedIn) {
    $('syncWho').textContent = sync.email || '—';
    const when = sync.lastSync();
    $('syncWhen').textContent = when
      ? t('sync.lastSynced', { when: new Date(when).toLocaleString(getLocale()) })
      : t('sync.neverSynced');
  }
}

function syncMsg(id, text, ok) {
  const el = $(id);
  el.hidden = false;
  el.textContent = text;
  el.className = `sync-msg ${ok ? 'ok' : 'bad'}`;
}

$('syncSend').addEventListener('click', async () => {
  const email = $('syncEmail').value.trim();
  if (!email) return;
  $('syncSend').disabled = true;
  try {
    syncMsg('syncMsg', await sync.requestLink(email), true);
  } catch (e) {
    syncMsg('syncMsg', e.message, false);
  } finally {
    $('syncSend').disabled = false;
  }
});

$('syncPush').addEventListener('click', async () => {
  try { await sync.push(); syncMsg('syncMsg2', t('sync.pushed'), true); renderSync(); }
  catch (e) { syncMsg('syncMsg2', e.message, false); renderSync(); }
});

$('syncPull').addEventListener('click', async () => {
  if (!confirm(t('sync.pullConfirm'))) return;
  try {
    await sync.pull();
    syncMsg('syncMsg2', t('sync.pulled'), true);
    setTimeout(() => location.reload(), 700);
  } catch (e) { syncMsg('syncMsg2', e.message, false); renderSync(); }
});

$('syncOutBtn').addEventListener('click', async () => {
  await sync.signOut();
  renderSync();
});

sync.onChange = renderSync;

function adoptSessionFromUrl() {
  if (!sync.captureFromUrl()) return;
  // Arrived from a magic link: pull whatever is stored so the device is current.
  sync.pull()
    .then(() => syncMsg('syncMsg2', t('sync.signedIn'), true))
    .catch((e) => syncMsg('syncMsg2', e.message, false))
    .finally(() => { renderSync(); renderProgress(); });
}

adoptSessionFromUrl();
// A magic link opened in a tab ALREADY showing the app only changes the fragment,
// which does not reload the page - so the token would never be seen without this.
window.addEventListener('hashchange', adoptSessionFromUrl);

// ==================================================================== pieces
// Started only once translations are loaded - see the boot block below.

// ================================================================ language

function buildLanguagePicker() {
  const sel = $('langSelect');
  sel.innerHTML = availableLocales()
    .map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
  sel.value = getLocale();
  sel.addEventListener('change', () => setLocale(sel.value));
}

// Everything whose text is generated in JavaScript redraws on a language change.
window.addEventListener('localechange', () => {
  const sel = $('langSelect');
  if (sel) sel.value = getLocale();
  renderStageHeader();
  fillPatterns();
  drawStrip();
  renderSync();
  renderProgress();
  window.dispatchEvent(new CustomEvent('openstring:redraw'));
});

// ===================================================================== init

if (!progress.data.seenWelcome && progress.data.sessions.length === 0) showWelcome();
checkStorage();

// Translations must land before anything renders, or the first paint is English
// and then visibly flips - which looks broken in every language but English.
initI18n().then(() => {
  applyToDom();
  buildLanguagePicker();
  initPieceView({ audio, ensureAudio });
  renderSync();
  renderStageHeader();
  fillPatterns();
  drawStrip();
  $('bpmOut').textContent = $('bpmRange').value;
}).catch(() => {
  // Even if catalogues fail entirely, the built-in English markup still works.
  initPieceView({ audio, ensureAudio });
  renderSync();
  renderStageHeader();
  fillPatterns();
  drawStrip();
  $('bpmOut').textContent = $('bpmRange').value;
});
