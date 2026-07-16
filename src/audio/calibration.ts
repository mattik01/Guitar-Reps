// Per-chord CalibrationProfile math — turns collected Studio samples into a
// learned reference: a quality-weighted "prototype" chroma (how the chord sounds
// on THIS rig), verdict thresholds, a typical similarity, and a 0..100 score.
// Pure functions (no Web Audio), so they run under `npm run check:profiles`.
//
// Import note: this imports the CalibrationSample TYPE from the store and VALUES
// from chroma. store imports only values from chroma; the store→calibration edge
// is type-only, so there is no runtime cycle.

import { calibratedThresholds, l2Normalize, typicalSimilarity, CAL_MAX_SAMPLES } from './chroma';
import type { CalibrationSample } from '../state/store';

// A chord is "calibrated enough" for gated mic mode at/above this score (the
// calibration-gate contract: exercises fall back to no-mic below it).
export const CAL_MIN_SCORE = 60;
// Total quality-weight at which a chord counts as fully calibrated (~8 clean
// strums at weight ~0.75). Score = 100 × totalWeight / this, capped.
export const CAL_SCORE_TARGET_WEIGHT = 6;

export function totalWeight(samples: CalibrationSample[]): number {
  let w = 0;
  for (const s of samples) w += Math.max(0, s.weight);
  return w;
}

// Weighted average of the sample chroma vectors, re-normalized to unit length.
// null when no sample carries a chroma vector (e.g. only sim-only samples).
export function profilePrototype(samples: CalibrationSample[]): Float32Array | null {
  const acc = new Float32Array(12);
  let wsum = 0;
  for (const s of samples) {
    if (!s.chroma || s.chroma.length !== 12) continue;
    const w = s.weight > 0 ? s.weight : 1e-4;
    for (let i = 0; i < 12; i++) acc[i] += s.chroma[i] * w;
    wsum += w;
  }
  if (wsum <= 0) return null;
  for (let i = 0; i < 12; i++) acc[i] /= wsum;
  return l2Normalize(acc);
}

// Verdict thresholds + typical similarity, reusing the existing weighted-quantile
// logic (samples map to the {s,w} CalSample shape it expects).
export function profileThresholds(samples: CalibrationSample[]): { match: number; unsure: number } | null {
  return calibratedThresholds(samples.map(s => ({ s: s.sim, w: s.weight })));
}
export function profileTypicalSim(samples: CalibrationSample[]): number | null {
  return typicalSimilarity(samples.map(s => ({ s: s.sim, w: s.weight })));
}

// 0..100 calibration score from accumulated quality-weight (capped).
export function profileScore(samples: CalibrationSample[]): number {
  const w = totalWeight(samples);
  return Math.max(0, Math.min(100, Math.round((100 * w) / CAL_SCORE_TARGET_WEIGHT)));
}

// How many more clean-ish samples (rough) to reach "calibrated enough".
export function samplesLeftToMinScore(samples: CalibrationSample[]): number {
  const need = (CAL_MIN_SCORE / 100) * CAL_SCORE_TARGET_WEIGHT - totalWeight(samples);
  return Math.max(0, Math.ceil(need / 0.75)); // assume ~0.75 weight per clean strum
}

export { CAL_MAX_SAMPLES };
