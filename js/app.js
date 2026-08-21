// Openstring - wiring the drills to the audio engine and the progress store.

import { AudioEngine, Metronome, outputContext, playChord } from './audio.js';
import { AnswerGate } from './pitch.js';
import { Tuner, tapTempo, readingView, STRING_ORDER } from './tuner.js';
import { ROOTS, QUALITY_ORDER, shapesFor, shapeNotes, chordToneNames, chordName } from './chords.js';
import { targetFor, ChordAttempt, ChordProgress, DRILL_POOL } from './chord-drill.js';
import { buildMelody, IntervalProgress, intervalKey } from './intervals.js';
import { STANDARD_TUNING } from './theory.js';
import {
  soundingAt, writtenAt, hzToMidiFloat, centsFromTarget, noteName, pitchClassName, compareNote,
  positionId, parsePositionId, positionsFor, midiToHz,
} from './theory.js';
import { renderNote, renderPhrase, renderFretboard, renderChordBox, renderChordStack } from './staff.js';
import { pickNext, isFluent, emptyStat, recentForm } from './srs.js';
import { Progress } from './progress.js';
import { STAGES, stageById, nextStage, poolFor, readyToAdvance, unlockedStages, RHYTHMS, expectedOnsets } from './curriculum.js';
import { gradeTiming } from './onset.js';
import { initPieceView } from './piece-view.js';
import { Sync } from './sync.js';
import { initI18n, setLocale, getLocale, availableLocales, applyToDom, t } from './i18n.js';

const $ = (id) => document.getElementById(id);

// Translations are data from a file; nothing here builds markup out of them
// without going through this first.
const esc = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const progress = new Progress();
const audio = new AudioEngine();
let pieceView = null;
let stage = stageById(progress.data.stageId || STAGES[0].id);

