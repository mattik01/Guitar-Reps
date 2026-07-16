// Pure chroma / chord-template math for microphone chord detection.
//
// Node-safe on purpose: no Web Audio, no DOM — so `scripts/checkChroma.ts` can
// sanity-check templates the same way `check:chords` validates fingerings.
//
// The idea: a strummed chord's spectrum, folded onto the 12 pitch classes
// (a "chromagram"), should correlate with a template built from the chord
// shape's sounding notes. We only ever compare against 1–2 KNOWN targets
// (verification, not open classification), which is what makes this workable.
//
// All tunable constants live here, named, so tuning on /mic-test is
// edit-one-file. Initial values are educated guesses pending a real-guitar pass.

import type { ChordShape } from '../state/store';
import { soundingPitchClasses } from '../data/validateChords';

// ---- chroma folding ---------------------------------------------------------

// Below ~90 Hz the FFT bins (5.86 Hz at fftSize 8192 / 48 kHz) are wider than a
// semitone, so low fundamentals would smear into neighbors. A guitar's energy
// lives in the harmonics anyway, so we simply start above the mud.
export const CHROMA_FMIN = 90;
// Cap before the 5th harmonic (2 octaves + major 3rd) of the mid strings starts
// contaminating major/minor discrimination — our weakest axis.
export const CHROMA_FMAX = 1200;
// Skip bins whose center falls between note centers (in semitones).
export const BIN_CENTS_TOLERANCE = 0.35;

// ---- templates --------------------------------------------------------------

// Weight added at pc+7 to model each string's 3rd harmonic (octave + fifth),
// which is prominent in real guitar spectra. We deliberately do NOT model the
// 5th harmonic (pc+4): it would blur major vs minor.
export const FIFTH_HARMONIC_BLEED = 0.3;

// ---- decision thresholds ----------------------------------------------------

// Swap A-vs-B: |simA − simB| above this = "confident" which chord it was.
export const SWAP_CLASSIFY_MARGIN = 0.04;
// Quiz single-target verdict: cosine similarity thresholds.
export const QUIZ_MATCH_THRESHOLD = 0.7;
export const QUIZ_UNSURE_THRESHOLD = 0.55;
// A strum must light up at least this many pitch classes; fewer = a knock,
// a single plucked note, or a click — not a chord.
export const MIN_ACTIVE_PITCH_CLASSES = 3;

/** Build a unit-norm 12-dim chroma template from a chord shape. */
export function chordTemplate(shape: ChordShape): Float32Array {
  const counts = new Float32Array(12);
  for (const pc of soundingPitchClasses(shape)) counts[pc] += 1; // doubled strings weigh more
  const tpl = new Float32Array(12);
  for (let pc = 0; pc < 12; pc++) {
    tpl[pc] += counts[pc];
    tpl[(pc + 7) % 12] += FIFTH_HARMONIC_BLEED * counts[pc];
  }
  return l2Normalize(tpl);
}

/**
 * Fold a dB magnitude spectrum (as from AnalyserNode.getFloatFrequencyData)
 * into 12 pitch-class bins, accumulating into `out` (NOT normalized — callers
 * average several frames first, then normalize once).
 *
 * Returns the total linear energy of the bins that fall BETWEEN note centers.
 * A clean chord concentrates energy on the note bins; fret buzz and rattle are
 * inharmonic and land between them — so this "rejected" energy is a free
 * noisiness measure (see computeCleanliness).
 */
export function foldSpectrumToChroma(
  db: Float32Array,
  sampleRate: number,
  fftSize: number,
  out: Float32Array,
): number {
  const hzPerBin = sampleRate / fftSize;
  const kMin = Math.max(1, Math.ceil(CHROMA_FMIN / hzPerBin));
  const kMax = Math.min(db.length - 1, Math.floor(CHROMA_FMAX / hzPerBin));
  let between = 0;
  for (let k = kMin; k <= kMax; k++) {
    const midi = 69 + 12 * Math.log2((k * hzPerBin) / 440);
    const nearest = Math.round(midi);
    const lin = Math.pow(10, db[k] / 20); // dB → linear
    if (Math.abs(midi - nearest) > BIN_CENTS_TOLERANCE) {
      between += lin;
      continue;
    }
    out[((nearest % 12) + 12) % 12] += lin;
  }
  return between;
}

export function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  if (sum > 0) {
    const inv = 1 / Math.sqrt(sum);
    for (let i = 0; i < v.length; i++) v[i] *= inv;
  }
  return v;
}

/** How many pitch classes carry meaningful energy (≥ `rel` × the max bin). */
export function activePitchClassCount(chroma: Float32Array, rel = 0.25): number {
  let max = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
  if (max === 0) return 0;
  let n = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] >= rel * max) n++;
  return n;
}

export type Verdict = 'match' | 'unsure' | 'nomatch';

/**
 * Absolute-threshold verdict for single-target (quiz) verification.
 * Thresholds default to the global constants; pass per-chord calibrated
 * values (see calibratedThresholds) when available.
 */
