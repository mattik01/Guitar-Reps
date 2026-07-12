import { cleanlinessHint, type Cleanliness } from '../audio/chroma';

// Informational cleanliness readout for the last strum: "✨ 82" colored by
// score, plus a short hint when one aspect stands out (buzz, muted note, …).
// Deliberately advisory — it never gates detection or counting.
export function CleanlinessBadge({ clean, showHint = true }: {
  clean: Cleanliness | null;
  showHint?: boolean;
}) {
  if (!clean) return null;
  const color = clean.score >= 75 ? 'var(--good)' : clean.score < 50 ? 'var(--warn)' : 'inherit';
  const hint = showHint ? cleanlinessHint(clean) : null;
  return (
    <span title={`completeness ${Math.round(clean.completeness * 100)} · purity ${Math.round(clean.purity * 100)} · tonality ${Math.round(clean.tonality * 100)} · sustain ${Math.round(clean.sustain * 100)}`}>
      <span style={{ color, fontWeight: 700 }}>✨ {clean.score}</span>
      {hint && <span className="muted"> — {hint}</span>}
    </span>
  );
}