// ------------------------------------------------------------------ tabs

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${tab.dataset.view}`));
    if (tab.dataset.view === 'progress') renderProgress();
    // Leaving the tools tab shuts them both down. A metronome still ticking
    // behind a drill would fight the drill's own metronome, and a tuner still
    // holding the wide analysis window would slow the drills down.
    if (tab.dataset.view !== 'tools') { stopTuning(); stopMetro(); }
    if (tab.dataset.view !== 'chords') stopChordDrill();
    // And the reading drill, which was the one that never stopped. It listens
    // through the same microphone as everything else, so a session left running
    // behind the rhythm drill or a piece was quietly marking every note played
    // there as an answer to a question on a screen he could not see - and
    // marking most of them wrong. It also heard the rhythm drill's metronome.
    if (tab.dataset.view !== 'read' && read.active) endReadSession();
    // The rhythm exercise and the piece drill were the last two that carried on
    // behind your back. Both keep a metronome running, and the microphone hears
    // it - so a click track was still sounding into whatever you switched to.
    if (tab.dataset.view !== 'rhythm' && rhythm.running) finishRhythm(true);
    if (tab.dataset.view !== 'piece') pieceView?.stop();
    releaseAudioIfIdle();
  });
});

function setMic(state, label) {
  const el = $('micState');
  el.classList.toggle('live', state === 'live');
  el.classList.toggle('error', state === 'error');
  $('micLabel').textContent = label;
}

/**
 * Open the microphone, and put any refusal in front of whoever asked for it.
 *
 * It used to write the reason into the reading drill's verdict line whatever
 * had asked - so a refusal while starting the tuner or a chord drill left the
 * mic indicator red and the explanation sitting on a tab he was not looking at.
 */
async function ensureAudio({ onError = null } = {}) {
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
    if (onError) onError(err.message);
    return false;
  }
}

/** Show a failure on one of the drill verdict lines. */
function verdictError(id) {
  return (message) => {
    const el = $(id);
    if (!el) return;
    el.textContent = message;
    el.className = 'verdict-main bad';
  };
}

/**
 * Hand the microphone back when no drill wants it.
 *
 * Nothing ever called audio.stop(). Once you granted permission, the recording
 * light stayed on for as long as the page was open and the pitch detector kept
 * running on every animation frame - analysing the room, forever, while you sat
 * on the Progress tab. On a laptop that is rude; on a phone it is the battery.
 *
 * Run as one watchdog rather than a call at the end of each stop path, because
 * there are six of those and the seventh would have been forgotten.
 */
function releaseAudioIfIdle() {
  if (!audio.running) return;
  const busy = read.active || chordDrill.active || tune.active
    || rhythm.running || !!pieceView?.isRunning();
  if (busy) return;
  audio.stop();
  setMic('', t('mic.off'));
}

setInterval(releaseAudioIfIdle, 20000);

// =================================================================== READING

// How many recent notes the card reports on. Long enough to be steady, short
// enough that a good run visibly moves it.
const RECENT_WINDOW = 20;

// Practice stops when you walk away, but the app used to keep the session open
// and keep the current note's clock running - so the note you happened to be on
// when the phone rang got recorded as having taken twenty minutes to find.
const IDLE_MS = 3 * 60 * 1000;

const read = {
  active: false,
  target: null,      // { string, fret, sounding, written }
  shownAt: 0,
  graceUntil: 0,
  judged: false,      // resolved: found it, or skipped
  attempts: 0,        // wrong tries at THIS note
  gate: new AnswerGate(),   // tells an answer apart from the last note still ringing
  // A question is a phrase. In the ordinary drill it is one note long; with
  // melodies switched on it is a few, read left to right. Everything below
  // works the same way for both, which is why there is only one of it.
  phrase: [],         // position ids
  step: 0,            // which one is being looked for
  states: {},         // notehead index -> 'correct' | 'wrong'
  melody: null,       // { notes, intervals } when this phrase is a tune
  intervalProgress: new IntervalProgress(),
  // One entry per note resolved, newest last. The card reads the tail of this
  // rather than totals, so it shows how the last few minutes went.
  recent: [],
  octavesThisNote: 0,
  lastActivity: 0,
  idleTimer: 0,
  asked: 0,
  correct: 0,
  times: [],
  startedAt: 0,
  lastId: null,
};

function renderStageHeader() {
  renderStagePicker();
  $('stageBlurb').textContent = t(`stage.${stage.id}.blurb`);
  $('stageAdvice').textContent = t(`stage.${stage.id}.advice`);
  const pct = Math.round(progress.mastery(poolFor(stage)) * 100);
  $('masteryRing').style.setProperty('--pct', pct);
  $('masteryPct').textContent = `${pct}%`;
}

/**
 * The plan, where you practise rather than only in the Progress tab.
 *
 * Skip was never navigation - it is an escape hatch that records the note as a
 * miss - and the plan was only visible on another screen, reachable one way,
 * forwards. So there was no sense of being two of seven through anything.
 *
 * Stages you have reached are selectable; ones you have not earned are shown
 * but disabled, because seeing what is coming is useful and jumping into it is
 * not. The gate is the product: an app that decides what to drill next stops
 * deciding the moment you can pick anything from a list.
 */
function renderStagePicker() {
  const sel = $('stageSelect');
  const rows = unlockedStages(stage.id, progress.data.stats);
  const here = rows.find((r) => r.current);

  $('stagePos').textContent = t('read.stageOf', { n: (here?.index ?? 0) + 1, total: rows.length });
  sel.innerHTML = rows.map(({ stage: st, index, done, unlocked }) => {
    const label = `${index + 1} · ${t(`stage.${st.id}.title`)}`
      + (done ? ' \u2713' : '')
      + (unlocked ? '' : ` \u2014 ${t('progress.locked')}`);
    return `<option value="${st.id}"${unlocked ? '' : ' disabled'}${st.id === stage.id ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

$('stageSelect').addEventListener('change', () => {
  const picked = stageById($('stageSelect').value);
  if (!picked || picked.id === stage.id) return;
  stage = picked;
  progress.setStage(stage.id);
  renderStageHeader();
  fillPatterns();
  drawStrip();
  // Mid-session, the next question simply comes from the new region rather than
  // throwing away the sitting.
  if (read.active) nextQuestion();
});

/**
 * The staff, with its clef and nothing on it.
 *
 * Shown before a session starts. An empty white box reads as a broken app, and
 * the staff is the one thing this whole program is about - it should be the
 * first thing you see, not something that appears once you press a button.
 */
function showEmptyStaff() {
  $('staffHost').innerHTML = renderNote(null, { label: '' });
}

function nextQuestion() {
  const pool = poolFor(stage);

  // With melodies on, the question is a short tune whose distances the
  // scheduler chose. If the region is too small or too awkward to make one -
  // three landmarks a fourth apart, for instance - fall back to a single note
  // rather than forcing a phrase that breaks the melodic rules.
  read.melody = $('readMelody').checked
    ? buildMelody(pool, read.intervalProgress.stats)
    : null;

  if (read.melody) {
    read.phrase = read.melody.notes;
  } else {
    const id = pickNext(pool, progress.data.stats, { avoid: read.lastId });
    read.phrase = [id];
  }

  read.lastId = read.phrase[read.phrase.length - 1];
  read.step = 0;
  read.states = {};
  read.shownAt = performance.now();
  read.stepAt = read.shownAt;
  // Ignore the tail of the previous note still ringing into the microphone.
  read.graceUntil = read.shownAt + 350;
  read.judged = false;
  read.attempts = 0;
  // Whatever was just played is still sounding; it must not be read as an
  // answer to the question that has only this second appeared.
  read.gate.reset(read.lastAnswered);
  audio.resetTracking();

  setTargetFromStep();
  drawQuestion();
  $('verdictMain').textContent = t(read.melody ? 'read.playFromLeft' : 'read.playIt');
  $('verdictMain').className = 'verdict-main';
  $('verdictSub').textContent = '';
  updateHint();
}

/** The note currently being looked for, in the form the rest of the app wants. */
function setTargetFromStep() {
  const id = read.phrase[read.step];
  if (!id) { read.target = null; return; }
  const { string, fret } = parsePositionId(id);
  read.target = { string, fret, sounding: soundingAt(string, fret), written: writtenAt(string, fret) };
}

function drawQuestion() {
  if (!read.phrase.length) { showEmptyStaff(); return; }
  if (read.phrase.length === 1) {
    const state = read.states[0] || '';
    $('staffHost').innerHTML = renderNote(read.target?.written ?? null, { label: '', state });
    return;
  }
  const notes = read.phrase.map((id, i) => {
    const { string, fret } = parsePositionId(id);
    return { written: writtenAt(string, fret), beat: i, beats: 1, isRest: false };
  });
  $('staffHost').innerHTML = renderPhrase(notes, { width: 460, states: read.states });
}

function updateHint() {
  const host = $('hintHost');
  if (!$('showHint').checked || !read.target) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  host.innerHTML = renderFretboard({
    minFret: stage.region.minFret,
    maxFret: Math.max(stage.region.minFret + 3, stage.region.maxFret),
    mark: { string: read.target.string, fret: read.target.fret },
  });
}
$('showHint').addEventListener('change', updateHint);

/**
 * Judge one played note against the note the phrase is waiting for.
 *
 * A wrong answer does NOT move the question on. It used to: the app named the
 * note, drew the fretboard with the answer on it, and went to the next one -
 * so the moment you were about to learn something was the moment it did the
 * work for you. The only help now is which way to go, which turns a wrong
 * answer into a search; naming the note just ends it.
 */
function judge(heardMidi, hz) {
  if (!read.target || read.judged) return;

  const target = read.target.sounding;
  const { verdict, direction } = compareNote(target, heardMidi);
  const main = $('verdictMain');
  const sub = $('verdictSub');

  if (verdict !== 'right') {
    read.attempts += 1;
    // Hunting for a note IS practising. Without this the idle timer could close
    // the session while he was still playing, just not finding it.
    read.lastActivity = performance.now();
    if (verdict === 'octave') read.octavesThisNote += 1;
    read.states[read.step] = 'wrong';
    main.textContent = t(verdict === 'octave' ? 'read.rightNoteWrongString' : 'read.notThatOne',
      { heard: noteName(heardMidi) });
    main.className = 'verdict-main bad';
    sub.textContent = t(direction === 'higher' ? 'read.tryHigher' : 'read.tryLower');
    drawQuestion();
    // Put the mark back: the question is still standing.
    setTimeout(() => {
      if (read.active && !read.judged && read.states[read.step] === 'wrong') {
        delete read.states[read.step];
        drawQuestion();
      }
    }, 450);
    return;
  }

  // Found it. One record per note, however many tries it took - the scheduler
  // wants to know whether you knew it, not how many notes you played hunting.
  const ms = performance.now() - read.stepAt;
  const clean = read.attempts === 0;
  read.states[read.step] = 'correct';
  read.asked += 1;
  read.lastAnswered = target;
  read.gate.mute(target);
  read.lastActivity = performance.now();
  read.recent.push({ clean, ms, octaves: read.octavesThisNote });
  if (read.recent.length > 200) read.recent = read.recent.slice(-200);
  if (clean) { read.correct += 1; read.times.push(ms); }
  progress.recordAnswer(positionId(read.target.string, read.target.fret), { correct: clean, ms });

  // In a melody, the note you just found was reached by a distance, and that
  // distance is the thing being practised - so it is scored separately, on its
  // own scheduler. The first note has no distance behind it.
  const crossed = read.melody && read.step > 0 ? read.melody.intervals[read.step - 1] : null;
  if (crossed) read.intervalProgress.record(crossed.id, { correct: clean, ms });

  main.textContent = t(clean ? 'read.correct' : 'read.foundIt', { note: pitchClassName(target) });
  main.className = 'verdict-main good';
  const cents = centsFromTarget(hz, target);
  const tuning = Math.abs(cents) > 25 ? ` · ${t(cents > 0 ? 'read.sharp' : 'read.flat')} (${cents > 0 ? '+' : ''}${cents})` : '';
  sub.textContent = crossed
    // Naming the distance AFTER the note is found teaches the word without
    // answering the question with it.
    ? `${t(intervalKey(crossed.number))} ${t(`interval.${crossed.direction}`)}`
    : t('read.seconds', { seconds: (ms / 1000).toFixed(1) }) + tuning;

  read.step += 1;
  read.attempts = 0;
  read.octavesThisNote = 0;
  read.stepAt = performance.now();

  if (read.step < read.phrase.length) {
    setTargetFromStep();
    drawQuestion();
    updateHint();
    updateSessionCard();
    return;
  }

  // The phrase is finished.
  read.judged = true;
  drawQuestion();
  if (read.melody) {
    main.textContent = t('read.phraseDone');
    main.className = 'verdict-main good';
    sub.textContent = '';
  }
  updateSessionCard();
  renderStageHeader();
  setTimeout(() => { if (read.active) nextQuestion(); }, read.melody ? 1200 : (clean ? 750 : 1100));
}

function updateSessionCard() {
  $('sessionCard').hidden = read.asked === 0;

  const form = recentForm(read.recent, { window: RECENT_WINDOW });
  $('sRecentLabel').textContent = t('read.recentRight', { n: form.window });
  $('sCorrect').textContent = `${form.clean} / ${form.count}`;
  $('sSpeed').textContent = form.medianMs ? `${(form.medianMs / 1000).toFixed(1)}s` : '\u2014';

  // Only worth showing when it is happening.
  $('sSlipsRow').hidden = form.octaveSlips === 0;
  $('sSlips').textContent = String(form.octaveSlips);

  $('sAsked').textContent = String(read.asked);
}

audio.onPitch = (stable, raw) => {
  feedTuner(raw);
  feedChordDrill(stable);
  // Tuner + level readout, live regardless of drill state.
  if (raw) {
    const m = Math.round(hzToMidiFloat(raw.hz));
    $('heardNote').textContent = noteName(m);
    const cents = centsFromTarget(raw.hz, m);
    $('tunerNeedle').style.left = `${50 + Math.max(-50, Math.min(50, cents)) }%`;
  }
  if (!read.active || read.judged) return;
  if (performance.now() < read.graceUntil) return;
  // The gate does two jobs: it drops the tail of the note just answered, which
  // otherwise arrives as a wrong answer to the next question before a string is
  // touched, and it counts a held note once rather than sixty times a second.
  const heard = read.gate.accept(stable ? Math.round(hzToMidiFloat(stable.hz)) : null);
  if (heard == null) return;
  judge(heard, stable.hz);
};

audio.onLevel = (r) => {
  $('levelFill').style.width = `${Math.min(100, r * 900)}%`;
};

$('startRead').addEventListener('click', async () => {
  if (read.active) {
    endReadSession();
    return;
  }
  if (!(await ensureAudio({ onError: verdictError('verdictMain') }))) return;
  read.active = true;
  read.asked = 0; read.correct = 0; read.times = []; read.recent = [];
  read.octavesThisNote = 0;
  // Nothing is ringing from a session that ended minutes ago; carrying the note
  // over would make the first question ignore it if it came up again.
  read.lastAnswered = null;
  read.gate.reset(null);
  read.startedAt = Date.now();
  read.startedPerf = performance.now();
  read.stageAtStart = stage.id;
  read.lastActivity = read.startedPerf;
  startIdleWatch();
  $('startRead').textContent = t('read.pause');
  $('skipNote').disabled = false;
  nextQuestion();
});

$('skipNote').addEventListener('click', () => {
  if (!read.active) return;
  if (read.target && !read.judged) {
    progress.recordAnswer(positionId(read.target.string, read.target.fret), { correct: false, ms: 8000 });
    read.asked += 1;
    read.recent.push({ clean: false, ms: 8000, octaves: read.octavesThisNote });
    read.lastActivity = performance.now();
    updateSessionCard();
  }
  nextQuestion();
});

// Switching melodies on or off starts a fresh question rather than half
// changing the one on screen.
$('readMelody').addEventListener('change', () => {
  if (read.active) nextQuestion();
});

$('endSession').addEventListener('click', endReadSession);

function endReadSession({ idle = false } = {}) {
  stopIdleWatch();
  if (read.asked > 0) {
    progress.recordSession({
      // Measured to the last note played, not to now: a session that ended
      // because he walked away did not last however long he was gone.
      ms: Math.max(0, (read.lastActivity || performance.now()) - read.startedPerf),
      asked: read.asked, correct: read.correct, stageId: read.stageAtStart || stage.id,
    });
  }
  read.active = false;
  read.target = null;
  read.phrase = [];
  read.melody = null;
  read.states = {};
  $('startRead').textContent = t('read.start');
  $('skipNote').disabled = true;
  $('verdictMain').textContent = idle
    ? t('read.endedIdle')
    : (read.asked ? t('read.sessionDone', { correct: read.correct, asked: read.asked }) : t('read.prompt'));
  $('verdictMain').className = 'verdict-main';
  // The old "keep looking" line used to survive the end of the session and sit
  // under the summary telling him to hunt for a note that was no longer there.
  $('verdictSub').textContent = '';
  // Leave the staff empty rather than showing the last answer indefinitely.
  showEmptyStaff();
  $('hintHost').hidden = true;
  renderStageHeader();
}

function startIdleWatch() {
  stopIdleWatch();
  read.idleTimer = setInterval(() => {
    if (!read.active) return stopIdleWatch();
    if (performance.now() - read.lastActivity > IDLE_MS) endReadSession({ idle: true });
  }, 15000);
}

function stopIdleWatch() {
  if (read.idleTimer) clearInterval(read.idleTimer);
  read.idleTimer = 0;
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
  if (!(await ensureAudio({ onError: verdictError('rVerdictMain') }))) return;

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
  $('rVerdictMain').textContent = t('drill.countingIn');
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
    if (tNow > rhythm.startTime && $('rVerdictMain').textContent === t('drill.countingIn')) {
      $('rVerdictMain').textContent = t('drill.playing');
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
    $('rVerdictMain').textContent = t('drill.stopped');
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

// ==================================================================== TOOLS
//
// A tuner and a metronome. Neither teaches anything, so by the rule this project
// works to they would not earn their place - except that they are what you reach
// for before the first note of every session, and both were already sitting in
// the codebase serving the drills. Not exposing them was the odd choice.

// -------------------------------------------------------------- the tuner

const tune = {
  active: false,
  engine: new Tuner(),
  mode: 'guitar',
};

// The drills read a 2048-sample window because they must notice a note change
// quickly. A tuner has no such hurry and a low E needs the room.
const TUNE_WINDOW = 4096;
const DRILL_WINDOW = 2048;

function buildStringRow() {
  const row = $('stringRow');
  if (!row) return;
  row.innerHTML = STRING_ORDER.map((n) => {
    const name = noteName(STANDARD_TUNING[n]).replace(/\d+$/, '');
    return `<div class="string-pill" data-string="${n}">` +
           `<span class="sp-name">${name}</span><span class="sp-num">${n}</span></div>`;
  }).join('');
}

function paintStringRow(heard) {
  document.querySelectorAll('.string-pill').forEach((el) => {
    const n = Number(el.dataset.string);
    el.classList.toggle('is-heard', tune.active && heard === n);
    el.classList.toggle('is-done', tune.engine.settled.has(n));
  });
  $('resetTune').disabled = tune.engine.settled.size === 0;
}

function paintTuner(reading) {
  const view = readingView(reading);
  const needle = $('tuneNeedle');
  const verdict = $('tuneVerdict');

  $('tuneNote').textContent = view.note;
  $('tuneCents').textContent = view.cents;
  needle.style.left = `${view.needlePct}%`;
  needle.className = view.needleClass;
  verdict.textContent = t(view.verdictKey || (tune.active ? 'tools.waiting' : 'tools.pressStart'));
  verdict.className = view.verdictClass;

  paintStringRow(view.string);
}

async function startTuning() {
  if (tune.active) { stopTuning(); return; }
  if (read.active) endReadSession();
  stopChordDrill();
  const failed = (message) => {
    $('tuneVerdict').textContent = message;
    $('tuneVerdict').className = 'tune-verdict bad';
  };
  if (!(await ensureAudio({ onError: failed }))) return;
  audio.setAnalysisWindow(TUNE_WINDOW);
  tune.engine.clearNote();
  tune.active = true;
  $('startTune').textContent = t('tools.stop');
  paintTuner(null);
}

function stopTuning() {
  if (!tune.active) return;
  tune.active = false;
  audio.setAnalysisWindow(DRILL_WINDOW);
  tune.engine.clearNote();
  const btn = $('startTune');
  if (btn) btn.textContent = t('tools.start');
  paintTuner(null);
}

$('startTune').addEventListener('click', startTuning);
$('resetTune').addEventListener('click', () => {
  tune.engine.reset();
  paintTuner(tune.active ? null : null);
});

document.querySelectorAll('input[name="tuneMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    tune.mode = r.value;
    tune.engine.mode = r.value;
    tune.engine.clearNote();
    paintTuner(null);
  });
});

