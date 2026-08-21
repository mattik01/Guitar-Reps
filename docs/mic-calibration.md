# Mic calibration & detection — status

Status of the microphone chord-detection + calibration overhaul. Last updated 2026-08-20.

> **Working-tree note:** nothing here is committed yet, and the tree is shared with
> other in-flight work. The files listed below are this feature's surface.

## The idea

Split what used to be one tangled "calibration" into **two separate concerns**:

1. **Mic Input Tuning** *(global, per-rig)* — input sensitivity + noise filters + a live
   meter. One shared control used in every mic screen. `src/components/MicInputTuning.tsx`,
   backed by `micSettings` (`src/state/store.ts`).
2. **Chord Calibration** *(per-chord, deliberate)* — a focused **Studio** where you play a
   chord cleanly so the app learns how it sounds on *your* guitar. Every chord gets a 0–100
   calibration score.

The old **passive auto-calibration** (learning silently during exercises) is **retired** — the
`reps.micCalibration` store is gone, and `retirePassiveCalibration()` (store.ts, called from
`main.tsx`) drops the stale key on first load. It was deliberately NOT migrated into
`chordProfiles`: its samples are sim-only (no chroma), so they cannot build a learned prototype
but *would* raise the score — letting a chord pass the calibration gate with nothing learned.

## Architecture

### The signal contract — the key boundary
`src/audio/signalContract.ts` is the **black box between the mic engine and everything that
consumes detection** (calibration now; exercises later). Callers must not touch
`ChordListener`/`StrumEvent` internals — only this:

```
producer → ChordSignal → checkSignal(signal, target) → SignalCheck
```

