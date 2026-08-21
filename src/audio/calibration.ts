// Per-chord CalibrationProfile math — turns collected Studio samples into a
// learned reference: a quality-weighted "prototype" chroma (how the chord sounds
// on THIS rig), verdict thresholds, a typical similarity, and a 0..100 score.
// Pure functions (no Web Audio), so they run under `npm run check:profiles`.
//
// Import note: this imports the CalibrationSample TYPE from the store and VALUES
// from chroma. store imports only values from chroma; the store→calibration edge
// is type-only, so there is no runtime cycle.

import { calibratedThresholds, chromaSpread, l2Normalize, typicalSimilarity, CAL_MAX_SAMPLES } from './chroma';
import { checkSignal, chordTargetFromShape, type ChordSignal, type ChordTarget } from './signalContract';
import type { CalibrationSample, ChordShape } from '../state/store';

// A chord is "calibrated enough" for gated mic mode at/above this score (the
// calibration-gate contract: exercises fall back to no-mic below it).
export const CAL_MIN_SCORE = 60;
// Total quality-weight at which a chord counts as fully calibrated (~8 clean
// strums at weight ~0.75). Score = 100 × totalWeight / this, capped.
export const CAL_SCORE_TARGET_WEIGHT = 6;
// A learned prototype flatter than this carries no chord identity — it's mostly
// the rig's broadband signature, which is the same for every chord on that rig.
// Attaching it as a reference would make everything match, so we don't. (For
// scale: a clean 3-note theoretical template sits around 0.25.)
export const CAL_MIN_PROTOTYPE_SPREAD = 0.06;

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

// --- similarity SCALE ---------------------------------------------------------
// `sample.sim` was captured in the Studio against the THEORETICAL TEMPLATE only.
// At exercise time checkSignal scores against max(template, learned reference),
// which is >= the template similarity. Deriving thresholds from the template-scale
// sims and applying them on the reference scale makes them systematically too
// permissive (the quiz starts calling everything a match) and puts the swap
// routine's typicalSim normalization on the wrong scale.
//
// The samples carry their chroma, so we simply re-measure them against the target
// we are actually going to use. Samples without chroma (legacy/sim-only) can't be
// re-measured and are skipped.

function sampleSignal(s: CalibrationSample, expectedPcCount: number): ChordSignal {
  // cleanliness/sustain don't affect checkSignal's similarity, only its warnings
  // and quality weight — which we don't use here.
  return { at: s.at, chroma: s.chroma!, cleanliness: null, sustain: 1, activePcCount: expectedPcCount };
}

/** Each chroma-bearing sample's similarity AGAINST `target`, with its weight. */
export function profileSimsAgainst(
  samples: CalibrationSample[],
  target: ChordTarget,
): { s: number; w: number }[] {
  const out: { s: number; w: number }[] = [];
  for (const s of samples) {
    if (!s.chroma || s.chroma.length !== 12) continue;
    out.push({
      s: checkSignal(sampleSignal(s, target.expectedPcs.length), target).similarity,
      w: Math.max(0, s.weight),
    });
  }
  return out;
}

export function profileThresholdsAgainst(
  samples: CalibrationSample[], target: ChordTarget,
): { match: number; unsure: number } | null {
  return calibratedThresholds(profileSimsAgainst(samples, target));
}

export function profileTypicalSimAgainst(
  samples: CalibrationSample[], target: ChordTarget,
): number | null {
  return typicalSimilarity(profileSimsAgainst(samples, target));
}

/**
 * THE adapter the exercises use: a chord's stored profile → the ChordTarget to
 * check strums against. Learned prototype as the reference, plus thresholds and
 * typicalSim measured on that same reference scale.
 *
 * With no (or only sim-only) samples this degrades EXACTLY to
 * chordTargetFromShape(id, shape) — no reference, no thresholds, no typicalSim —
 * so an uncalibrated chord behaves precisely as it does today.
 */