/** Called from the shared pitch callback below. */
function feedTuner(raw) {
  if (!tune.active) return;
  paintTuner(tune.engine.push(raw ? raw.hz : null, performance.now()));
}

// ============================================================ READING CHORDS
//
// The one thing here that is not a reference: several notes at once on the
// staff, played one string at a time so the microphone can actually judge
// them. Nootka reads single notes; nothing he has reads a stack.

const chordDrill = {
  active: false,
  progress: new ChordProgress(),
  target: null,
  attempt: null,
  shownAt: 0,
  gate: new AnswerGate(),   // same job as the reading drill's: ignore the ringing tail
  lastName: null,
  asked: 0,
  clean: 0,
  times: [],
};

function drawChordQuestion() {
  const states = chordDrill.attempt ? chordDrill.attempt.states : {};
  $('chordStaffHost').innerHTML = chordDrill.target
    ? renderChordStack(chordDrill.target.written, { states, width: 280 })
    : renderChordStack([], { width: 280 });
  updateChordHint();
}

function updateChordHint() {
  const host = $('chordHintHost');
  const wanted = $('showShape').checked && chordDrill.target;
  host.hidden = !wanted;
  host.innerHTML = wanted ? renderChordBox(chordDrill.target.shape) : '';
}

function nextChord() {
  const name = chordDrill.progress.next({ avoid: chordDrill.lastName });
  chordDrill.target = targetFor(name);
  chordDrill.lastName = name;
  chordDrill.attempt = new ChordAttempt(chordDrill.target);
  chordDrill.shownAt = performance.now();
  chordDrill.gate.reset(chordDrill.lastAnswered);
  $('cVerdictMain').textContent = t('chords.waiting');
  $('cVerdictMain').className = 'verdict-main';
  $('cVerdictSub').textContent = '';
  drawChordQuestion();
}

