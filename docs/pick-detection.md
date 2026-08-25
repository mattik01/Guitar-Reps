# Single-pluck detection — status

"Which string did I just pick?" — the engine behind the picking exercises.
Sibling of `docs/mic-calibration.md`, which covers the *chord* engine.
Last updated 2026-08-25.

> **Status:** L1 (`check:picks`) and L2 (synthetic mic) pass; **not validated on a
> real guitar**, and one open problem below (the pick transient contaminating the
> analysis window) means per-pick verification is not yet trustworthy.
>
> **The picking exercise therefore ships WITHOUT the mic** (`/routine/pick`):
> metronome + self-report, the same way the quiz asks "got it?". An exercise that
> tells you you played it wrong when you didn't is worse than one that asks. The
> detection work below stays live behind `/pick-test`; when a real-guitar capture
> lets the constants be set from data, the routine gains verification by reading
> `checkPick` — nothing else about it has to change.

## Why this is not the chroma engine

`chroma.ts` folds the spectrum onto 12 pitch classes. For chord recognition that
is a feature; for "which string" it is fatal, because **octave duplicates are the
norm in open chords, not an edge case**:

| chord | frets | sounding notes | duplicates |
|---|---|---|---|
| G | `320003` | G2 B2 D3 G3 B3 G4 | three G's |
| Em | `022000` | E2 B2 E3 G3 B3 E4 | three E's |
| C | `x32010` | C3 E3 G3 C4 E4 | C3/C4, E3/E4 |
| Am | `x02210` | A2 E3 A3 C4 E4 | A2/A3 |
| D | `xx0232` | D3 A3 D4 F#4 | none — the easy one |

Two further blocks: `ChordListener` classifies a single pluck as a **knock** on
purpose (`activePc < MIN_ACTIVE_PITCH_CLASSES`), and its event timestamps are
quantised to the 25 ms analysis tick — the same order as the rhythmic error a
timing-evenness score is trying to measure.

## What makes it tractable

We always know the chord being held, so there are **at most six candidate
pitches, known in advance**. This is verification against a tiny known set, not
open pitch detection — the same bet the chord engine makes ("we only ever compare
against 1–2 KNOWN targets"), one level down.

## The algorithm (`src/audio/pluck.ts`, pure / Node-safe)

1. **Onset delta.** The caller passes `max(0, post − pre)` magnitudes, so strings
   that were already ringing cancel and only new energy is scored.
2. **Harmonic comb.** Each candidate scores `Σ (1/h)·energy(h·f₀)`, `h = 1..8`,
   each partial read by peak-picking a small window around it
   (`PLUCK_PARTIAL_TOLERANCE_CENTS`, with a one-bin floor).
3. **Sub-octave penalty — the octave disambiguator, and the core trick.** G3's
   comb is a strict *subset* of G2's, so comb score alone can never rule the
   lower octave out once the low string's fundamental is attenuated (mic
   response, room, and our own 75 Hz high-pass all sit on top of E2 ≈ 82 Hz).
   Energy at **half-integer** multiples (`f/2, 3f/2, 5f/2 …`) belongs to the note
   an octave *below* and not to the candidate, so subtracting it collapses
   exactly the confusion the subset relation creates.
   It fires **only when a candidate one octave down exists in the held shape** —
   unguarded, the probe lands on real chord tones (on a G shape, 3/2 × G2 =
   147 Hz *is* D3) and would punish a correct answer.

Three gates, deliberately separate:

- `margin` — top-two gap; below `PLUCK_AMBIGUOUS_MARGIN` we say **unsure**,
  mirroring `bestOfSignal`.
- `strength` — how far the winning comb stands above what pure noise would score
  on the same delta (`raw / (raw + noiseComb)`, noise estimated from the median
  in-band bin). **Not** a fraction of total energy — see the findings below.
- `newness` — the **winning string's** gain over its own previous level → `isNew`.
  Per string, not per chord; see the findings.

**`isNew` and `ambiguous` must not be conflated.** An ambiguous pluck is a real
pick we cannot name — it still counts for timing and shows as unverified.
`!isNew` means the onset was a re-trigger on a note already ringing, and must not
be counted. The engine **emits it anyway**, flagged; the drop happens at the
contract (`PickSignal.isPick`). An earlier version swallowed them inside the
engine, which made "picks went missing / doubled" impossible to diagnose — the
Pick Lab now shows them as `re-trigger` rows and tallies them separately.

## The engine (`src/audio/pluckListener.ts`)

