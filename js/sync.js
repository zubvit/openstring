import { storage as safeStorage, collectExtras, restoreExtras } from './stores.js';
// Optional sync: sign in by email link, keep progress across devices.
//
// Local-first is not negotiable. Everything here is additive - if the server is
// down, blocked, or you never sign in, the app behaves exactly as it always did.
// Nothing waits on the network and nothing is lost when it fails.

// In development the page is on localhost, where the production server will
// (correctly) refuse the origin - so talk to a local instance instead.
const LOCAL = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);
const API = LOCAL ? 'http://127.0.0.1:8791' : 'https://sync.openstring.app';
const TOKEN_KEY = 'openstring.session';
const LAST_SYNC_KEY = 'openstring.lastSync';

const safeGet = (k) => { try { return safeStorage?.getItem(k) || null; } catch { return null; } };
const safeSet = (k, v) => { try { safeStorage?.setItem(k, v); } catch { /* practice still works */ } };

/** How much practice a blob represents - used to warn before overwriting more with less. */
export function blobWeight(data) {
  if (!data || typeof data !== 'object') return 0;
  const sessions = Array.isArray(data.sessions) ? data.sessions.length : 0;
  const positions = data.stats && typeof data.stats === 'object' ? Object.keys(data.stats).length : 0;
  return sessions + positions;
}

export class Sync {
  constructor(progress) {
    this.progress = progress;
    // These ran at module load and could throw outright, taking the app with
    // them, on a browser with site data blocked.
    this.token = safeGet(TOKEN_KEY);
    this.email = safeGet('openstring.email');
    this.busy = false;
    this.onChange = null;
  }

  get signedIn() { return !!this.token; }

  /**
   * The magic link lands back on the app with the session in the URL fragment.
   * Fragments never reach a server and stay out of referrer and proxy logs, so
   * this is the safest place to hand a credential back to a page.
   */
  captureFromUrl() {
    const m = /[#&]sync=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (!m) return false;
    this.token = m[1];
    safeSet(TOKEN_KEY, this.token);
    // Strip it immediately so a copied URL is not a working credential.
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  async requestLink(email) {
    const r = await fetch(`${API}/api/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Could not send the sign-in email.');
    safeSet('openstring.email', email);
    this.email = email;
    return body.message || 'Check your email for a sign-in link.';
  }

  async #call(path, opts = {}) {
    const r = await fetch(`${API}${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${this.token}` },
    });
    if (r.status === 401) { this.signOutLocal(); throw new Error('Your sign-in has expired. Sign in again.'); }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Sync failed.');
    return body;
  }

  /**
   * Push local progress up. Last write wins.
   *
   * Merging two divergent practice histories properly would mean reconciling
   * per-position statistics that were both derived from real playing, and any
   * automatic answer would be wrong for somebody. Last-write-wins is at least
   * predictable, and the app says which way the data moved.
   */
  async push() {
    if (!this.signedIn) throw new Error('Sign in first.');
    this.busy = true; this.onChange?.();
    try {
      // Another tab may have practised since this one loaded; pushing stale
      // memory over fresher storage would quietly lose that work.
      this.progress.reload();
      const res = await this.#call('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...this.progress.data, extras: collectExtras({ syncOnly: true }) } }),
      });
      safeSet(LAST_SYNC_KEY, String(Date.now()));
      return res;
    } finally { this.busy = false; this.onChange?.(); }
  }

  /** Pull remote progress down, replacing what is here. */
  async pull() {
    if (!this.signedIn) throw new Error('Sign in first.');
    this.busy = true; this.onChange?.();
    try {
      const res = await this.#call('/api/data');
      if (res.data) {
        const { extras, ...core } = res.data;
        this.progress.data = { ...this.progress.data, ...core };
        this.progress.save();
        restoreExtras(extras);
      }
      safeSet(LAST_SYNC_KEY, String(Date.now()));
      return res;
    } finally { this.busy = false; this.onChange?.(); }
  }

  async signOut() {
    if (this.token) {
      try { await fetch(`${API}/api/signout`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}` } }); }
      catch { /* signing out locally is what matters */ }
    }
    this.signOutLocal();
  }

  signOutLocal() {
    this.token = null;
    try { safeStorage?.removeItem(TOKEN_KEY); } catch { /* nothing to do */ }
    this.onChange?.();
  }

  lastSync() {
    const t = Number(safeGet(LAST_SYNC_KEY) || 0);
    return t || null;
  }
}