function judgeChordNote(midi) {
  const a = chordDrill.attempt;
  if (!a || a.done) return;
  const { verdict } = a.play(midi);
  // Whatever was just played is now the tail to ignore, whether it was right
  // or wrong - it rings on either way.
  chordDrill.lastAnswered = midi;
  chordDrill.gate.mute(midi);

  if (verdict === 'wrong' || verdict === 'octave') {
    $('cVerdictMain').textContent = t(verdict === 'octave' ? 'chords.octaveOff' : 'chords.wrongNote');
    $('cVerdictMain').className = 'verdict-main bad';
    // The notes are already on the staff. Naming the one it is waiting for
    // would read them for him, which is the exercise.
    const { direction } = compareNote(a.expected, midi);
    $('cVerdictSub').textContent = t(direction === 'higher' ? 'read.tryHigher' : 'read.tryLower');
    drawChordQuestion();
    return;
  }

  if (!a.done) {
    $('cVerdictMain').textContent = t('chords.keepGoing');
    $('cVerdictMain').className = 'verdict-main good';
    $('cVerdictSub').textContent = '';
    drawChordQuestion();
    return;
  }

  // Finished. Only now is the chord named - naming it earlier would answer the
  // question the staff is asking.
  const ms = performance.now() - chordDrill.shownAt;
  chordDrill.asked += 1;
  if (a.clean) chordDrill.clean += 1;
  chordDrill.times.push(ms);
  chordDrill.progress.record(chordDrill.target.name, { correct: a.clean, ms });

  $('cVerdictMain').textContent = t('chords.chordDone', { name: chordDrill.target.name });
  $('cVerdictMain').className = 'verdict-main good';
  $('cVerdictSub').textContent = a.clean ? '' : t('chords.hadErrors');
  drawChordQuestion();
  updateChordSession();

  setTimeout(() => { if (chordDrill.active) nextChord(); }, a.clean ? 900 : 1800);
}

