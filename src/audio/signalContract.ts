// ============================================================================
// Mic ↔ Calibration signal contract  (the "black box" boundary)
// ============================================================================
// The calibration system — and, later, the mic exercises — must NOT depend on
// HOW the microphone engine detects chords. They depend only on this contract:
//
//     producer  →  ChordSignal  →  checkSignal(signal, target)  →  SignalCheck
//
//   • ChordSignal  — one detected strum, in an engine-agnostic form. Today it is
//     produced from a ChordListener StrumEvent (see `signalFromStrum`). Tomorrow
//     a harmonic-weighted-chroma matcher, a Basic-Pitch note validator, or a
//     cluster model can produce the SAME shape without any caller changing.
//   • ChordTarget  — what we check against: a chord's theoretical template, its
//     expected notes, and (once calibrated) its learned reference + thresholds.
//   • checkSignal  — THE checkable boundary: "is this signal a clean instance of
//     this chord, and how much should it count?" Its internals may change freely;
//     callers read only the SignalCheck result (similarity / verdict / quality /
//     warnings).
//
// Rule: calibration & exercise code imports from THIS file. It must not reach
// into ChordListener internals or StrumEvent fields directly — that keeps the
// detection engine swappable behind a stable boundary.

import { centeredCosineSim, chordTemplate, cosineSim, verdictForSimilarity, type Verdict } from './chroma';
import { soundingPitchClasses } from '../data/validateChords';
import type { ChordShape } from '../state/store';
import type { StrumEvent } from './chordListener';

// --- data that crosses the boundary ---------------------------------------

// One detected strum, normalized. Whatever produces it must fill this shape.
export type ChordSignal = {
  at: number;                 // performance.now() of the onset
  chroma: number[];           // 12-dim, unit norm, pitch-class energies
  cleanliness: number | null; // 0..100 play quality (null = unknown)
  sustain: number;            // 0..1, how much it rang out vs pure attack
  activePcCount: number;      // how many pitch classes are ringing
};

// What a signal is checked against.
export type ChordTarget = {
  id: string;
  template: Float32Array;          // theoretical chroma template (from the shape)
  expectedPcs: number[];           // sounding pitch classes (note-level / future validator)
  reference?: Float32Array | null; // learned prototype once calibrated (blended into the match)
  matchThreshold?: number;
  unsureThreshold?: number;
  // Weighted-median similarity this chord reaches when played correctly on THIS
  // rig. Normalizes cross-target ranking so a flat-template chord (a 7th, say)
  // isn't structurally outscored by a peakier one played equally well.
  typicalSim?: number;
};

export type SignalWarning = 'off-chord' | 'muddy' | 'too-quiet';

// The verdict of a check — the only thing callers consume.
export type SignalCheck = {
  similarity: number;         // 0..1 match of the signal to the target
  verdict: Verdict;           // 'match' | 'unsure' | 'nomatch'
  isMatch: boolean;
  cleanliness: number | null;
  quality: number;            // 0..1 weight for calibration (0 = do not record)
  warnings: SignalWarning[];  // safety flags surfaced to the user
};

// --- tunable boundary constants (the "safety measures") -------------------
export const SIGNAL_OFF_CHORD_SIM = 0.4; // below this, the signal isn't this chord
export const SIGNAL_MUDDY_BELOW = 45;    // cleanliness under this is flagged muddy
// Top-two score gap below which a multi-target pick is "could be either".
// Mirrors ChordListener's SWAP_CLASSIFY_MARGIN — the two must move together.
export const SIGNAL_AMBIGUOUS_MARGIN = 0.04;

// --- producer adapter: ChordListener → ChordSignal ------------------------
// The ONE place that knows the StrumEvent shape. Swap engines here.
export function signalFromStrum(e: StrumEvent): ChordSignal {
  return {
    at: e.at,
    chroma: Array.from(e.chroma),
    cleanliness: e.cleanliness?.score ?? null,
    sustain: e.sustain,
    activePcCount: e.activePc,
  };
}

// --- target builder --------------------------------------------------------
export function chordTargetFromShape(
  id: string,
  shape: ChordShape,
  opts?: {
    reference?: Float32Array | null;
    matchThreshold?: number;
    unsureThreshold?: number;
    typicalSim?: number;
  },
): ChordTarget {
  return {
    id,
    template: chordTemplate(shape),
    expectedPcs: [...new Set(soundingPitchClasses(shape))],
    reference: opts?.reference ?? null,
    matchThreshold: opts?.matchThreshold,
    unsureThreshold: opts?.unsureThreshold,
    typicalSim: opts?.typicalSim,
  };
}

