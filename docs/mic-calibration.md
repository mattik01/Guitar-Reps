# Mic calibration & detection — status

Status of the microphone chord-detection + calibration overhaul. Last updated 2026-07-16.

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

The old **passive auto-calibration** (learning silently during exercises) is being retired.
Its removal from the exercises is deferred (see "Next").

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

All verified L1 (`check:profiles`, `check:chroma`) + L2 (synthetic-mic Playwright). **Not yet
verified on a real guitar (L3)** — that's the user's step.

## Next

Blocked on the shared exercise files (`SwapRoutine.tsx`, `ChordQuizRoutine.tsx`) being quiet —
other sessions are editing them:

- **Phase 5** — exercises recognize via the contract + learned profiles, and the
  **calibration-gate contract**: an exercise using the mic requires every involved chord to be
  calibrated (≥ `CAL_MIN_SCORE`); otherwise it falls back to no-mic and highlights the chords
  that need calibration.
- **Phase 3** — consolidate the ~12 scattered chord render sites into one modular `ChordCard`
  carrying the score badge + "calibrate" link everywhere.

Self-contained, can happen anytime:

- **Phase 6** — harmonic-weighted chroma (accuracy; higher regression risk, real-guitar-only
  validation).
- **Phase 7** — Basic Pitch (Spotify, TF.js) per-note coaching in the Studio, then a delayed
  confirmation channel in the quiz. `expectedPcs` is already stored for this.
- **Phase 8** — strumming-based harvesting (free-strum auto-capture, then continuous).
- **Later** — clustering (down/up-strum variants as separate centroids, nearest-match
  recognition). Explored, deferred; slots in behind `checkSignal`.

## Tuning knobs (await real-guitar L3 tuning — provisional)

- `SIGNAL_OFF_CHORD_SIM = 0.4`, `SIGNAL_MUDDY_BELOW = 45`, capture quality floor `0.15`
  (`signalContract.ts`).
- `CAL_SCORE_TARGET_WEIGHT = 6`, `CAL_MIN_SCORE = 60` (`calibration.ts`).
- Filter defaults HP 75 / LP 7000, activation threshold default 0 (`store.ts`).

## How to test

- **Unit (no mic):** `npm run check:profiles`, `npm run check:chroma`.
- **Manual:** `/mic-test` (input tuning + spectrum + diagnostics, always visible),
  `/calibrate` (priority list) → a chord → Calibrate then Test.
- **Headless (L2):** dev server on `:5173`, drive with Playwright, patch
  `navigator.mediaDevices.getUserMedia` to a synthetic Web-Audio stream
  (`dest.stream.clone()` per call — the app calls `track.stop()`).
- **Real guitar (L3):** the acceptance gate — only the user can do this.