function updateChordSession() {
  $('chordSessionCard').hidden = chordDrill.asked === 0;
  $('cAsked').textContent = String(chordDrill.asked);
  $('cClean').textContent = String(chordDrill.clean);
  const sorted = [...chordDrill.times].sort((a, b) => a - b);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  $('cSpeed').textContent = med ? `${(med / 1000).toFixed(1)}s` : '—';
}

async function startChordDrill() {
  if (chordDrill.active) { stopChordDrill(); return; }
  if (read.active) endReadSession();
  stopTuning();
  if (!(await ensureAudio({ onError: verdictError('cVerdictMain') }))) return;
  chordDrill.active = true;
  chordDrill.lastAnswered = null;
  chordDrill.gate.reset(null);
  chordDrill.asked = 0; chordDrill.clean = 0; chordDrill.times = [];
  $('startChords').textContent = t('chords.stop');
  $('skipChord').disabled = false;
  nextChord();
}

function stopChordDrill() {
  if (!chordDrill.active) return;
  chordDrill.active = false;
  chordDrill.target = null;
  chordDrill.attempt = null;
  $('startChords').textContent = t('chords.start');
  $('skipChord').disabled = true;
  $('cVerdictMain').textContent = t('chords.prompt');
  $('cVerdictMain').className = 'verdict-main';
  $('cVerdictSub').textContent = '';
  drawChordQuestion();
}