- `signalFromStrum(StrumEvent) → ChordSignal` — the one adapter that knows the engine shape.
- `ChordSignal` — engine-agnostic strum (chroma, cleanliness, sustain, active-pc count).
- `chordTargetFromShape(id, shape, {reference?, thresholds?}) → ChordTarget`.
- `checkSignal(signal, target) → SignalCheck` — **the checkable boundary**: returns
  `similarity`, `verdict`, `isMatch`, a `quality` weight (0 = don't record), and `warnings`
  (`off-chord` / `muddy` / `too-quiet`).
- `bestOfSignal(signal, targets) → SignalRanking` — **multi-target selection** ("which of these
  chords is it?"), used by the swap routine for A-vs-B. Mirrors the engine classifier exactly:
  score = similarity / `typicalSim`, single target always confident, `best` null unless the
  top-two gap is *strictly* greater than `SIGNAL_AMBIGUOUS_MARGIN` (0.04). With uncalibrated
  targets it reduces to plain cosine-vs-template ranking — i.e. identical to the pre-Phase-5
  behaviour, which `check:profiles` asserts.

The exercises deliberately feed `ChordListener` **bare `{id, shape}` targets** and make every
match/rank decision caller-side. The listener can only ever match the theoretical template
(`setTargets` derives it from the shape; there is no reference channel), so this is the only way a
*learned* prototype can influence recognition — and it keeps the engine swappable.

This lets us swap the detection internals (harmonic-weighted chroma, Basic Pitch note
validator, clustering) behind `checkSignal` without changing any caller.

### Detection engine
`src/audio/chordListener.ts` (+ `useChordListener.ts` hook). 40 Hz loop, spectral-flux
onsets, chroma matching. Tier-1 DSP filters (high-pass/low-pass, tunable) live here, plus a
pre-filter `rawAnalyser` used only for the spectrum viz. Pure math in `src/audio/chroma.ts`.

### Calibration data + math
- Store: `reps.chordProfiles` (`CalibrationProfile` = `{ samples, expectedPcs, updatedAt }`),
  `recordChordSample` / `clearChordProfile` (`src/state/store.ts`). **Every clean sample is
  kept** (no rolling window; soft cap `CAL_SAMPLE_CAP = 500`).
- Math: `src/audio/calibration.ts` — `profilePrototype` (quality-weighted mean chroma =
  learned reference), `profileThresholds` / `profileTypicalSim`, `profileScore` (0–100),
  `samplesLeftToMinScore`, `CAL_MIN_SCORE = 60`.
- `chordTargetFromProfile(id, shape, samples)` is THE adapter the exercises use. It degrades
  exactly to `chordTargetFromShape` when there's nothing learned.
- **Similarity scale:** samples store `sim` measured against the *template*, but at exercise time
  `checkSignal` scores against `max(template, reference)`. Deriving thresholds from the former and
  applying them to the latter makes them systematically too permissive, so
  `profileThresholdsAgainst` / `profileTypicalSimAgainst` re-measure each stored chroma against the
  target actually in use. (`profileThresholds`/`profileTypicalSim` remain, template-scale, for
  Studio display.)
- `shapeKey(shape)` fingerprints frets + baseFret + barre — **not** `fingers`, since re-annotating
  which finger frets a note doesn't change the sound. It's stamped onto the profile so the gate can
  spot a shape edit or fingering switch. `ChordEditor` owns invalidation (warns, then clears on a
  real shape change) for every edit path.

### The calibration gate
`evaluateCalibrationGate(profiles, chordIds, shapeKeys)` (pure) + `useCalibrationGate` (React).
A chord is ready at `score >= CAL_MIN_SCORE` **and** with a non-null prototype and thresholds.
An exercise that auto-recognizes chords requires EVERY chord involved to be ready; if any isn't it
does **not** run degraded — the mic is never opened at all, the no-mic flow stays, and the offending
chord's `ChordCard` chip is highlighted (`.cal-chip.needs`) next to a deep link into the Studio.

### UI
- `src/routes/CalibrationIndex.tsx` — `/calibrate`: repertoire as a **priority worklist**
  (uncalibrated first, then lowest score first) + library chords in a secondary section.
- `src/routes/CalibrationStudio.tsx` — `/calibrate/:chordId`: **Calibrate** mode (auto-captures
  clean strums via the contract, live cleanliness, score bar, Live-vs-Learned chroma) and
  **Test** mode (recognizes against the learned reference; shows `Recognized ✓` + `learned X ·
  template Y`). Embeds `MicInputTuning`.
- `src/components/FilterSpectrum.tsx` — live spectrum with draggable HP/LP cutoff lines (shown
  in the input tuning on `/mic-test`).
- `src/components/MicDiagnostics.tsx` — the `/mic-test` diagnostics.

## Done

- [x] **Phase 0** — shared `MicInputTuning` (sensitivity + filter toggle + meter).
- [x] **Phase 1** — Tier-1 DSP filters (HP ~75 / LP ~7 k, tunable), draggable sensitivity
      threshold, live spectrum with draggable cutoffs.
- [x] **Phase 2** — `CalibrationProfile` data model + math + `npm run check:profiles`.
- [x] **Phase 4** — Calibration Studio + priority index + the **signal contract** + **Test
      mode**.
- [x] **Phase 3** (2026-08-20) — every chord render in the app now goes through one modular
      `ChordCard` (`variant` tile/feature/bare × `size` sm–xl, diagram/fingering/none, meta,
      footer, actions, status slots), carrying the calibration chip everywhere. No hand-rolled
      `.chord-card` markup remains. `src/data/chordResolve.ts` owns the `CardChord` adapters and
      the shared `resolveChord` lookup (repertoire first, else library at the user's saved
      fingering — which also fixed the Studio calibrating a different voicing than the exercises
      used). Also fixed: `.chord-card` claimed `cursor: pointer` even when not clickable.
- [x] **Phase 5** (2026-08-20) — the exercises consume the profiles: bare targets to the listener,
      `checkSignal` (quiz) / `bestOfSignal` (swap) caller-side, the calibration gate in both, and
      passive auto-calibration fully retired. `/mic-test` and `MicDiagnostics` now read
      `chordProfiles` too.

L1 = `check:profiles` (57 assertions incl. the no-regression, scale-consistency, margin-boundary
and gate cases). L2 = synthetic-mic Playwright: gated exercise falls back and **never opens the
mic**, calibrating in the Studio un-gates it, alternating strums count while repeated same-chord
strums don't, and a fret edit clears the profile while a fingers-only edit doesn't.
**Not yet verified on a real guitar (L3)** — that's the user's step, and it is the acceptance gate.

## Next

Self-contained, can happen anytime:

- **Phase 6** — harmonic-weighted chroma (accuracy; higher regression risk, real-guitar-only
  validation).
- **Phase 7** — Basic Pitch (Spotify, TF.js) per-note coaching in the Studio, then a delayed
  confirmation channel in the quiz. `expectedPcs` is already stored for this.
- **Phase 8** — strumming-based harvesting (free-strum auto-capture, then continuous).
- **Later** — clustering (down/up-strum variants as separate centroids, nearest-match
  recognition). Explored, deferred; slots in behind `checkSignal`.

## Real-guitar finding: the rig-signature problem (2026-08-20)

First L3 run, testing a calibrated **E**: *"template works way better — I can pretty much strum
whatever chord and get a high score, but template gets angry."* The learned reference was matching
**everything**.

**Cause.** A chroma vector captured from a real guitar has broadband energy on *every* pitch class
— harmonics, room, strings ringing through. That "rig signature" is identical for every chord
played on that rig, so it dominates the learned prototype. Plain cosine between two non-negative
vectors sharing a large common component is high no matter what the peaks do, so the prototype
scored high against any chord. The sparse theoretical template has no such common component, which
is why it still discriminated.

Made worse by `checkSignal` using `max(tplSim, refSim)`: the inflated reference score always won,
so the reference could only ever *loosen* recognition, never tighten it — one bad number overrode
the template's better discrimination.

**Fix.** The reference is now compared with **centered cosine** (`centeredCosineSim` = Pearson
correlation — cosine after removing each vector's mean), which strips the shared component and
compares only the chord-identifying peaks. And the reference **replaces** the template rather than
being max'd with it; `chordTargetFromProfile` refuses to attach a prototype flatter than
`CAL_MIN_PROTOTYPE_SPREAD`, so "has a reference" implies "is discriminative".

On a simulated rig, right-vs-wrong separation went **0.171 (plain cosine vs prototype) → 0.248
(template) → 0.397 (centered vs prototype)**. Wrong chords now land near zero or negative.

**Existing profiles survive** — samples store raw chroma, and thresholds are re-measured from it,
so only the comparison changed. No recalibration needed.

**Lesson for future work:** the test that let this through asserted the learned reference scored
*higher* than the template. That is the wrong property. `check:profiles` now asserts it
**discriminates better** (right-chord minus best-wrong-chord), and that assertion fails against the
old implementation.

## Threshold retune + the E/Em limit (2026-08-20, real data)

**Recall was broken by the scale change.** With centered correlations the sims spread far wider
than plain cosine (a real 21-sample E profile spanned 0.50–0.98), so the old `q25 × 0.94` rule put
the match threshold at **0.844** — which only **76% of the user's own calibration samples** cleared.
Live strums matched about half the time, while wrong chords sat at ≤ 0.15: huge headroom, unusable
recall. Retuned to **`CAL_QUANTILE = 0.10`, `CAL_MARGIN = 0.90`, `CAL_MATCH_MIN = 0.35`** →
threshold 0.684 on the same profile, 90% of samples admitted, still 0.53 of headroom.
Recall is the right thing to favour: a false "sounded right" is caught the instant you look at the
diagram, whereas being told you played it wrong when you didn't is useless and demoralising.
`check:profiles` now asserts the threshold lands **in the gap**, not on the right-chord tail
(and that assertion fails against the old constants).

**E vs Em cannot be separated from chroma — don't keep trying.** Measured on real profiles
(21 × E, 54 × Em on the same rig):

| method | E correct | Em correct | overall |
|---|---|---|---|
| full-vector prototype comparison | 86% | 43% | **55%** (chance) |
| Fisher discriminant on the separating axis (leave-one-out) | 81% | 48% | **57%** |
| robust MAD pruning of outlier samples, any strength | 86% | 41–43% | **53–55%** |
| *(filtering to the most self-consistent samples looked like 84% — that was **circular selection**, not a real result)* | | | |

Root cause is physical, not algorithmic: E and Em differ in exactly one pitch class (G# vs G), and
octave-folded chroma discards which string sounded it, so harmonics bleed the two together. Per
strum, E shows G# > G only **71%** of the time and Em shows G > G# only **63%** — about 2:1 odds,
not certainty. Note that a two-bin G/G# comparison (~67%) beats the full-vector comparison (55%),
because the other ten bins are pure noise for this pair.

The correct behaviour is therefore **"unsure", not a guess** — which the system already does
(`bestOfSignal` ambiguity margin; the swap routine assumes alternation when unsure; `check:chroma`
has always flagged E↔Em). The real fix is **Phase 7** (Basic Pitch, per-string note detection).

## FIXED (2026-08-21): cleanliness was not comparable across chords

A clean Em scores 80-85 while a clean Am scores ~60 on the same rig. Measured cause, from real
profiles (21xE, 54xEm, 13xAm): the **completeness** component (35 pts) counted a chord tone as
present only at >= 0.30 of the LOUDEST chord tone, then scored `present/3` as a hard step.
Median tone ratios vs the loudest tone:

| chord | loudest | others | notes counted | completeness pts lost |
|---|---|---|---|---|
| Em | B | E 0.56, G 0.49 | 3/3 | 0 |
| E  | B | E 0.75, G# 0.39 | 3/3 | 0 |
| Am | A | C 0.06, E 0.16 | 1/3 | **23.3** |

That 23-point loss is essentially the whole gap. Three structural biases stack against Am and none
are about playing quality:
1. **The bar is relative to the loudest chord tone.** Am's root is doubled AND open (open A + G
   string 2nd fret) so A dominates, which RAISES the bar for C and E. A chord with one dominant
   doubled note is penalised for it.
2. **Am mutes the low E** — a damped strummed string adds broadband/inharmonic energy, hurting
   `tonality`. E and Em ring all six strings.
3. **Fewer open strings** (Am 2, Em 4) → faster decay → lower `sustain` (ref 0.7).

Consequence beyond the displayed number: `quality = max(0.15, clean/100)` feeds the sample weight,
so structurally-penalised chords accumulate calibration score ~1.4x slower and have their samples
permanently down-weighted, for no good reason.

**Caveat — it isn't purely a scoring artifact.** Am's C at 6% of the root is too low for bias alone;
something is likely genuinely choked on the B string. The metric AMPLIFIES a real fault rather than
inventing one. Both are true.

**Fix, shipped 2026-08-21** (`computeCleanliness` + `presence` in `chroma.ts`), two changes to the
completeness block only — no threshold was touched:

1. **The reference is the MEAN expected tone, not the loudest.** A chord is no longer punished for
   having one dominant doubled root.
2. **A smooth ramp (`presence`, smoothstep) replaces the hard step**, from 0 at
   `CLEAN_COMPLETENESS_LO` (0.10) to 1 at `CLEAN_COMPLETENESS_HI` (0.45) of that reference. A
   weak-but-audible note now earns partial credit instead of scoring the same as silence.

Measured effect on the real profiles above:

| chord | completeness before | after | score change |
|---|---|---|---|
| Em | 1.000 | 1.000 | unchanged |
| E  | 1.000 | 1.000 | unchanged |
| Am | 0.333 | **0.660** | **+11.4 pts** (~60 → ~71) |

Am's E string (0.16) went from uncounted to ~0.93 — that was pure artifact. Am's C (0.06) still
scores ~0.05, so the **genuinely choked B string still costs ~11 points**: the band was chosen
deliberately so the metric stops inventing a fault without hiding the real one. Locked in by
`check:profiles` (section 9), which asserts both directions.

Still open, longer term: **per-chord normalisation** — cleanliness relative to what is achievable
for THAT chord on THIS rig — plus the `tonality`/`sustain` biases (2) and (3) above, which are
smaller and untouched. Phase 7 note-level detection is what makes the honest version possible.

## What makes a calibration sample GOOD (learned 2026-08-21)

Cleanliness alone does NOT identify a bad sample, and neither does the stored `sim`.
From a real 35-sample Am profile where the B string was choked on 22 of them:

| group | median cleanliness | median similarity |
|---|---|---|
| C choked (0.04–0.16 of root) | **84** | 0.55 |
| C ringing (0.30–1.00 of root) | 92 | **0.79** |

- **Cleanliness saturates.** `completeness` is only 35 of the 100 points, so a chord with one dead
  string still scores in the mid-80s when purity/tonality/sustain are fine.
- **The stored `sim` is self-referential.** Once a profile exists, `chordTargetFromProfile` scores
  against the *prototype*, so each sample was measured against a target the earlier bad samples had
  already contaminated. Never prune on it directly.
- **Gate on raw tone ratios instead** — is each expected pitch class actually present, as a fraction
  of the loudest chord tone? That measurement is independent of both.

**Use the template as a presence gate, never as a ranking.** `chordTemplate` knows which pitch
classes sound and how often each is doubled (Am `x,0,2,2,1,0` → A×2, E×2, C×1, plus fifth bleed), so
it is reliable for "is this note sounding at all". It knows nothing about mic, room, strings or
pickup — that rig signature is precisely what calibration exists to learn. Ranking samples by
template-closeness would drag the profile back toward theory and undo calibration. Pruning Am on a
presence gate alone moved its prototype closer to the template on its own (0.687 → 0.807) and cut
its G# contamination from 0.42 to 0.27 — theory and rig agreeing *independently* is the signal that
a gate was the right one.

**A tight profile produces a STRICT threshold.** Thresholds are `q10 × 0.90`, so a profile is only
as forgiving as its worst sample. A profile built purely from careful, deliberate Studio strums has
no sloppy tail and its threshold ends up hard against its own best playing:

| chord | samples | match | own samples below it | min headroom |
|---|---|---|---|---|
| E | 21 | 0.684 | 2 of 21 | −0.131 |
| Em | 54 | 0.569 | 4 of 54 | −0.505 |
| Am (pruned to 10) | 10 | **0.714** | **0 of 10** | **+0.038** |

E's tail is *why* it recognises well at exercise speed. The remedy for an over-strict chord is more
samples played the way they are played IN an exercise — not re-admitting junk.

## Ambient chroma floor (added 2026-08-21)

Steady room noise lands in NOTE bins, not just between them, and until now nothing removed it:
`foldSpectrumToChroma`'s output went into matching, cleanliness and calibration samples raw. Only
the between-note and buzz bands had ambient floors.

Measured on the real rig (laptop mic, `/mic-test`, no guitar) — a broad low-frequency mechanical
hump, not a tone, and **no harmonic stack**, which rules out mains hum:

| condition | peak | level | top chroma bin |
|---|---|---|---|
| fans up | 99.6 Hz | 0.095 | **G** (1.00, dominant) |
| all 8 cores loaded | 76.2 Hz | 0.165 | **F#** |
| powersaver | 111.3 Hz | 0.153 | F# / G / A (tied) |
| balanced | — | swings **5x in 15 s** | G |

Two facts drive the design:
- **The amplitude varies enormously** (5x within 15 s in balanced mode, as fan RPM tracks CPU load).
- **The shape is fairly stable** across power modes (cosine 0.99 between powersaver and balanced) but
  DOES move under heavy load (peak 76 Hz vs ~100 Hz), and would move much more on another device.

A calibrated profile can absorb a CONSTANT rig signature; it cannot absorb one that changes while
you play. Hence a live per-bin floor rather than a one-off measurement. Note that only **7%** of the
noise energy sat below `CHROMA_FMIN` (90 Hz), and in powersaver the peak was 111 Hz — so **raising
the cutoff was considered and rejected**: no fixed cutoff catches a target that wanders 76→111 Hz.

`applyChromaFloor` (`chroma.ts`) — pure, so `check:profiles` can assert it without a mic:
- asymmetric min-tracking EMA per pitch class, `CHROMA_FLOOR_FALL_ALPHA` 0.1 / `CHROMA_FLOOR_RISE_ALPHA`
  0.002 (falls fast to converge in the silence between strums, rises slowly);
- subtracts `CHROMA_FLOOR_SUBTRACT` (0.9) of the floor, clamped at zero — deliberately under 1, since
  min-tracking already sits at or below the true mean and over-subtraction would carve harmonics out
  of quiet chord tones;
- **`learn` gates the UPDATE only, never the subtraction.** Drilling one chord (what the quiz and
  new-chord routines ask for) keeps the same bins lit continuously; a floor that kept learning
  through that would rise into the chord and erase it. The engine learns only while nothing sounds
  (`rms` below the noise gate AND no pending onset). `check:profiles` has an assertion whose only
  job is to fail if that gate ever stops mattering.

Measured benefit on a synthetic chord through the real captured noise (chord-recovery cosine):
SNR 2 → 0.975/1.000, SNR 1 → 0.928/0.999, SNR 0.5 → **0.840/0.995**.

**Known limitation:** min-tracking settles toward the QUIETEST recent state, so a fan surge partly
leaks through until the floor catches up (rise alpha ≈ a 500-frame time constant). That asymmetry is
the price of never eating the guitar. Residual after subtraction in balanced mode does not reach zero.

**Not yet validated on a real guitar** — L1 + L2 only. See the resume memory for the L3 recipe.

## Tuning knobs (await real-guitar L3 tuning — provisional)

- `SIGNAL_OFF_CHORD_SIM = 0.4`, `SIGNAL_MUDDY_BELOW = 45`, capture quality floor `0.15`
  (`signalContract.ts`).
- `CAL_SCORE_TARGET_WEIGHT = 6`, `CAL_MIN_SCORE = 60`, `CAL_MIN_PROTOTYPE_SPREAD = 0.06`
  (`calibration.ts`).
- `CAL_QUANTILE = 0.10`, `CAL_MARGIN = 0.90`, `CAL_MATCH_MIN = 0.35` (`chroma.ts`) — retuned from
  real data above; these are for the CENTERED scale, don't reuse plain-cosine intuitions on them.
- Filter defaults HP 75 / LP 7000, activation threshold default 0 (`store.ts`).

## How to test

- **Unit (no mic):** `npm run check:profiles`, `npm run check:chroma`.
- **Manual:** `/mic-test` (input tuning + spectrum + diagnostics, always visible),
  `/calibrate` (priority list) → a chord → Calibrate then Test. Then an exercise: an
  uncalibrated chord should show the gate note and no mic prompt; a calibrated one should arm.
- **Headless (L2):** dev server on `:5173`, drive with Playwright, patch
  `navigator.mediaDevices.getUserMedia` to a synthetic Web-Audio stream
  (`dest.stream.clone()` per call — the app calls `track.stop()`).
- **Real guitar (L3):** the acceptance gate — only the user can do this.