export function chordTargetFromProfile(
  id: string,
  shape: ChordShape,
  samples: CalibrationSample[],
): ChordTarget {
  const reference = profilePrototype(samples);
  // No prototype, or one too flat to identify anything → fall back to the
  // theoretical template, which discriminates well.
  if (!reference || chromaSpread(reference) < CAL_MIN_PROTOTYPE_SPREAD) {
    return chordTargetFromShape(id, shape);
  }

  // Measure the samples on the scale the exercise will actually score on.
  const refTarget = chordTargetFromShape(id, shape, { reference });
  const th = profileThresholdsAgainst(samples, refTarget);
  const typ = profileTypicalSimAgainst(samples, refTarget);

  return chordTargetFromShape(id, shape, {
    reference,
    matchThreshold: th?.match,
    unsureThreshold: th?.unsure,
    typicalSim: typ ?? undefined,
  });
}

// --- shape fingerprint --------------------------------------------------------
// A profile describes how a SHAPE sounds, so it must be invalidated when the
// shape changes. `fingers` is deliberately excluded: which finger frets a note is
// cosmetic and does not change the sound, so re-annotating a fingering must not
// throw away hard-won calibration.
export function shapeKey(shape: ChordShape): string {
  const barre = shape.barre
    ? `${shape.barre.fromIndex}-${shape.barre.toIndex}@${shape.barre.fret}`
    : '';
  return `${shape.frets.join(',')}|${shape.baseFret ?? 1}|${barre}`;
}

// --- the calibration gate -----------------------------------------------------
// The contract: an exercise that uses the mic to auto-recognize a chord requires
// EVERY chord involved to be calibrated. If any isn't, the exercise must not run
// degraded — it falls back to the no-mic flow and points at the offending chords.

export type GateReason = 'ok' | 'uncalibrated' | 'low-score' | 'shape-changed';

export type ChordCalibrationStatus = {
  chordId: string;
  score: number;
  ready: boolean;
  samplesLeft: number;
  reason: GateReason;
};

export type CalibrationGate = {
  ready: boolean;                     // every listed chord is ready (true for an empty list)
  chords: ChordCalibrationStatus[];   // input order
  blocking: ChordCalibrationStatus[]; // the not-ready ones, worst score first
  needs: Set<string>;                 // blocking ids — drives the ChordCard highlight
};

/**
 * Pure. `profiles` is the raw reps.chordProfiles map; `shapeKeys` maps chord id →
 * the shape the exercise is about to use, so a profile recorded for a different
 * shape is caught. A profile with no recorded shapeKey counts as matching, so
 * profiles written before this existed don't all self-invalidate on upgrade.
 */
export function evaluateCalibrationGate(
  profiles: Record<string, { samples: CalibrationSample[]; shapeKey?: string } | undefined>,
  chordIds: string[],
  shapeKeys: Record<string, string> = {},
): CalibrationGate {
  const chords = chordIds.map<ChordCalibrationStatus>(chordId => {
    const profile = profiles[chordId];
    const samples = profile?.samples ?? [];
    const score = profileScore(samples);
    const expected = shapeKeys[chordId];
    const recorded = profile?.shapeKey;

    let reason: GateReason;
    if (samples.length === 0) reason = 'uncalibrated';
    else if (expected && recorded && expected !== recorded) reason = 'shape-changed';
    // The score alone implies both of these (weight >= 3.6 needs >= 4 samples),
    // but asserting them keeps the gate immune to sim-only samples and to any
    // future re-tuning of CAL_SCORE_TARGET_WEIGHT.
    else if (score < CAL_MIN_SCORE || profilePrototype(samples) == null || profileThresholds(samples) == null) {
      reason = 'low-score';
    } else reason = 'ok';

    return { chordId, score, ready: reason === 'ok', samplesLeft: samplesLeftToMinScore(samples), reason };
  });

  const blocking = chords.filter(c => !c.ready).slice().sort((a, b) => a.score - b.score);
  return {
    ready: blocking.length === 0,
    chords,
    blocking,
    needs: new Set(blocking.map(c => c.chordId)),
  };
}