$('startChords').addEventListener('click', startChordDrill);
$('skipChord').addEventListener('click', () => {
  if (!chordDrill.active) return;
  if (chordDrill.target && chordDrill.attempt && !chordDrill.attempt.done) {
    chordDrill.asked += 1;
    chordDrill.progress.record(chordDrill.target.name, { correct: false, ms: 12000 });
    updateChordSession();
  }
  nextChord();
});
$('showShape').addEventListener('change', updateChordHint);
$('endChordSession').addEventListener('click', stopChordDrill);

/** Called from the shared pitch callback. */
function feedChordDrill(stable) {
  if (!chordDrill.active) return;
  const midi = chordDrill.gate.accept(stable ? Math.round(hzToMidiFloat(stable.hz)) : null);
  if (midi == null) return;
  judgeChordNote(midi);
}

// ------------------------------------------------------------- chord charts
//
// A reference, not a drill. It teaches nothing on its own - but the chord you
// cannot remember is the one that stops the practice, and stopping to look it
// up somewhere else is how a session ends.

// The names to show on the quality buttons. Kept here rather than in chords.js
// because that module is arithmetic and knows nothing about language.
const QUALITY_KEYS = {
  '': 'chord.major', m: 'chord.minor', 7: 'chord.dom7', m7: 'chord.min7',
  maj7: 'chord.maj7', sus2: 'chord.sus2', sus4: 'chord.sus4', dim: 'chord.dim',
};

