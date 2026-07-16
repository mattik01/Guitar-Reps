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

import { chordTemplate, cosineSim, verdictForSimilarity, type Verdict } from './chroma';
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
  opts?: { reference?: Float32Array | null; matchThreshold?: number; unsureThreshold?: number },
): ChordTarget {
  return {
    id,
    template: chordTemplate(shape),
    expectedPcs: [...new Set(soundingPitchClasses(shape))],
    reference: opts?.reference ?? null,
    matchThreshold: opts?.matchThreshold,
    unsureThreshold: opts?.unsureThreshold,
  };
}

// --- THE check -------------------------------------------------------------
// Pure. Given a signal and a target, decide match + how much it should count for
// calibration + any warnings. Internals (which similarity, how quality is scored)
// are free to evolve; the return shape is the contract.
export function checkSignal(signal: ChordSignal, target: ChordTarget): SignalCheck {
  const v = Float32Array.from(signal.chroma);
  // Match against the learned reference when we have one, else the theoretical
  // template. (A smarter blend can slot in here without touching callers.)
  const tplSim = cosineSim(v, target.template);
  const refSim = target.reference ? cosineSim(v, target.reference) : -1;
  const similarity = Math.max(tplSim, refSim);

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
