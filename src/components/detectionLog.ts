import type { StrumEvent } from '../audio/chordListener';

// The detection event log's data shape and its one formatter. Lives apart from
// <DetectionDetails> so the routines that only need to PUSH entries don't import
// the whole panel to get a string builder.
export type MicLogEntry = {
  at: number;
  kind: 'strum' | 'knock' | 'double-knock';
  detail: string;
};

// Single source of truth for the strum log line so all call sites match.
export function strumLogDetail(e: StrumEvent): string {
  return `${e.matches.map(m => `${m.id} ${m.similarity.toFixed(3)}`).join(' · ')} → best ${e.best ?? '(unsure)'} · verdict ${e.verdict} · sustain ${e.sustain.toFixed(2)} · pcs ${e.activePc}`
    + (e.cleanliness
      ? ` · clean ${e.cleanliness.score} (comp ${e.cleanliness.completeness.toFixed(2)} pur ${e.cleanliness.purity.toFixed(2)} ton ${e.cleanliness.tonality.toFixed(2)} sus ${e.cleanliness.sustain.toFixed(2)})`
      : '');
}