const chords = { root: 'A', quality: 'm', shapeIndex: 0 };

function buildChordPicker() {
  const roots = $('chordRoots');
  const quals = $('chordQualities');
  if (!roots || !quals) return;
  roots.innerHTML = ROOTS.map((r) =>
    `<button class="chip" data-root="${r}">${r}</button>`).join('');
  quals.innerHTML = QUALITY_ORDER.map((q) =>
    `<button class="chip" data-quality="${q}">${esc(t(QUALITY_KEYS[q]))}</button>`).join('');

  roots.querySelectorAll('[data-root]').forEach((b) => b.addEventListener('click', () => {
    chords.root = b.dataset.root; chords.shapeIndex = 0; paintChord();
  }));
  quals.querySelectorAll('[data-quality]').forEach((b) => b.addEventListener('click', () => {
    chords.quality = b.dataset.quality; chords.shapeIndex = 0; paintChord();
  }));
}

function paintChord() {
  const shapes = shapesFor(chords.root, chords.quality);
  const name = chordName(chords.root, chords.quality);

  document.querySelectorAll('#chordRoots [data-root]').forEach((b) =>
    b.classList.toggle('is-on', b.dataset.root === chords.root));
  document.querySelectorAll('#chordQualities [data-quality]').forEach((b) =>
    b.classList.toggle('is-on', b.dataset.quality === chords.quality));

  $('chordName').textContent = name;
  $('chordNotes').textContent = chordToneNames(chords.root, chords.quality).join(' · ') || '—';

  if (!shapes.length) {
    // Cannot happen with the current table, but a missing shape must read as
    // "we do not have this one", never as an empty box that looks broken.
    $('chordBoxHost').innerHTML = '';
    $('chordShapes').innerHTML = '';
    $('hearChord').disabled = true;
    return;
  }

  const i = Math.min(chords.shapeIndex, shapes.length - 1);
  chords.shapeIndex = i;
  $('chordBoxHost').innerHTML = renderChordBox(shapes[i]);
  $('hearChord').disabled = false;

  // Only offer the switcher when there is something to switch to.
  $('chordShapes').innerHTML = shapes.length < 2 ? '' : shapes.map((sh, n) => {
    const label = sh.open ? t('chords.shapeOpen') : String(sh.barre?.fret ?? '');
    const title = sh.open ? t('chords.shapeOpen') : t('chords.shapeBarreAt', { fret: sh.barre?.fret });
    return `<button class="chip small${n === i ? ' is-on' : ''}" data-shape="${n}" title="${esc(title)}">${esc(label)}</button>`;
  }).join('');
  $('chordShapes').querySelectorAll('[data-shape]').forEach((b) =>
    b.addEventListener('click', () => { chords.shapeIndex = Number(b.dataset.shape); paintChord(); }));
}

