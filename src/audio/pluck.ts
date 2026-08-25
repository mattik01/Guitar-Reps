// Pure single-pluck ("which string did I just pick?") math.
//
// Node-safe on purpose, exactly like chroma.ts: no Web Audio, no DOM — so
// `scripts/checkPicks.ts` can assert the whole decision path without a mic.
//
// WHY THIS IS NOT chroma.ts
// -------------------------
// chroma.ts folds the spectrum onto 12 pitch classes, which throws the octave
// away. For chord recognition that's a feature; for "which STRING" it is fatal,
// because octave duplicates are the norm in open chords, not an edge case:
//
//   G  320003 → G2 B2 D3 G3 B3 G4   (three G's)
//   Em 022000 → E2 B2 E3 G3 B3 E4   (three E's)
//   C  x32010 → C3 E3 G3 C4 E4      (C3/C4 and E3/E4)
//   Am x02210 → A2 E3 A3 C4 E4      (A2/A3)
//   D  xx0232 → D3 A3 D4 F#4        (the easy one — all distinct)
//
// What makes this tractable is that we always KNOW the chord being held, so
// there are at most six candidate pitches and we are verifying against a tiny
// known set — not doing open pitch detection. Three ideas:
//
//  1. ONSET DELTA. The caller hands us `post - pre` magnitudes, so the strings
//     that were already ringing cancel out and only the new energy is scored.
//  2. HARMONIC COMB. Score each candidate by summed delta energy at h·f0,
//     h = 1..PLUCK_HARMONICS, weighted 1/h.
//  3. SUB-OCTAVE PENALTY — the octave disambiguator, and the core trick. The
//     comb for G3 is a strict SUBSET of the comb for G2, so comb score alone
//     can never rule the lower octave out. Energy at HALF-integer multiples of
//     a candidate (f/2, 3f/2, 5f/2 …) belongs to the note an octave BELOW it
//     and not to the candidate itself, so subtracting it collapses exactly the
//     confusion the subset relation creates. It is applied only when a
//     candidate one octave down actually exists in the held shape, so it can
//     never invent a penalty for an unrelated chord tone that happens to sit on
//     a half-integer multiple.
//
// Pick DIRECTION (down vs up) is not recoverable from audio at all. Nothing
// here pretends otherwise; the exercises show it as a hint and never score it.

import type { ChordShape } from '../state/store';

// ---- tuning -----------------------------------------------------------------

// Standard-tuning open-string MIDI notes, low E → high E. The absolute-pitch
// sibling of OPEN_PC in data/validateChords.ts, which keeps only pitch class.
export const STRING_MIDI = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
export const STRING_NAMES = ['E (low)', 'A', 'D', 'G', 'B', 'e (high)'];

// How many harmonics of a candidate to sum. A picked guitar string puts useful
// energy well past the 8th; beyond that the bins get crowded and neighbouring
// candidates start sharing partials.
export const PLUCK_HARMONICS = 8;
// Ignore partials above this — mostly pick noise and body resonance up there.
export const PLUCK_FMAX = 5000;
// Half-window searched around each expected partial, absorbing tuning error,
// string inharmonicity (a real partial sits at f0·h·sqrt(1+B·h²), slightly sharp)
// and bin quantisation. Expressed in CENTS with a one-bin floor: a fixed bin
// count is wildly uneven across the range — at 4096/48 kHz one bin is ~230 cents
// at low E's fundamental but only ~26 cents up at 800 Hz, i.e. far too loose
// where it matters and too tight where inharmonicity actually bites.
export const PLUCK_PARTIAL_TOLERANCE_CENTS = 45;
// How hard sub-octave evidence counts against a candidate. Below 1 on purpose:
// a real string's partials leak into the half-integer probes a little, so full
// subtraction would punish the correct answer.
export const PLUCK_SUBOCTAVE_PENALTY = 0.8;
// Top-two gap (on the 0..1 normalized scale) below which we refuse to name a
// string. Same shape as SIGNAL_AMBIGUOUS_MARGIN in signalContract.ts — "unsure"
// is a first-class answer everywhere in this app.
export const PLUCK_AMBIGUOUS_MARGIN = 0.12;
// How far the winning comb must stand above what pure noise would have scored:
// strength = raw / (raw + noiseComb), so 0.5 means "no better than the room" and
// 1 means "nothing but the note". Below this the onset wasn't a chord tone at
// all (a muted thud, a body knock, a string outside the shape).
//
// NOT a fraction of the delta's TOTAL energy, which is what this used to be.
// That definition shrinks as the spectrum gets busier — which has nothing to do
// with whether a chord tone sounded. It scored only 0.17-0.21 on a synthetic
// signal with no noise whatsoever, i.e. a perfect pluck barely cleared a 0.15
// bar, so on a real guitar (pick noise, body, five other strings ringing
// sympathetically) essentially everything fell through as "unsure". Measuring
// against the delta's own noise floor instead is scale-free and stays put as the
// room gets louder.
export const PLUCK_MIN_STRENGTH = 0.6;
// How much the WINNING STRING must have gained over its own previous level.
//
// Deliberately per-string, not "new energy ÷ everything already ringing". You
// are told to let the strings ring out, so the whole-chord denominator grows
// with every pick in a run while each new pick adds relatively less — the gate
// then starts discarding real picks, and does so more the further into the
// pattern you get. It is also fatal to the exercise's core move (the same string
// picked four times against a loud ringing chord).
//
// Per string the question is well-posed at any point in a run:
//   • a string that was silent  → its pre-comb is ~0   → newness enormous
//   • the same string re-struck → decayed, then back up → newness around 1
//   • no string actually struck → delta comb is ~0      → newness ~0
// Deliberately LOW. Separating a real re-pluck from a phantom is the onset
// detector's job (it has the pick's attack transient to go on); measured on a
// ringing chord, a re-pluck's newness decays run-to-run — 0.82, 0.41, 0.32 over
// four repeats on the bench — so any bar high enough to reject phantoms also
// rejects real picks. This is only the backstop for the degenerate case: an
// onset where the winning string gained essentially nothing.
export const PLUCK_MIN_NEWNESS = 0.05;

