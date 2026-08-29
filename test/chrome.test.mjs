import assert from 'node:assert/strict';

// The hide-on-scroll decision. Every flicker bug in this kind of feature is a
// decision bug - the DOM call is one classList.toggle - so the decision is
// pure and lives here under test. Importing js/chrome.js in Node also proves
// the module does not touch the DOM at import time.
import { decideChrome } from '../js/chrome.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

t('scrolling down hides, scrolling up shows', () => {
  let s = decideChrome({ lastY: 100, y: 160, hidden: false });
  assert.equal(s.hidden, true, 'a clear downward scroll must hide the bar');
  s = decideChrome({ lastY: 160, y: 120, hidden: true });
  assert.equal(s.hidden, false, 'ANY upward scroll must bring it back - not only reaching the top');
});

t('the top of the page always shows the chrome', () => {
  assert.equal(decideChrome({ lastY: 300, y: 0, hidden: true }).hidden, false);
  // Safari reports negative positions while rubber-banding; read as a scroll
  // they would look like a huge upward move from a strange anchor.
  const s = decideChrome({ lastY: 5, y: -40, hidden: true });
  assert.equal(s.hidden, false);
  assert.equal(s.lastY, 0, 'the anchor must clamp at the top, not follow the bounce');
});

t('a wobbling finger toggles nothing', () => {
  // A finger resting on the glass moves a few pixels either way.
  for (const hidden of [false, true]) {
    for (const y of [98, 102, 105, 95]) {
      const s = decideChrome({ lastY: 100, y, hidden });
      assert.equal(s.hidden, hidden, `a ${y - 100}px wobble flipped the bar`);
    }
  }
});

t('ignored wobbles do not move the anchor - a slow scroll still counts', () => {
  // If the anchor crept along with every ignored move, scrolling slowly -
  // every frame's delta under the dead band - would never hide the bar.
  let s = { hidden: false, lastY: 0 };
  for (let y = 3; y <= 30; y += 3) s = decideChrome({ ...s, y });
  assert.equal(s.hidden, true, 'thirty slow pixels downward never hid the bar');
});

t('a direction change reverses the state without a dead zone hangover', () => {
  let s = { hidden: false, lastY: 0 };
  s = decideChrome({ ...s, y: 200 });         // down: hide
  assert.equal(s.hidden, true);
  assert.equal(s.lastY, 200, 'the anchor must follow a counted move');
  s = decideChrome({ ...s, y: 190 });         // 10px back up: show again
  assert.equal(s.hidden, false);
});

console.log(`chrome: ${pass} groups passed`);
