import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const load = (code) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${code}.json`), 'utf8'));

const en = load('en');
const codes = fs.readdirSync(path.join(ROOT, 'locales'))
  .filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

/** Every {placeholder} used in a value. */
const slots = (v) => {
  const strings = typeof v === 'string' ? [v] : Object.values(v);
  return new Set(strings.flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
};

t('every locale covers every English key', () => {
  const gaps = {};
  for (const code of codes) {
    if (code === 'en') continue;
    const missing = Object.keys(en).filter((k) => !(k in load(code)));
    if (missing.length) gaps[code] = missing;
  }
  assert.deepEqual(gaps, {}, `incomplete locales:\n${JSON.stringify(gaps, null, 1)}`);
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
  const stageIds = ['landmarks', 'open-top', 'open-bottom', 'open-all', 'open-chromatic', 'position-v', 'first-twelve'];
  const layers = ['notes', 'timing', 'evenness', 'dynamics', 'colour', 'legato'];
  const patterns = ['quarters', 'half-quarters', 'eighths', 'with-rests', 'dotted', 'syncopated', 'sixteenths'];
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
