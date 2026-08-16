# Openstring

A guitar reading trainer that listens to you play.

A note appears on the staff. You find it on the neck and play it. Openstring hears what
you actually played, tells you whether it was right and how long you took, and uses that
to decide what to ask next. There is a separate rhythm drill that plays a click, listens,
and tells you whether you rush, drag, or are simply uneven.

It runs entirely in your browser. No account, no server, no subscription, no telemetry.
Your progress lives in your own browser storage and nowhere else.

**[Try it](https://openstring.app)** — you need a microphone and a guitar.

---

## Why this exists

Learning to read music on guitar is badly served by free software. Nearly everything
good is a subscription, and the free tools each cover part of the problem:

- Flashcard trainers show you a note but let you answer by clicking, so you learn to
  recognise a symbol rather than to find it on the instrument.
- Tab-based tools skip notation altogether.
- **[Nootka](https://nootka.sourceforge.io/)** — free, open source, and genuinely good —
  listens to you play and drills notation properly. It is the closest thing to this and
  worth your time. But it does not enforce tempo, so it cannot tell you *when* you played,
  and it will not tell you what to work on next.

Openstring exists for those two gaps: **timing** and **deciding what to drill**.

## What it does

**Reading.** A note on a real staff, answered by playing it. Nothing is clickable. The
guitar's octave transposition is handled properly — the staff shows written pitch, the
microphone hears sounding pitch, an octave apart. Wrong answers tell you what you actually
played and where the right note was, and distinguish "wrong note" from "right note, wrong
string".

**Rhythm.** A click, a rhythm, and a verdict. Rushing, dragging and unevenness are
different faults with different cures, so they are reported differently rather than
collapsed into a percentage.

**Progress that drives practice.** Every fretboard position carries a running accuracy and
a running speed. Weak positions come up more often. A note you get right after four seconds
of hunting is *not* counted as learned — speed is part of the standard, because reading
fluently means recognising fast.

**A plan.** Six stages from open position to the twelfth fret. Advancement is earned by
measured fluency across the whole region, never by time served or a streak.

## Design notes

Some decisions that took measurement rather than guesswork:

**Pitch detection uses the McLeod method, and picks the earliest qualifying peak rather
than the tallest.** A guitar note is harmonic-rich and laptop microphones roll off bass,
so the fundamental is often quieter than its own second harmonic. Plain autocorrelation
reports the harmonic and you get an octave error — the classic bug in guitar tuners. The
test suite verifies every semitone from E2 to E5, including a synthetic tone with the
fundamental removed entirely.

**Onset detection thresholds on a *relative* rise, not an absolute one.** Measured on
synthetic plucks, the leftover envelope ripple on a sustained low E is about 21× the
absolute jump seen on a high E, so any fixed threshold either misses quiet high notes or
retriggers forever on loud low ones. As a proportion of the current level, ripple stays
under 0.06 across the range while a real attack is far above it. Worst timing error on
synthetic plucks is 1.3 ms.

**Notation is hand-drawn SVG.** No notation library and no music font — both are downloads,
and a missing glyph renders as a tofu box, which is worse than no clef at all.

**Timing honesty.** Your computer adds an unknown delay between the string moving and the
browser hearing it. So *consistency* (the spread of your timing) is always trustworthy,
while *rushing or dragging* is only as good as the delay estimate. The app says so, and
lets you calibrate. Use headphones for rhythm work — through speakers the microphone hears
the click and counts it as a note.

## Running it

It is static files. Nothing to build, nothing to install.

```bash
git clone https://github.com/zubvit/openstring.git
cd openstring
python3 -m http.server 8777
```

Then open `http://localhost:8777`. A microphone needs a secure context, so use `localhost`
or HTTPS — opening `index.html` from the filesystem will not work.

Tests are plain Node, no dependencies:

```bash
for f in test/*.test.mjs; do node "$f"; done
```

## Status

Early. The audio engine is well covered by tests against synthesised signals, but at the
time of writing it has had limited use with an actual guitar in an actual room. Expect
rough edges, and please report them.

Known limits:

- Single notes only. Chords are not detected — polyphonic pitch detection is a much harder
  problem and is not attempted.
- Standard tuning only.
- Rhythm drills need headphones to be reliable.

## Licence

MIT. See [LICENSE](LICENSE).

The treble clef is drawn from outlines taken from the **Bravura** music font,
© Steinberg Media Technologies GmbH, used under the SIL Open Font License 1.1
([full text](licenses/BRAVURA-OFL.txt)). The outlines are baked into the page as
SVG paths, so no font is downloaded or redistributed.