// --- THE check -------------------------------------------------------------
// Pure. Given a signal and a target, decide match + how much it should count for
// calibration + any warnings. Internals (which similarity, how quality is scored)
// are free to evolve; the return shape is the contract.
export function checkSignal(signal: ChordSignal, target: ChordTarget): SignalCheck {
  const v = Float32Array.from(signal.chroma);
  // Match against the learned reference when we have one, else the theoretical
  // template.
  //
  // Two things here were learned the hard way on a real guitar (2026-08-20):
  //
  //  1. The reference is compared with CENTERED cosine, not plain cosine. A
  //     prototype learned from real audio carries the rig's broadband signature
  //     on every pitch class, and that signature is identical for every chord you
  //     play — so plain cosine against it returns a high score for ANY chord.
  //     Centering strips the shared component and compares only the peaks.
  //  2. It is NOT `max(tplSim, refSim)`. Taking the max meant the reference could
  //     only ever LOOSEN recognition, never tighten it: one inflated reference
  //     score overrode the template's much better discrimination and everything
  //     matched. The reference replaces the template when present — and
  //     chordTargetFromProfile refuses to attach a prototype too flat to identify
  //     anything, so "present" implies "discriminative".
  //
  // Thresholds and typicalSim are re-measured on whichever scale is in play (see
  // profileThresholdsAgainst), so the two paths stay comparable.
  const tplSim = cosineSim(v, target.template);
  const similarity = target.reference ? centeredCosineSim(v, target.reference) : tplSim;

  const verdict = verdictForSimilarity(similarity, target.matchThreshold, target.unsureThreshold);
  const clean = signal.cleanliness;

  const warnings: SignalWarning[] = [];
  if (similarity < SIGNAL_OFF_CHORD_SIM) warnings.push('off-chord');
  if (clean != null && clean < SIGNAL_MUDDY_BELOW) warnings.push('muddy');

  // Quality weight for calibration: 0 when it isn't the chord at all; otherwise
  // scaled by cleanliness with an assume-clean floor, so borderline-but-real
  // strums still contribute (just less).
  const quality = similarity < SIGNAL_OFF_CHORD_SIM
    ? 0
    : Math.max(0.15, Math.min(1, (clean ?? 60) / 100));

  return { similarity, verdict, isMatch: verdict === 'match', cleanliness: clean, quality, warnings };
}

// Human-readable warning text for the UI.
export function signalWarningText(w: SignalWarning, chordName: string): string {
  switch (w) {
    case 'off-chord': return `That didn’t sound like ${chordName} — playing the right chord?`;
    case 'muddy': return 'A bit muddy — it still counts, just less.';
    case 'too-quiet': return 'Too quiet to be sure.';
  }
}

// --- multi-target selection: "which of these chords is it?" ------------------
// The contract's answer to the one question checkSignal can't answer alone. The
// swap routine needs it to tell chord A from chord B; keeping it here (rather
// than reading ChordListener's own classifier) is what lets a LEARNED reference
// influence the pick, since the engine only ever matches the theoretical template.

export type SignalRank = {
  id: string;
  check: SignalCheck;
  score: number; // similarity normalized by the target's typicalSim (1 when absent)
};

export type SignalRanking = {
  ranked: SignalRank[];  // score descending; empty when there are no targets
  best: string | null;   // null when ambiguous, or when there are no targets
  ambiguous: boolean;    // top two too close to call
  margin: number;        // ranked[0].score - ranked[1].score (0 with < 2 targets)
};

/**
 * Rank targets against one signal. Semantics deliberately mirror the
 * real-guitar-validated engine classifier:
 *   • score = similarity / typicalSim (1 when the target has no typicalSim)
 *   • a single target is ALWAYS confident
 *   • otherwise `best` is null unless the top-two gap is STRICTLY greater than
 *     the margin
 * With uncalibrated targets (no reference, no typicalSim) this reduces exactly to
 * cosine-against-template ranking — i.e. identical to today's behaviour. Pure.
 */
export function bestOfSignal(
  signal: ChordSignal,
  targets: ChordTarget[],
  opts?: { minMargin?: number },
): SignalRanking {
  const minMargin = opts?.minMargin ?? SIGNAL_AMBIGUOUS_MARGIN;
  const ranked: SignalRank[] = targets
    .map(t => {
      const check = checkSignal(signal, t);
      return { id: t.id, check, score: t.typicalSim ? check.similarity / t.typicalSim : check.similarity };
    })
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return { ranked, best: null, ambiguous: false, margin: 0 };
  const margin = ranked.length >= 2 ? ranked[0].score - ranked[1].score : 0;
  const ambiguous = ranked.length >= 2 && !(margin > minMargin);
  return { ranked, best: ambiguous ? null : ranked[0].id, ambiguous, margin };
}
