// The other part of the duet.
//
// A beginner playing three open strings sounds like three open strings. The same
// three notes over a moving bass sound like music, which is why every method book
// puts duets in the first lesson and why a practice app that only ever answers
// "right" or "wrong" feels like a test rather than a lesson. The app takes the
// teacher's part.
//
// It plays into the same room the microphone is listening to, so it also has to
// be honest about what that costs: the grader will hear these notes too. Nothing
// here tries to hide them - the caller is given the pitches and the times so it
// can decide what to forgive.

import { playChord } from './audio.js';

/**
 * Schedule the accompaniment.
 *
 * `events` are {sounding, beat, beats} on the piece's own beat timeline, and
 * `timeOfBeat` maps a beat to the audio clock - the metronome's own method, so
 * the part lands with the click rather than near it. Everything is scheduled up
 * front on the audio clock; a setTimeout per note would drift audibly.
 */
export function scheduleAccompaniment(ctx, events, {
  timeOfBeat, bpm = 72, volume = 0.075, maxHoldS = 3.2,
} = {}) {
  if (!ctx || !events?.length || !timeOfBeat) return [];
  const beat = 60 / bpm;
  const played = [];

  for (const ev of events) {
    const at = timeOfBeat(ev.beat);
    // Already gone. Starting a note in the past makes it fire immediately and
    // out of time, which is worse than dropping it.
    if (at < ctx.currentTime) continue;
    const hold = Math.min(maxHoldS, (ev.beats || 1) * beat * 0.95);
    playChord([ev.sounding], {
      ctx, spreadS: 0, holdS: hold, volume,
      // The app's own part must sit under his, not compete with it: quiet, and
      // no attempt at a bright attack.
      when: at,
    });
    played.push({ sounding: ev.sounding, at, until: at + hold });
  }
  return played;
}

/**
 * Was this pitch, at this moment, the app playing rather than him?
 *
 * The microphone cannot tell the difference, so the grader has to be told. Only
 * a pitch the accompaniment is actually sounding right now is forgiven - which
 * means a note he plays that happens to double the bass is still credited to
 * him, and that is the right way round: refusing to credit it would mark a
 * correct note wrong.
 */
export function isAccompaniment(played, sounding, at, { padS = 0.08 } = {}) {
  return played.some((p) => p.sounding === sounding
    && at >= p.at - padS && at <= p.until + padS);
}