// ---- candidates from a shape ------------------------------------------------

export type PluckCandidate = {
  stringIndex: number; // 0 = low E … 5 = high e
  midi: number;
  hz: number;
};

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiName(midi: number): string {
  return `${NOTE_NAME[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * MIDI note each string sounds in this shape; null for a muted string.
 * `frets` are ABSOLUTE fret numbers (see data/chordLibrary.ts) — `baseFret` is
 * a diagram-drawing concern and must NOT be added here.
 */
export function stringPitches(shape: ChordShape): (number | null)[] {
  return shape.frets.map((f, i) => (f === 'x' ? null : STRING_MIDI[i] + (f as number)));
}

export function pluckCandidates(shape: ChordShape): PluckCandidate[] {
  const out: PluckCandidate[] = [];
  stringPitches(shape).forEach((midi, stringIndex) => {
    if (midi == null) return;
    out.push({ stringIndex, midi, hz: midiToHz(midi) });
  });
  return out;
}

// ---- spectrum probes --------------------------------------------------------

/**
 * Peak magnitude within ±PLUCK_BIN_TOLERANCE bins of `hz`. Returns 0 when the
 * frequency falls outside the spectrum.
 */
export function binEnergyAt(
  mag: Float32Array | number[],
  sampleRate: number,
  fftSize: number,
  hz: number,
): number {
  const hzPerBin = sampleRate / fftSize;
  const k = hz / hzPerBin;
  const halfHz = hz * (Math.pow(2, PLUCK_PARTIAL_TOLERANCE_CENTS / 1200) - 1);
  const halfBins = Math.max(1, halfHz / hzPerBin);
  const lo = Math.max(0, Math.floor(k - halfBins));
  const hi = Math.min(mag.length - 1, Math.ceil(k + halfBins));
  let peak = 0;
  for (let i = lo; i <= hi; i++) if (mag[i] > peak) peak = mag[i];
  return peak;
}

/** Σ (1/h)·energy(h·hz) over the harmonic series. */
export function combScore(
  mag: Float32Array | number[],
  sampleRate: number,
  fftSize: number,
  hz: number,
): number {
  let sum = 0;
  for (let h = 1; h <= PLUCK_HARMONICS; h++) {
    const f = h * hz;
    if (f > PLUCK_FMAX || f > sampleRate / 2) break;
    sum += binEnergyAt(mag, sampleRate, fftSize, f) / h;
  }
  return sum;
}

/**
 * Σ (1/(h−0.5))·energy((h−0.5)·hz) — the partials of the note ONE OCTAVE BELOW
 * this candidate that the candidate itself does not produce. Evidence that what
 * really sounded was the lower octave.
 */
export function subOctaveEnergy(
  mag: Float32Array | number[],
  sampleRate: number,
  fftSize: number,
  hz: number,
): number {
  let sum = 0;
  for (let h = 1; h <= PLUCK_HARMONICS; h++) {
    const mult = h - 0.5;
    const f = mult * hz;
    if (f > PLUCK_FMAX || f > sampleRate / 2) break;
    sum += binEnergyAt(mag, sampleRate, fftSize, f) / mult;
  }
  return sum;
}

// ---- the ranking ------------------------------------------------------------

export type PluckRank = {
  stringIndex: number;
  midi: number;
  score: number;  // raw, normalized so the winner is 1
  raw: number;    // comb − penalty·sub, clamped at 0
  comb: number;   // diagnostics: the harmonic-comb sum on its own
  sub: number;    // diagnostics: the sub-octave evidence against it
};
export type PluckRanking = {
  ranked: PluckRank[];      // normalized so the top score is 1, descending
  best: number | null;      // string index, or null when ambiguous / too weak
  margin: number;           // top-two gap on the normalized scale
  strength: number;         // winning comb ÷ total in-band delta energy
  newness: number;          // new in-band energy ÷ what was already ringing
  // Did a string actually sound? DISTINCT from `ambiguous`, and the two must not
  // be conflated: an ambiguous pluck is a real pick we cannot name (it still
  // counts for timing, shown as unverified), whereas !isNew means the onset was
  // a re-trigger on a note already ringing — not a pick at all, and counting it
  // would corrupt both the pick tally and the timing.
  isNew: boolean;
  ambiguous: boolean;
};

const EMPTY_RANKING: PluckRanking = {
  ranked: [], best: null, margin: 0, strength: 0, newness: 0, isNew: false, ambiguous: true,
};

/**
 * THE decision. `delta` is a positive-only linear magnitude spectrum
 * (post-onset minus pre-onset), so already-ringing strings are cancelled.
 *
 * `subOctavePenalty` is a parameter, not a constant read, so `check:picks` can
 * assert that turning it OFF actually breaks the octave cases — proving the
 * mechanism rather than just the outcome (docs/mic-calibration.md, "the test
 * that let this through asserted the wrong property").
 */
export function scorePlucks(
  delta: Float32Array | number[],
  sampleRate: number,
  fftSize: number,
  candidates: PluckCandidate[],
  opts: {
    subOctavePenalty?: number;
    /** The PRE-onset magnitude spectrum, for the per-string newness gate.
     *  Omit to skip that gate (tests that only care about the ranking). */
    pre?: Float32Array | number[];
  } = {},
): PluckRanking {
  const subOctavePenalty = opts.subOctavePenalty ?? PLUCK_SUBOCTAVE_PENALTY;
  if (!candidates.length || !delta.length) return EMPTY_RANKING;

  const hasOctaveBelow = new Set(candidates.map(c => c.midi));
  const parts = candidates.map(c => {
    const comb = combScore(delta, sampleRate, fftSize, c.hz);
    // Only defend against an octave confusion that this shape can actually
    // produce. Without this guard the probes would happily land on an unrelated
    // chord tone (on a G chord, 3/2 × G2 = 147 Hz is D3) and penalize a
    // perfectly correct answer.
    const sub = hasOctaveBelow.has(c.midi - 12)
      ? subOctaveEnergy(delta, sampleRate, fftSize, c.hz)
      : 0;
    return { comb, sub, raw: Math.max(0, comb - subOctavePenalty * sub) };
  });

  const top = Math.max(...parts.map(p => p.raw));
  if (top <= 0) return EMPTY_RANKING;

  const ranked: PluckRank[] = candidates
    .map((c, i) => ({
      stringIndex: c.stringIndex, midi: c.midi,
      score: parts[i].raw / top, raw: parts[i].raw,
      comb: parts[i].comb, sub: parts[i].sub,
    }))
    .sort((a, b) => b.score - a.score);

  const hzPerBin = sampleRate / fftSize;
  const kMax = Math.min(delta.length - 1, Math.floor(PLUCK_FMAX / hzPerBin));
  // What a comb would have scored on this delta's NOISE alone: the median bin is
  // a robust floor (a handful of loud partials cannot drag it), summed with the
  // same 1/h weights the comb uses. `binEnergyAt` peak-picks a small window, so
  // the true noise comb sits somewhat above this — that bias is folded into
  // PLUCK_MIN_STRENGTH rather than modelled.
  const inBand: number[] = [];
  for (let k = 1; k <= kMax; k++) inBand.push(delta[k]);
  inBand.sort((a, b) => a - b);
  const median = inBand.length ? inBand[inBand.length >> 1] : 0;
  let combWeightSum = 0;
  for (let h = 1; h <= PLUCK_HARMONICS; h++) combWeightSum += 1 / h;
  const noiseComb = median * combWeightSum;

  const margin = ranked.length > 1 ? ranked[0].score - ranked[1].score : 1;
  const strength = ranked[0].raw + noiseComb > 0
    ? ranked[0].raw / (ranked[0].raw + noiseComb)
    : 0;
  // How much did the WINNER gain over its own previous level? The noise comb is
  // in the denominator so a silent string does not divide by zero.
  const winner = candidates.find(c => c.stringIndex === ranked[0].stringIndex)!;
  const preComb = opts.pre ? combScore(opts.pre, sampleRate, fftSize, winner.hz) : 0;
  const newDenom = preComb + noiseComb;
  const newness = opts.pre == null
    ? 1
    : newDenom > 0
      ? Math.min(999, ranked[0].comb / newDenom)
      : (ranked[0].comb > 0 ? 999 : 0);
  const isNew = newness >= PLUCK_MIN_NEWNESS;
  const ambiguous = !isNew || margin <= PLUCK_AMBIGUOUS_MARGIN || strength < PLUCK_MIN_STRENGTH;

  return {
    ranked, best: ambiguous ? null : ranked[0].stringIndex,
    margin, strength, newness, isNew, ambiguous,
  };
}