export function verdictForSimilarity(
  sim: number,
  matchThreshold = QUIZ_MATCH_THRESHOLD,
  unsureThreshold = QUIZ_UNSURE_THRESHOLD,
): Verdict {
  if (sim >= matchThreshold) return 'match';
  if (sim >= unsureThreshold) return 'unsure';
  return 'nomatch';
}

// ---- per-chord auto-calibration ----------------------------------------------
//
// Different chords settle at different similarity ceilings (more pitch classes
// → flatter template → lower max cosine), so one global threshold is per-chord
// suboptimal. The quiz records the similarity of every strum the user CONFIRMS
// as correct ("✓ Got it" with the diagram in view); with enough samples a
// chord's thresholds come from its own distribution instead of the globals.

export const CAL_MIN_SAMPLES = 3;
export const CAL_MAX_SAMPLES = 20; // (legacy auto-calibration) keep only the most recent N
// Studio profiles keep EVERY clean sample (nothing discarded) and derive clusters
// from the full set — this is only a high safety bound against pathological growth.
export const CAL_SAMPLE_CAP = 500;
// Match threshold sits just under the 25th percentile of confirmed sims: most
// correct strums pass, and a few weak/misrecorded samples can't drag it down.
export const CAL_QUANTILE = 0.25;
export const CAL_MARGIN = 0.94; // match = quantile × this (a bit of slack)
export const CAL_UNSURE_FACTOR = 0.85; // unsure = match × this
// Drift guards: never lax enough to match everything, never stricter than a
// near-perfect strum could satisfy.
export const CAL_MATCH_MIN = 0.5;
export const CAL_MATCH_MAX = 0.9;

// A calibration sample: the similarity a confirmed-correct strum achieved,
// weighted by how CLEAN that strum was — a muddy strum's similarity is
// depressed by the mud, so it says little about the chord's true level.
// Legacy samples (recorded before cleanliness existed) are plain numbers,
// treated as weight 1.
export type CalSample = number | { s: number; w: number };
// Strums dirtier than this cleanliness score are not recorded at all.
export const CAL_CLEAN_GATE = 40;
// Weight ramps linearly from the gate (≈0) to a perfectly clean strum (1),
// but never below this floor once past the gate.
export const CAL_MIN_WEIGHT = 0.15;
// Thresholds need this much total sample weight (on top of CAL_MIN_SAMPLES)
// before they replace the globals — 3 barely-clean strums aren't evidence.
export const CAL_MIN_TOTAL_WEIGHT = 1.5;

/**
 * Weight a would-be calibration sample by the strum's cleanliness score.
 * Returns null when the strum is too dirty to record; 0.5 when there is no
 * cleanliness information at all.
 */
export function calSampleWeight(cleanScore: number | null | undefined): number | null {
  if (cleanScore == null) return 0.5;
  if (cleanScore < CAL_CLEAN_GATE) return null;
  return Math.max(CAL_MIN_WEIGHT, (cleanScore - CAL_CLEAN_GATE) / (100 - CAL_CLEAN_GATE));
}

function normalizeSamples(sims: CalSample[]): { s: number; w: number }[] {
  return sims.map(x => (typeof x === 'number' ? { s: x, w: 1 } : x));
}

export function totalSampleWeight(sims: CalSample[]): number {
  return normalizeSamples(sims).reduce((acc, x) => acc + x.w, 0);
}

/** Weighted quantile: the sample value at fraction `q` of the total weight. */
function weightedQuantile(samples: { s: number; w: number }[], q: number): number {
  const sorted = [...samples].sort((a, b) => a.s - b.s);
  const total = sorted.reduce((acc, x) => acc + x.w, 0);
  let cum = 0;
  for (const x of sorted) {
    cum += x.w;
    if (cum >= q * total) return x.s;
  }
  return sorted[sorted.length - 1].s;
}

/**
 * Per-chord thresholds learned from confirmed-correct strum similarities,
 * weighted by how clean each strum was. Returns null until there is enough
 * evidence (callers fall back to globals).
 */
export function calibratedThresholds(sims: CalSample[]): { match: number; unsure: number } | null {
  const samples = normalizeSamples(sims);
  if (samples.length < CAL_MIN_SAMPLES) return null;
  if (samples.reduce((acc, x) => acc + x.w, 0) < CAL_MIN_TOTAL_WEIGHT) return null;
  const q = weightedQuantile(samples, CAL_QUANTILE);
  const match = Math.min(CAL_MATCH_MAX, Math.max(CAL_MATCH_MIN, q * CAL_MARGIN));
  return { match, unsure: match * CAL_UNSURE_FACTOR };
}

/**
 * A chord's typical (cleanliness-weighted median) confirmed similarity. Used to
 * normalize A-vs-B ranking in the swap routine: chords with flatter templates
 * (7ths, more pitch classes) top out at lower raw cosine, so comparing raw sims
 * biases toward the "peakier" chord. Null until there is enough evidence.
 */