A separate class from `ChordListener`, not a mode inside it: 10 ms loop (vs 25),
1024-sample onset FFT, 4096 analysis FFT (~85 ms — short enough that the previous
pick isn't inside it), 90 ms refractory (~11 picks/s) instead of the 250 ms strum
debounce. Shared with the chord engine by copy, not by abstraction: the
getUserMedia flags, the asymmetric min-tracking noise floor, the adaptive
spectral-flux onset test, the HP/LP front-end.

Three things it does that the chord engine does not:

- **Sub-tick onset timing.** The attack is located inside the time-domain buffer
  by steepest envelope rise and `at` is back-dated, taking timestamp error from
  ±25 ms to a few ms. Without it an evenness score measures our polling grid.
  (Steepest *rise*, not first crossing of a level: with the previous string still
  ringing, the whole buffer sits above any absolute level.)
- **Attack-relative re-arm latch.** After an onset, flux must fall to 25 % of
  *that attack's own peak* before firing again. Relative to the attack rather
  than to the adaptive threshold, because the threshold itself moves in the wake
  of a loud onset.
- **Echo rule.** An onset within 250 ms of another must carry at least 35 % of
  the previous attack's flux peak. See the findings.

## The contract

`signalContract.ts` gained the picking half: `PickSignal` /
`pickSignalFromPluck` / `checkPick`. Routines must not read `PluckEvent`
internals, same rule as `StrumEvent`.

**No calibration gate.** This path matches absolute frequencies against the held
shape's own harmonics and never reads `reps.chordProfiles`, so a chord's
calibration score is irrelevant to it. Wiring the gate in would block the feature
for no reason.

## What we cannot detect

**Pick direction (down vs up).** Not recoverable from audio. The exercises will
show it as a hint and must never score it.

## Findings

### The strength gate was measuring the wrong thing (2026-08-25, first real-guitar pass)

Matteo's first L3 run, on **Em**: mostly *"unsure"*, plus picks going missing and
doubling. Not confidently-wrong strings — so the sub-octave mechanism was fine
and the gates were the problem.

The tell was in our own passing test output: on a **noiseless synthetic** pluck,
`strength` scored **0.17–0.21** against a **0.15** threshold. A perfect signal
barely cleared the bar, so a real one never could.

**Cause.** `strength` was the winning comb ÷ the delta's TOTAL in-band energy.
That denominator grows with every busy bin — pick noise, body resonance, five
other strings ringing sympathetically — none of which says anything about whether
a chord tone sounded. The metric fell as the room got livelier, which is exactly
backwards.

**Fix.** Measure against the delta's own noise floor instead: estimate what a
comb would score on noise alone (median in-band bin × the comb's 1/h weights) and
report `raw / (raw + noiseComb)` — 0.5 means "no better than the room", 1 means
"nothing but the note". Scale-free, and it stays put as the room gets louder.
`PLUCK_MIN_STRENGTH` moves 0.15 → 0.6 on the new scale. `check:picks` pins the
reason, not just the outcome: the same noisy pluck that now passes is asserted to
have *collapsed* under the old definition.

> **Em is the worst chord in the library for this**, worth knowing before reading
> any Em result: E2 B2 E3 G3 B3 E4 — **five of six strings sit in an octave
> relationship** (E2/E3/E4 and B2/B3); only the G string is free of one. G, by
> comparison, entangles three.

### Letting the strings ring broke the newness gate (2026-08-25, from Matteo)

> *"I am not muting strings in between playing, the old ones keep ringing for a while."*

Which is not user error — the video explicitly says to let them ring out, so it is
the required behaviour.

`newness` was `new energy ÷ EVERYTHING already ringing`. That denominator grows
with every pick in a run while each new pick (a thin high string, say) adds
relatively less, so the gate starts discarding real picks — and does so **more
the further into the pattern you get**. It is also fatal to the exercise's core
move, the same string picked four times against a loud ringing chord.

**Fix: ask it per string.** Did the winning string gain energy over *its own*
previous level (`comb(delta, winner) / (comb(pre, winner) + noiseComb)`)? That
question is well-posed no matter how much else is sounding: a silent string has a
pre-comb near zero, a re-struck string lands around 1, and an onset where nothing
was struck lands near zero. `check:picks` covers both new cases, including one
asserting the old whole-chord denominator *would* have discarded a quiet pick
over five ringing strings.

The threshold then had to come DOWN to 0.05, not up. Measured on the bench, a
re-pluck's newness decays across repeats (0.82 → 0.41 → 0.32 over four), so any
bar high enough to reject phantoms also rejects real picks. Separating those two
is the onset detector's job, not this gate's — see the open problem below.

### OPEN: the pick transient contaminates the analysis window

The physically right way to tell a real re-pluck from a phantom re-trigger is the
**pick's broadband attack transient** — a pick contacting a string makes one, a
wobble in a decaying chord does not. Two things block it today:

1. **It cannot be validated here.** The first harness synthesised pure sine
   harmonics to the 8th, i.e. nothing above ~800 Hz for a low string — no
   transient at all — so a transient gate appeared to delete every real pick.
   `attackRatio` (high band vs its own running level) is therefore **measured and
   reported on every event, but does not gate anything**. It rides into the Pick
   Lab's capture file so the constant can be set from a measured distribution.
2. **Modelling the transient exposed a real design tension.** With the transient
   present, it lands inside the post-onset analysis window and pollutes the delta,
   which wrecks string ID. The window is ~85 ms long and starts 30 ms after the
   onset, so it *cannot* exclude a transient at t=0 — you would have to start past
   85 ms, by which point the next pick is arriving. Candidate fixes, all needing
   real audio to choose between: push the post window later and dilute the
   transient by averaging more frames; shorten the FFT (costs low-string
   resolution); or notch the transient out explicitly.

**Lesson: the synthetic bench proves wiring, not tuning.** Three rounds of tuning
against it each reversed the previous round's conclusion as the synth turned out
to model the wrong thing — first too-quiet sustain, then a missing pick
transient, then too loud a one. Its notes now model sustain and a transient, and
`docs`/`CLAUDE.md` say what a faithful synthetic pluck needs.

### Onset re-triggering (synthetic, L2)

A pick's attack spans several 10 ms frames and kept firing 2–3 phantom onsets.
Three mechanisms, added in this order as each exposed the next:

1. **Re-arm latch** — flux must fall to 25 % of *that attack's own peak* before
   firing again (relative to the attack, not to the adaptive threshold, which
   itself moves in a loud onset's wake).
2. **Newness gate** — see below.
3. **Echo rule** — an onset within 250 ms of another must carry at least 35 % of
   the previous attack's flux peak. A real pick hits about as hard as the one
   before it; the tail of a single attack does not. This was needed because the
   pre-onset snapshot of a *closely following* onset is itself contaminated: its
   85 ms analysis window is only part-filled with the new note, so the re-trigger
   genuinely looks "new" to the newness gate.

### A near-zero delta looked confident (synthetic, L2)

A false onset on a decaying note yields a delta that is ~0 everywhere, and a
ratio of two tiny numbers is arbitrarily confident — it once named a *wrong*
string at margin 1.00. Fixed by the newness gate, asserted from both sides: the
gate rejects it, and *without* a baseline the same delta would have named a
string, so deleting the gate fails the test rather than silently passing.

### Not the problem: string inharmonicity

Suspected first, and worth writing down as ruled out. Real partials sit at
`f₀·h·√(1+B·h²)`; for guitar `B ≈ 1e-4…3e-4`, which at the 8th partial is only
~16 cents — well inside one FFT bin up there. The partial search window was moved
from a fixed ±1 bin to **cents** anyway, because a fixed bin count is absurdly
uneven across the range (~230 cents at low E's fundamental, ~26 cents at 800 Hz),
but this was not the cause of the poor Em result.

L2 result: with quiet sustain and no pick transient, 6 synthetic plucks on a held
G gave 6 correct strings including all three G octaves. With realistic sustain AND
a modelled transient, string ID degrades and phantom onsets appear — that is the
open problem above, and it is why the next step is real captured audio rather
than more synthetic tuning.

## Tuning knobs (await real-guitar tuning — provisional)

`PLUCK_HARMONICS 8`, `PLUCK_FMAX 5000`, `PLUCK_PARTIAL_TOLERANCE_CENTS 45`,
`PLUCK_SUBOCTAVE_PENALTY 0.8`, `PLUCK_AMBIGUOUS_MARGIN 0.12`,
`PLUCK_MIN_STRENGTH 0.6`, `PLUCK_MIN_NEWNESS 0.08` (`pluck.ts`);
`FLUX_THRESHOLD_K 2.6`, `ONSET_REFRACTORY_MS 90`, `ONSET_REARM_RATIO 0.25`,
`ONSET_ECHO_WINDOW_MS 250`, `ONSET_MIN_ECHO_FLUX 0.35`, post window 30–110 ms
(`pluckListener.ts`).

## How to test

- **Unit (no mic):** `npm run check:picks`.
- **Headless (L2):** dev server on `:5173`, `pick.mjs` in the session scratchpad —
  synthetic mic playing single notes (harmonic stack, long decay) 600 ms apart.
- **Real guitar (L3):** `/pick-test`. The acceptance gate. Turn on **Ground
  truth** to build a confusion matrix, and use **Capture JSON** to download the
  last 24 picks WITH their delta spectra — that file lets the whole decision be
  re-run and re-tuned offline against real audio, instead of guessing from a
  matrix.
