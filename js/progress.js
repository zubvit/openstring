// Everything the app remembers, kept in this browser and nowhere else.
//
// No account, no server, no telemetry. That is partly principle and partly the
// only honest way to promise "no subscription" - anything with a backend has a
// bill attached and eventually someone has to pay it.

import { emptyStat, updateStat, isFluent, poolMastery, weakest } from './srs.js';

const KEY = 'openstring.v1';

const blank = () => ({
  version: 1,
  stats: {},        // positionId -> stat
  sessions: [],     // { date, ms, asked, correct, stageId }
  rhythm: [],       // { date, bpm, patternId, meanAbsErrorMs, verdict }
  stageId: null,    // where the curriculum has got to
  seenWelcome: false,
  lastExport: 0,
  createdAt: Date.now(),
});

export class Progress {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.data = this.#load();
  }

  #load() {
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return blank();
      const parsed = JSON.parse(raw);
      return { ...blank(), ...parsed };
    } catch {
      return blank(); // corrupt or unreadable storage should never block practice
    }
  }

  /** Re-read from storage - another tab may have practised since we loaded. */
  reload() {
    this.data = this.#load();
    return this.data;
  }

  save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false; // private browsing, quota, etc - practice still works
    }
  }

  statFor(id) {
    return { ...emptyStat(), ...(this.data.stats[id] || {}) };
  }

  recordAnswer(id, { correct, ms, now = Date.now() }) {
    this.data.stats[id] = updateStat(this.data.stats[id], { correct, ms, now });
    this.save();
    return this.data.stats[id];
  }

  recordSession(entry) {
    this.data.sessions.push({ date: Date.now(), ...entry });
    // Keep the file small; a year of daily practice is plenty of history.
    if (this.data.sessions.length > 400) this.data.sessions = this.data.sessions.slice(-400);
    this.save();
  }

  recordRhythm(entry) {
    this.data.rhythm.push({ date: Date.now(), ...entry });
    if (this.data.rhythm.length > 200) this.data.rhythm = this.data.rhythm.slice(-200);
    this.save();
  }

  setStage(stageId) {
    this.data.stageId = stageId;
    this.save();
  }

  mastery(pool) { return poolMastery(pool, this.data.stats); }
  weakest(pool, n = 5) { return weakest(pool, this.data.stats, n); }
  isFluent(id) { return isFluent(this.data.stats[id]); }

  /** Distinct calendar days practised, and the current run of consecutive days. */
  streak(now = Date.now()) {
    const days = new Set(this.data.sessions.map((s) => new Date(s.date).toDateString()));
    let run = 0;
    for (let i = 0; ; i++) {
      const d = new Date(now - i * 86400000).toDateString();
      if (days.has(d)) run++;
      else if (i > 0) break;          // today not practised yet is fine
      else if (days.size === 0) break;
    }
    return { daysPractised: days.size, currentStreak: run };
  }

  /** Totals for the summary panel. */
  summary() {
    const s = this.data.sessions;
    const asked = s.reduce((a, x) => a + (x.asked || 0), 0);
    const correct = s.reduce((a, x) => a + (x.correct || 0), 0);
    const ms = s.reduce((a, x) => a + (x.ms || 0), 0);
    return {
      sessions: s.length,
      asked,
      correct,
      accuracy: asked ? correct / asked : 0,
      minutes: Math.round(ms / 60000),
      ...this.streak(),
    };
  }

  export() {
    this.data.lastExport = Date.now();
    this.save();
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Should we nudge for a backup? Browser storage is not durable - clearing site
   * data, a new machine or a wiped profile all lose everything, silently. Rather
   * than run accounts (which would mean a server, a bill and other people's
   * passwords), the honest fix is to make the export obvious once there is
   * something worth losing.
   */
  needsBackup(now = Date.now()) {
    if (this.data.sessions.length < 4) return false;      // nothing much to lose yet
    const since = now - (this.data.lastExport || 0);
    return since > 21 * 86400000;
  }

  import(json) {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !parsed.stats) throw new Error('not an Openstring backup');
    this.data = { ...blank(), ...parsed };
    this.save();
  }

  reset() {
    this.data = blank();
    this.save();
  }
}

/** Minimal in-memory storage so the modules can be tested without a browser. */
export class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
