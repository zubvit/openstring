import { storage as safeStorage } from './stores.js';

// Translation.
//
// Two things make this more than a lookup table.
//
// PLURALS. English has two forms and every naive i18n layer assumes that. Polish
// and Ukrainian have four, chosen by rules that are not "n === 1". "3 notes" and
// "5 notes" take different endings in both. So a catalogue value may be either a
// string or an object of CLDR plural categories, resolved with Intl.PluralRules -
// the browser already knows the rules for every language, so we never encode them.
//
// FALLBACK. English is bundled, not fetched. A missing translation, a failed
// network request or a half-finished locale falls back key by key rather than
// leaving blank interface. A partly translated app is useful; an empty one is not.

export const LOCALES = {
  en: { name: 'English', dir: 'ltr' },
  es: { name: 'Español', dir: 'ltr' },
  uk: { name: 'Українська', dir: 'ltr' },
  de: { name: 'Deutsch', dir: 'ltr' },
  fr: { name: 'Français', dir: 'ltr' },
  pt: { name: 'Português', dir: 'ltr' },
  it: { name: 'Italiano', dir: 'ltr' },
  pl: { name: 'Polski', dir: 'ltr' },
  nl: { name: 'Nederlands', dir: 'ltr' },
  cs: { name: 'Čeština', dir: 'ltr' },
  ro: { name: 'Română', dir: 'ltr' },
  el: { name: 'Ελληνικά', dir: 'ltr' },
  tr: { name: 'Türkçe', dir: 'ltr' },
  id: { name: 'Bahasa Indonesia', dir: 'ltr' },
  hi: { name: 'हिन्दी', dir: 'ltr' },
  zh: { name: '中文', dir: 'ltr' },
  ja: { name: '日本語', dir: 'ltr' },
  ko: { name: '한국어', dir: 'ltr' },
  // Named as the app's owner names it. His app, his call.
  ru: { name: 'московский язык', dir: 'ltr' },
  ar: { name: 'العربية', dir: 'rtl' },
};

const STORE_KEY = 'openstring.locale';

let current = 'en';
let base = {};      // English, always present
let active = {};    // the chosen language, possibly incomplete

export function availableLocales() {
  return Object.entries(LOCALES).map(([code, meta]) => ({ code, ...meta }));
}

/** Best match between the browser's languages and what we actually have. */
export function detectLocale() {
  const saved = (() => { try { return safeStorage?.getItem(STORE_KEY); } catch { return null; } })();
  if (saved && LOCALES[saved]) return saved;
  for (const tag of navigator.languages || [navigator.language || 'en']) {
    const primary = String(tag).toLowerCase().split('-')[0];
    if (LOCALES[primary]) return primary;
  }
  return 'en';
}

export function getLocale() { return current; }

async function fetchCatalogue(code) {
  // Revalidate rather than trust the cache. The code and its wording ship
  // together, so a stale catalogue paired with fresh code prints raw key names
  // on screen. An ETag check costs one 304 and removes that window entirely.
  const res = await fetch(new URL(`../locales/${code}.json`, import.meta.url), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`no catalogue for ${code}`);
  return res.json();
}

export async function initI18n(code = detectLocale()) {
  base = await fetchCatalogue('en');
  await setLocale(code, { silent: true });
  return current;
}

export async function setLocale(code, { silent = false } = {}) {
  if (!LOCALES[code]) code = 'en';
  if (code === 'en') {
    active = base;
  } else {
    try {
      active = await fetchCatalogue(code);
    } catch {
      // A missing or broken catalogue must not break the app.
      active = {};
      code = LOCALES[code] ? code : 'en';
    }
  }
  current = code;
  try { safeStorage?.setItem(STORE_KEY, code); } catch { /* the choice just will not persist */ }
  document.documentElement.lang = code;
  document.documentElement.dir = LOCALES[code]?.dir || 'ltr';
  applyToDom();
  // Announce the change instead of trusting every caller to redraw. Text built
  // in JavaScript (stage names, verdicts, chunk labels) is not covered by
  // applyToDom, and a caller that forgets leaves the page half-translated.
  if (!silent) window.dispatchEvent(new CustomEvent('localechange', { detail: { code } }));
  return code;
}

function lookup(key) {
  return (key in active ? active[key] : undefined) ?? base[key];
}

/**
 * Translate. `vars.count` also selects the plural form when the entry has one.
 * Unknown keys return the key itself, which is ugly on purpose - silent blanks
 * hide missing strings until a user finds them.
 */
export function t(key, vars = {}) {
  let value = lookup(key);
  if (value == null) return key;

  if (typeof value === 'object') {
    const n = Number(vars.count ?? 0);
    const cat = new Intl.PluralRules(current).select(n);
    value = value[cat] ?? value.other ?? value.one ?? Object.values(value)[0] ?? key;
  }

  return String(value).replace(/\{(\w+)\}/g, (m, name) =>
    (name in vars ? String(vars[name]) : m));
}

/**
 * Fill in every element carrying a data-i18n attribute.
 *   data-i18n="key"                  -> textContent
 *   data-i18n-html="key"             -> innerHTML (for copy containing markup)
 *   data-i18n-placeholder="key"      -> placeholder attribute
 *   data-i18n-title="key"            -> title attribute
 *   data-i18n-aria-label="key"       -> aria-label attribute
 */
export function applyToDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    const data = `data-i18n-${attr}`;
    root.querySelectorAll(`[${data}]`).forEach((el) => {
      el.setAttribute(attr, t(el.getAttribute(data)));
    });
  }
  const titleKey = document.querySelector('meta[name="i18n-title"]')?.content;
  if (titleKey) document.title = t(titleKey);
}

/** Which keys a locale is missing - used by the completeness test. */
export function missingKeys(catalogue, reference = base) {
  return Object.keys(reference).filter((k) => !(k in catalogue));
}
