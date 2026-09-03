import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STAGES, RHYTHMS } from '../js/curriculum.js';

const ROOT = new URL('..', import.meta.url).pathname;
const load = (code) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${code}.json`), 'utf8'));

const en = load('en');
const codes = fs.readdirSync(path.join(ROOT, 'locales'))
  .filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

/** Every {placeholder} used in a value. */
const slots = (v) => {
  if (v == null) return null;
  const strings = typeof v === 'string' ? [v] : Object.values(v);
  return new Set(strings.flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
};

// English is the one catalogue that must be complete, because it is the
// fallback: js/i18n.js looks a key up in the chosen language and then in
// English, and only prints the raw key name when BOTH are missing. So a gap in
// English is a bug on screen, and a gap in any other language is a sentence in
// English inside an otherwise translated page - which is normal, and fine.
t('English carries every key the app asks for', () => {
  const asked = new Set();
  for (const file of ['index.html', 'js/app.js', 'js/piece-view.js', 'js/lesson.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-z][\w.-]*)'/gi)) asked.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-\w+)?="([\w.-]+)"/g)) asked.add(m[1]);
  }
  const missing = [...asked].filter((k) => !(k in en)).sort();
  assert.deepEqual(missing, [], `English is missing keys the app asks for: ${missing.join(', ')}`);
});

// NOT a failure when a language is behind.
//
// It used to be, and that gate cost more than it bought. Every new sentence in
// the app - one screen, one button - could not ship until it existed in twenty
// languages, so a change made for the one person who uses this waited on
// nineteen translations nobody had asked for. Measured on 2026-08-29: zero
// sign-ups on the sync server since it was built, one repository page view in
// two weeks, no stars and no forks. The languages stay, because they are done
// and they work; they simply stop holding the door.
t('every locale is either complete or honestly partial', () => {
  const report = [];
  for (const code of codes) {
    if (code === 'en') continue;
    const missing = Object.keys(en).filter((k) => !(k in load(code)));
    const pct = Math.round(((Object.keys(en).length - missing.length) / Object.keys(en).length) * 100);
    report.push(`${code} ${pct}%`);
    // A locale with nothing in it is a broken file, not a partial translation.
    assert.ok(pct > 50, `${code} is only ${pct}% translated, which looks like a broken file`);
  }
  console.log(`  coverage: ${report.join('  ')}`);
});

t('no locale invents keys English does not have', () => {
  // A stray key is usually a typo that will silently never be shown.
  for (const code of codes) {
    if (code === 'en') continue;
    const extra = Object.keys(load(code)).filter((k) => !(k in en));
    assert.deepEqual(extra, [], `${code} has keys not in English: ${extra.join(', ')}`);
  }
});

t('placeholders match English exactly', () => {
  // A dropped {bpm} shows a sentence with a hole; an invented one prints literally.
  const problems = [];
  for (const code of codes) {
    if (code === 'en') continue;
    const cat = load(code);
    for (const [key, value] of Object.entries(en)) {
      // A key this language has not reached yet falls back to English at run
      // time, so there is nothing here to be wrong about.
      if (!(key in cat)) continue;
      const want = slots(value);
      const got = slots(cat[key]);
      for (const s of want) if (!got.has(s)) problems.push(`${code}/${key}: missing {${s}}`);
      for (const s of got) if (!want.has(s)) problems.push(`${code}/${key}: unexpected {${s}}`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

t('plural entries carry the forms their language actually needs', () => {
  // Ukrainian and Polish need one/few/many; English needs one/other. Getting this
  // wrong produces grammatically broken counts, which is exactly the kind of
  // error a native speaker notices immediately and a developer never does.
  const problems = [];
  for (const code of codes) {
    const cat = load(code);
    const required = new Set();
    const pr = new Intl.PluralRules(code);
    for (const n of [0, 1, 2, 3, 5, 11, 21, 100]) required.add(pr.select(n));
    for (const [key, value] of Object.entries(en)) {
      if (typeof value !== 'object') continue;
      const entry = cat[key];
      assert.ok(entry && typeof entry === 'object', `${code}/${key} should be a plural object`);
      for (const form of required) {
        if (!(form in entry)) problems.push(`${code}/${key}: missing "${form}" form`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

t('html-bearing strings keep their tags balanced', () => {
  const problems = [];
  for (const code of codes) {
    for (const [key, value] of Object.entries(load(code))) {
      if (typeof value !== 'string' || !value.includes('<')) continue;
      for (const tag of ['strong', 'em', 'code']) {
        const open = (value.match(new RegExp(`<${tag}>`, 'g')) || []).length;
        const close = (value.match(new RegExp(`</${tag}>`, 'g')) || []).length;
        if (open !== close) problems.push(`${code}/${key}: ${open} <${tag}> vs ${close} </${tag}>`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

t('every key referenced in the code exists in English', () => {
  const src = ['js/app.js', 'js/piece-view.js']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const used = new Set();
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria-label)?="([\w.]+)"/g)) used.add(m[1]);
  // Template-literal keys like t(`layer.${l}`) are checked by prefix instead.
  const prefixes = [...src.matchAll(/\bt\(\s*`([\w.]+)\$\{/g)].map((m) => m[1]);

  const unknown = [...used].filter((k) => !(k in en));
  assert.deepEqual(unknown, [], `code references keys with no English text: ${unknown.join(', ')}`);

  for (const p of new Set(prefixes)) {
    const any = Object.keys(en).some((k) => k.startsWith(p));
    assert.ok(any, `no keys start with "${p}" but the code builds them dynamically`);
  }
});

t('the dynamic key families are complete', () => {
  // Built as t(`stage.${id}.title`) etc, so a missing one only shows at runtime.
  // Read from the plan itself. Hardcoding the list meant that adding a stage
  // passed this test and then printed a raw key name on the learner's screen,
  // and removing one left the test demanding wording for a stage that was gone.
  const stageIds = STAGES.map((s) => s.id);
  const layers = ['notes', 'timing', 'evenness', 'dynamics', 'colour', 'legato'];
  const patterns = Object.keys(RHYTHMS);
  const missing = [];
  for (const id of stageIds) for (const part of ['title', 'blurb', 'advice']) {
    if (!(`stage.${id}.${part}` in en)) missing.push(`stage.${id}.${part}`);
  }
  for (const l of layers) if (!(`layer.${l}` in en)) missing.push(`layer.${l}`);
  for (const p of patterns) if (!(`rhythmPattern.${p}` in en)) missing.push(`rhythmPattern.${p}`);
  assert.deepEqual(missing, [], missing.join(', '));
});

t('no locale leaks untranslated English into a translated file', () => {
  // A handful of values are legitimately identical (brand name, "Openstring").
  const allowed = new Set(['app.name']);
  for (const code of codes) {
    if (code === 'en') continue;
    const cat = load(code);
    const identical = Object.keys(en).filter((k) =>
      !allowed.has(k) && typeof en[k] === 'string' && cat[k] === en[k] && en[k].length > 25);
    assert.deepEqual(identical, [], `${code} appears to have untranslated strings: ${identical.join(', ')}`);
  }
});

console.log(`i18n: ${pass} groups passed (${codes.length} locales: ${codes.join(', ')})`);
