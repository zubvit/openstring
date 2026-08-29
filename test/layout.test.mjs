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

t('the drill itself ends, and offers the next stage where the player is', () => {
  // He played 118 notes on a mastered three-note stage - ring at 100%, tick on
  // the title - and asked when it ends. It did not: the only exits were walking
  // away for three minutes or pressing End, and the offer to move on lived on
  // the Progress tab, which nobody opens mid-practice.
  assert.match(js, /function roundVerdict\(\)/, 'the drill has no end condition');

  // nextQuestion must consult it BEFORE picking another note, or the round
  // always runs one note long.
  const next = /function nextQuestion\(\)\s*\{([\s\S]*?)const pool = poolFor/.exec(js);
  assert.ok(next, 'nextQuestion has moved');
  assert.match(next[1], /roundVerdict\(\)/, 'nextQuestion asks for another note without checking');

  // And the offer has to be reachable from the reading screen.
  assert.match(html, /id="roundActions"/, 'nowhere on the drill screen to offer the next stage');
  assert.match(js, /function showRoundActions\(/);
  assert.match(js, /nextStageBtn/, 'no button to move on');
  assert.match(js, /againBtn/, 'no button to play another round');
});

t('the round decision is made where it can be tested', () => {
  // The rule lives in js/goals.js with real tests over it. What this file
  // guards is that the app asks, and hands over the state the rule needs - a
  // correct rule called with the wrong arguments is still a bug.
  const verdict = /function roundVerdict\(\)\s*\{([\s\S]*?)\n\}/.exec(js);
  assert.ok(verdict, 'roundVerdict has moved');
  for (const field of ['streak', 'asked', 'elapsedMs', 'poolSize', 'metCorrectly']) {
    assert.match(verdict[1], new RegExp(field + ':'), `roundOver called without ${field}`);
  }
});

t('the run is broken by every kind of miss, not only a wrong note', () => {
  // A streak that survived giving up would not be a streak.
  const wrong = /if \(verdict !== 'right'\) \{([\s\S]*?)\n  \}/.exec(js);
  assert.ok(wrong, 'the wrong-answer branch has moved');
  assert.match(wrong[1], /read\.streak = 0/, 'a wrong note leaves the run standing');
  const skip = /skipNote'\)\.addEventListener\('click'[\s\S]*?\n\}\);/.exec(js);
  assert.ok(skip, 'the skip handler has moved');
  assert.match(skip[0], /read\.streak = 0/, "\"Can't find it\" leaves the run standing");
});

t('the goal is chosen by the player and remembered', () => {
  assert.match(html, /id="goalSelect"/, 'no way to choose a finish line');
  assert.match(js, /progress\.setGoal\(/, 'the choice is not saved');
  assert.match(js, /progress\.data\.goalId \|\| DEFAULT_GOAL_ID/, 'the saved choice is not read back');
});

t('a wrong note can never be read as evidence about tuning', () => {
  // He hunted, the app accused his guitar, he checked, it was fine. The guard
  // is that the sample carries whether the app agreed the note was right.
  assert.match(js, /correct: verdict === 'right'/,
    'the tuning sample must record whether the note was actually right');
});

t('the note can be heard, and hearing it does not answer the question', () => {
  // Only help was "higher" and "lower", which is no help when you are sure you
  // are playing the right thing. The same pitch sits in several places on a
  // guitar, so playing it gives away nothing about where.
  assert.match(html, /id="hearNote"/, 'no way to hear the note being asked for');
  const handler = /hearNote'\)\.addEventListener\('click'[\s\S]*?\n\}\);/.exec(js);
  assert.ok(handler, 'the hear-it handler has moved');
  assert.match(handler[0], /playChord\(\[read\.target\.sounding\]/, 'it must play the note asked for');
  assert.match(handler[0], /read\.graceUntil = /,
    'the note it plays goes into the microphone and would be judged as an answer');
  assert.ok(!/gate\.mute/.test(handler[0]),
    'muting the pitch would swallow his own answer - it is the note he must play');
});

t('the hint names the strings rather than asking him to count rows', () => {
  // Count from the wrong end and you play a different string with complete
  // confidence. The open-string letter is self-checking.
  const staff = read('js/staff.js');
  const label = /class="fb-label"[^`]*`\)/.exec(staff);
  assert.ok(label, 'the string label has moved');
  assert.match(label[0], /\$\{open\}/, 'the fretboard rows show only numbers');
});

t('a phone shows the note and the neck at the same time', () => {
  // iPhone 16 Pro with Safari open: ~660px of page. At desktop sizes the
  // staff alone was ~190px tall and the fretboard landed below the fold, so
  // every glance at "where it is" scrolled "what it is" away - the two things
  // the drill exists to connect. The phone block caps both drawings.
  const block = /@media \(max-width: 480px\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(block, 'the phone compaction block is gone');
  assert.match(block[1], /svg\.staff\s*\{[^}]*width\s*:\s*min\(100%,\s*2\d\dpx\)/,
    'the staff must be capped near 220px on a phone, not 320px');
  assert.match(block[1], /svg\.fretboard\s*\{[^}]*width\s*:\s*min\(100%,\s*2\d\dpx\)/,
    'the fretboard must shrink with the staff, or the pair still overflows');
  assert.match(block[1], /\.staff-host\s*\{[^}]*min-height\s*:\s*1[0-4]\dpx/,
    'the host must not hold 152px of blank space around a 130px drawing');
});

t('the drawings scale by CSS, never by regenerating the SVG', () => {
  // Both SVGs size themselves through the viewBox: the CSS width plus
  // height:auto is what keeps them responsive. If either drawing ever gains
  // a fixed pixel height in CSS it will squash rather than scale.
  assert.match(css, /svg\.staff\s*\{\s*width[^}]*height\s*:\s*auto/,
    'svg.staff must keep height: auto');
  assert.match(css, /svg\.fretboard\s*\{\s*width[^}]*height\s*:\s*auto/,
    'svg.fretboard must keep height: auto');
});

t('the topbar hides by sliding, and slides back for a keyboard', () => {
  // js/chrome.js sets one class; the CSS must move the bar with a transform.
  // display:none would drop its layout slot and jump everything below it,
  // and a transition would then have nothing to animate.
  assert.match(css, /body\.chrome-hidden \.topbar\s*\{\s*transform\s*:\s*translateY\(-1\d\d%\)/,
    'the hidden bar must slide up by transform, not vanish by display');
  assert.match(css, /body\.chrome-hidden \.topbar:focus-within\s*\{\s*transform\s*:\s*none/,
    'a bar that slides out from under keyboard focus is a trap');
  // The slide animates only for people who have not asked for calm.
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.topbar\s*\{\s*transition/,
    'the transition must sit behind prefers-reduced-motion');
});

t('seven tabs make one scrolling row, not a stack', () => {
  // Wrapping seven tabs made the topbar three rows tall - a third of a short
  // screen spent on chrome. The row scrolls sideways inside its own box; the
  // page itself must never scroll sideways for it.
  const rail = /@media \(max-width: 560px\)\s*\{[\s\S]*?\.tabs\s*\{([^}]*)\}/.exec(css);
  assert.ok(rail, 'the phone tab rail rule is gone');
  assert.match(rail[1], /flex-wrap\s*:\s*nowrap/, 'tabs are wrapping again');
  assert.match(rail[1], /overflow-x\s*:\s*auto/, 'a nowrap row with no overflow scrolls the page');
});

console.log(`layout: ${pass} groups passed`);