export function typicalSimilarity(sims: CalSample[]): number | null {
  const samples = normalizeSamples(sims);
  if (samples.length < CAL_MIN_SAMPLES) return null;
  if (samples.reduce((acc, x) => acc + x.w, 0) < CAL_MIN_TOTAL_WEIGHT) return null;
  return weightedQuantile(samples, 0.5);
}

// ---- cleanliness (v1, heuristic) ----------------------------------------------
//
// A 0–100 "how clean did that strum sound" score, decomposed into the four
// failure modes we can see from a mono mic at chroma level:
//   completeness — are all the chord's pitch classes actually ringing?
//                  (muted string whose note isn't doubled elsewhere)
//   purity       — how little energy lands on pitch classes OUTSIDE the chord?
//                  (wrong fret, accidental open string)
//   tonality     — note-bin energy vs between-note energy (fret buzz/rattle
//                  is inharmonic and lands between note centers)
//   sustain      — did the chord keep ringing through the analysis window?
//                  (choked/damped strings die fast)
// Known blind spot: chroma folds octaves, so a muted string whose pitch class
// is doubled elsewhere (e.g. high-E in C major) is invisible — that needs
// per-note transcription (v2). Purely informational — never gates anything.

// An expected pitch class counts as "present" at ≥ this fraction of the
// strongest expected pitch class.
export const CLEAN_COMPLETENESS_REL = 0.3;
// Template support below this is treated as "not part of the chord" for purity.
export const CLEAN_SUPPORT_EPS = 0.02;
// Sustain ratio at which the sustain component saturates to 1 (a clean open
// chord holds ~0.7+ of its peak RMS through the 220 ms window).
export const CLEAN_SUSTAIN_REF = 0.7;
// Component weights (sum to 1).
export const CLEAN_W_COMPLETENESS = 0.35;
export const CLEAN_W_PURITY = 0.25;
export const CLEAN_W_TONALITY = 0.25;
export const CLEAN_W_SUSTAIN = 0.15;

export type Cleanliness = {
  score: number; // 0–100 composite
  completeness: number; // 0–1
  purity: number; // 0–1
  tonality: number; // 0–1
  sustain: number; // 0–1 (normalized against CLEAN_SUSTAIN_REF)
};

/**
 * Heuristic cleanliness of a strum, judged against the chord it most likely
 * was. `chroma` is the post-onset window chroma (unit norm), `expectedPcs` the
 * chord's distinct sounding pitch classes, `template` its full template
 * (defines which pitch classes legitimately carry energy, incl. harmonic
 * bleed), `tonality` the note/(note+between) energy ratio of the window, and
 * `sustainRatio` the window's rmsEnd/rmsPeak.
 */
export function computeCleanliness(
  chroma: Float32Array,
  expectedPcs: number[],
  template: Float32Array,
  tonality: number,
  sustainRatio: number,
): Cleanliness {
  // completeness: every expected pitch class should ring
  let maxExpected = 0;
  for (const pc of expectedPcs) if (chroma[pc] > maxExpected) maxExpected = chroma[pc];
  let present = 0;
  if (maxExpected > 0) {
    for (const pc of expectedPcs) if (chroma[pc] >= CLEAN_COMPLETENESS_REL * maxExpected) present++;
  }
  const completeness = expectedPcs.length > 0 ? present / expectedPcs.length : 0;

  // purity: energy outside the chord's template support is a stray note
  let total = 0, off = 0;
  for (let pc = 0; pc < 12; pc++) {
    total += chroma[pc];
    if (template[pc] <= CLEAN_SUPPORT_EPS) off += chroma[pc];
  }
  const purity = total > 0 ? 1 - off / total : 0;

  const sustain = Math.min(1, Math.max(0, sustainRatio / CLEAN_SUSTAIN_REF));
  const t = Math.min(1, Math.max(0, tonality));

  const score = Math.round(100 * (
    CLEAN_W_COMPLETENESS * completeness +
    CLEAN_W_PURITY * purity +
    CLEAN_W_TONALITY * t +
    CLEAN_W_SUSTAIN * sustain
  ));
  return { score, completeness, purity, tonality: t, sustain };
}

/**
 * Short human hint for the weakest aspect of a strum, or null when nothing
 * stands out. Each component is measured against its own "worth mentioning"
 * bar; the most deficient one (relative to its bar) wins.
 */
export function cleanlinessHint(c: Cleanliness): string | null {
  const candidates: { deficit: number; hint: string }[] = [
    { deficit: 0.75 - c.completeness, hint: 'a note might be missing or muted' },
    { deficit: 0.7 - c.purity, hint: 'stray note in there?' },
    { deficit: 0.55 - c.tonality, hint: 'some buzz or rattle' },
    { deficit: 0.5 - c.sustain, hint: 'died quickly — choked strings?' },
  ];
  const worst = candidates.sort((a, b) => b.deficit - a.deficit)[0];
  return worst.deficit > 0 ? worst.hint : null;
}
