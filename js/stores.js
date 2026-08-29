// Every place this app keeps something, in one list.
//
// It grew stores one at a time - pieces, then chords, then intervals - and the
// three things that are supposed to look after your data all still knew about
// only the first one. Export wrote a file missing three quarters of your
// practice while telling you it was a backup; sync carried the same gap between
// devices; and Erase left personal data behind after promising to remove it.
// A list beats remembering.

/**
 * localStorage access can THROW on the property itself - Chrome with site data
 * blocked does exactly that - and every module reached for it at import time,
 * outside its own try/catch. The result was a blank, dead page for anyone with
 * that setting, which is the opposite of a local-first app.
 */
export const storage = (() => {
  try {
    const ls = globalThis.localStorage;
    // Touch it: some browsers only throw on use, not on the property.
    const probe = '__openstring_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
})();

/** Read a JSON store, or null. Never throws. */
export function readStore(key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Write a JSON store. Returns false when it did not stick. */
export function writeStore(key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return !!storage;
  } catch { return false; }
}

export function removeStore(key) {
  try { storage?.removeItem(key); } catch { /* nothing to do */ }
}

/**
 * The stores that are NOT the main progress file.
 *
 * `sync: false` on the piece store is deliberate: it holds the entire note
 * sequence of an imported score, the sync blob is capped at half a megabyte,
 * and a piece is one file-picker away from being re-imported. Losing it across
 * devices is an inconvenience; blowing the size cap would break sync itself.
 */
export const EXTRA_STORES = [
  // v1 is the single imported piece from before there was a library. It is
  // still listed so an old export still restores, and so Erase still finds it.
  { key: 'openstring.piece.v1', sync: false },
  { key: 'openstring.pieces.v2', sync: false },
  { key: 'openstring.chords.v1', sync: true },
  { key: 'openstring.intervals.v1', sync: true },
  // Which lesson he is on and which rounds he has finished. Small, and the one
  // thing that would make a new device feel like starting the course again.
  { key: 'openstring.lesson.v1', sync: true },
];

/** Everything the app owns, for Erase. */
export const ALL_KEYS = [
  'openstring.v1',
  'openstring.locale',
  'openstring.email',
  'openstring.session',
  'openstring.lastSync',
  ...EXTRA_STORES.map((s) => s.key),
];

/** Gather the extra stores for an export or a sync push. */
export function collectExtras({ syncOnly = false } = {}) {
  const out = {};
  for (const s of EXTRA_STORES) {
    if (syncOnly && !s.sync) continue;
    const v = readStore(s.key);
    if (v != null) out[s.key] = v;
  }
  return out;
}

/** Put back what collectExtras gathered. Unknown keys are ignored, not trusted. */
export function restoreExtras(extras) {
  if (!extras || typeof extras !== 'object') return;
  const known = new Set(EXTRA_STORES.map((s) => s.key));
  for (const [key, value] of Object.entries(extras)) {
    if (known.has(key) && value != null) writeStore(key, value);
  }
}
