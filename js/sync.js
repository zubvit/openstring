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

export class Sync {
  constructor(progress) {
    this.progress = progress;
    this.token = localStorage.getItem(TOKEN_KEY) || null;
    this.email = localStorage.getItem('openstring.email') || null;
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
    localStorage.setItem(TOKEN_KEY, this.token);
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
    localStorage.setItem('openstring.email', email);
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
        body: JSON.stringify({ data: this.progress.data }),
      });
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
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
        this.progress.data = { ...this.progress.data, ...res.data };
        this.progress.save();
      }
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
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
    localStorage.removeItem(TOKEN_KEY);
    this.onChange?.();
  }

  lastSync() {
    const t = Number(localStorage.getItem(LAST_SYNC_KEY) || 0);
    return t || null;
  }
}
