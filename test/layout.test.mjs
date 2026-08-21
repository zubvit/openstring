import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Layout regressions do not throw. They just quietly take up space, or slide one
// control under another, and the first person to notice is the one practising.
// These are structural checks on the markup and the stylesheet - no browser.

const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const html = read('index.html');
const css = read('css/app.css');
const js = read('js/app.js') + read('js/piece-view.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

/** Selectors in app.css that set a display other than none. */
const displaySetters = () => {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl = /(?:^|;)\s*display\s*:\s*([\w-]+)/.exec(m[2]);
    if (decl && decl[1] !== 'none') out.push({ selector: m[1].trim(), display: decl[1] });
  }
  return out;
};

t('hidden means gone, whatever else the stylesheet says', () => {
  // `.timing-plot { display: flex }` beat the browser default for [hidden], so
  // the rhythm drill held 60px of blank space under the verdict at all times.
  // One wall, rather than a per-class patch each time it happens again.
  const wall = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css);
  assert.ok(wall, 'css/app.css needs [hidden] { display: none !important; }');
});

t('the wall is load-bearing: things really are hidden by class and by script', () => {
  // If this ever finds nothing, the test above has stopped guarding anything.
  const classesWithDisplay = new Set(
    displaySetters().flatMap(({ selector }) =>
      [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1])),
  );

  // Elements that carry `hidden` in the markup, plus ones the code hides later.
  const marked = [...html.matchAll(/<[^>]*\bhidden\b[^>]*>/g)].map((m) => m[0]);
  const scripted = new Set([...js.matchAll(/\$\('(\w+)'\)\.hidden\s*=/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<[^>]*\bid="(\w+)"[^>]*>/g)) {
    if (scripted.has(m[1])) marked.push(m[0]);
  }

  const atRisk = marked.filter((tag) => {
    const cls = /class="([^"]*)"/.exec(tag);
    return cls && cls[1].split(/\s+/).some((c) => classesWithDisplay.has(c));
  });
  assert.ok(atRisk.length > 0, 'no hidden element carries a display-setting class any more');
});

t('a picker control cannot grow wider than its column', () => {
  // A <select> sizes to its widest option, and a grid track does not clip it -
  // one long pattern name pushed the box out under the tempo slider.
  const rule = /\.rhythm-picker select[^{]*\{([^}]*)\}/.exec(css);
  assert.ok(rule, '.rhythm-picker select rule is gone');
  assert.match(rule[1], /width\s*:\s*100%/, 'select must fill, not exceed, its column');
  assert.match(rule[1], /min-width\s*:\s*0/, 'without min-width:0 a grid item still overflows');
});

t('the pattern list says "beyond this stage" once, not on every option', () => {
  // Repeating the suffix per option is what made the control too wide to fit.
  assert.ok(!/rhythmPattern\.beyondStage/.test(js), 'per-option suffix is back');
  assert.match(js, /<optgroup label="\$\{/, 'options should be grouped under headings');
});

t('wording is never served staler than the code that asks for it', () => {
  // A cached catalogue next to fresh code prints "rhythmPattern.groupCurrent"
  // where a heading should be. Seen live, in the ten minutes after this commit.
  const i18n = read('js/i18n.js');
  const call = /fetch\(new URL\(`\.\.\/locales[^)]*\)([^)]*)\)/.exec(i18n);
  assert.ok(call, 'the catalogue fetch has moved');
  assert.match(call[1], /cache:\s*'no-cache'/, 'catalogue fetch must revalidate');
});

console.log(`layout: ${pass} groups passed`);