$('hearChord').addEventListener('click', () => {
  const shapes = shapesFor(chords.root, chords.quality);
  const shape = shapes[chords.shapeIndex];
  if (shape) playChord(shapeNotes(shape));
});

// ---------------------------------------------------------- the metronome

const metro = {
  node: null,
  running: false,
  bpm: 80,
  beats: 4,
  taps: [],
};

function buildBeatRow() {
  const row = $('beatRow');
  if (!row) return;
  row.innerHTML = Array.from({ length: metro.beats }, (_, i) =>
    `<div class="beat-dot${i === 0 && metro.beats > 1 ? ' is-accent' : ''}" data-beat="${i}"></div>`).join('');
}

function setBpm(bpm) {
  metro.bpm = Math.min(240, Math.max(30, Math.round(bpm)));
  $('metroBpm').textContent = String(metro.bpm);
  $('metroRange').value = String(metro.bpm);
  // Changing tempo mid-count restarts the click rather than sliding it, which
  // would put the beat somewhere neither tempo agrees with.
  if (metro.running) { stopMetro(); startMetro(); }
}

function startMetro() {
  const ctx = outputContext();
  if (!ctx) return;
  metro.node = new Metronome(ctx);
  metro.node.beatsPerBar = metro.beats;
  metro.node.onBeat = (i) => {
    const idx = ((i % metro.beats) + metro.beats) % metro.beats;
    document.querySelectorAll('.beat-dot').forEach((d) => {
      d.classList.toggle('is-on', Number(d.dataset.beat) === idx);
    });
    setTimeout(() => {
      const d = document.querySelector(`.beat-dot[data-beat="${idx}"]`);
      if (d) d.classList.remove('is-on');
    }, Math.min(140, (60000 / metro.bpm) * 0.5));
  };
  metro.node.start(metro.bpm, { countInBars: 0 });
  metro.running = true;
  $('startMetro').textContent = t('tools.metroStop');
}

function stopMetro() {
  if (!metro.running) return;
  metro.node?.stop();
  metro.node = null;
  metro.running = false;
  const btn = $('startMetro');
  if (btn) btn.textContent = t('tools.metroStart');
  document.querySelectorAll('.beat-dot').forEach((d) => d.classList.remove('is-on'));
}

$('startMetro').addEventListener('click', () => (metro.running ? stopMetro() : startMetro()));
$('bpmUp').addEventListener('click', () => setBpm(metro.bpm + 1));
$('bpmDown').addEventListener('click', () => setBpm(metro.bpm - 1));
$('metroRange').addEventListener('input', () => setBpm(Number($('metroRange').value)));
$('beatsSelect').addEventListener('change', () => {
  metro.beats = Number($('beatsSelect').value);
  buildBeatRow();
  if (metro.running) { stopMetro(); startMetro(); }
});

$('tapBtn').addEventListener('click', () => {
  metro.taps.push(performance.now());
  if (metro.taps.length > 8) metro.taps.shift();
  const bpm = tapTempo(metro.taps);
  if (bpm) setBpm(bpm);
});

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
  // The card's first label carries a placeholder, so a plain re-translate
  // leaves "last {n}" sitting there until the next answer fills it in.
  updateSessionCard();
  paintTuner(null);
  buildChordPicker();
  paintChord();
  drawChordQuestion();
  // applyToDom resets every labelled button to its resting text, so anything
  // that changes label while running has to be put back. Missing this one left
  // "Start listening" on screen during a live session: pressing it ended the
  // session when it plainly promised the opposite.
  $('startRead').textContent = t(read.active ? 'read.pause' : 'read.start');
  $('startChords').textContent = t(chordDrill.active ? 'chords.stop' : 'chords.start');
  $('startTune').textContent = t(tune.active ? 'tools.stop' : 'tools.start');
  $('startMetro').textContent = t(metro.running ? 'tools.metroStop' : 'tools.metroStart');
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
  pieceView = initPieceView({ audio, ensureAudio });
  renderSync();
  renderStageHeader();
  fillPatterns();
  drawStrip();
  $('bpmOut').textContent = $('bpmRange').value;
  buildStringRow();
  buildBeatRow();
  buildChordPicker();
  paintChord();
  paintTuner(null);
  showEmptyStaff();
  drawChordQuestion();
}).catch(() => {
  // Even if catalogues fail entirely, the built-in English markup still works.
  pieceView = initPieceView({ audio, ensureAudio });
  renderSync();
  renderStageHeader();
  fillPatterns();
  drawStrip();
  $('bpmOut').textContent = $('bpmRange').value;
  buildStringRow();
  buildBeatRow();
  buildChordPicker();
  paintChord();
  paintTuner(null);
  showEmptyStaff();
  drawChordQuestion();
});
