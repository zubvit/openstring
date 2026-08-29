// The top chrome, taught to get out of the way.
//
// On a phone the topbar is two rows tall and sticky: mid-session it covered a
// quarter of the screen while saying nothing new. Scrolling down hides it;
// ANY upward scroll brings it back - people reach for the tabs by nudging the
// page up a little, not by scrolling all the way to the top, and a bar that
// only returns at the top reads as broken. The CSS side (which screens this
// applies to, how it animates, reduced motion) lives in css/app.css; this
// file only decides and sets one class on <body>.

/**
 * Should the chrome be hidden, given where the scroll went?
 *
 * Pure on purpose: the flicker bugs in this kind of code all live in the
 * decision, not the DOM call, so the decision is the part under test.
 *
 * Returns the next state AND the anchor to measure the next move against.
 * The anchor only moves when a move actually counts - if it crept along with
 * every ignored wobble, a slow steady scroll would arrive in steps smaller
 * than the dead band and never hide anything.
 *
 * @param {{lastY:number, y:number, hidden:boolean, jitter?:number}} s
 * @returns {{hidden:boolean, lastY:number}}
 */
export function decideChrome({ lastY, y, hidden, jitter = 8 }) {
  // At the top there is nothing above to reach for, so always show - and
  // clamping at 0 also swallows the negative positions Safari reports while
  // rubber-banding, which otherwise read as a wild upward scroll.
  if (y <= 0) return { hidden: false, lastY: 0 };
  const delta = y - lastY;
  // A finger resting on the glass wobbles by a few pixels; without a dead
  // band the bar twitches with every wobble.
  if (Math.abs(delta) < jitter) return { hidden, lastY };
  return { hidden: delta > 0, lastY: y };
}

if (typeof document !== 'undefined') {
  let state = { hidden: false, lastY: window.scrollY };

  // No requestAnimationFrame batching: browsers already deliver scroll at
  // frame rate, the work here is one comparison and at most one class
  // toggle, and rAF is throttled in hidden tabs - a deferred decision can
  // land long after the scroll that asked for it.
  window.addEventListener('scroll', () => {
    const next = decideChrome({ ...state, y: window.scrollY });
    if (next.hidden !== state.hidden) {
      document.body.classList.toggle('chrome-hidden', next.hidden);
    }
    state = next;
  }, { passive: true });

  // Seven tabs scroll sideways on a phone, so the one just tapped can be
  // sitting half-cut at the rim. Centre it, and pull its neighbour into view
  // with it - which is also the only hint that the row scrolls at all.
  document.querySelector('.tabs')?.addEventListener('click', (e) => {
    const tab = e.target instanceof Element ? e.target.closest('.tab') : null;
    if (!tab) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    tab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  });
}
