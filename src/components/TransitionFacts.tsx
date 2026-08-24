// What the catalog and the roadmap know about one chord change, in one muted line:
// how common it is across the 430k-song catalog, and every roadmap level that asks
// for it with the speed asked there.
//
//   #1 of 276 · 2.2M changes · L1 20 · L3 40 · L5 60
//
// Takes base triads (Am, not Am7) — the same identity songTransitions and the
// curriculum use. No prose: the explanation lives in the tooltip.
import { transitionFrequency, TRANSITION_COUNT } from '../data/transitionFrequency';
import { roadmapAppearances } from '../data/transitionTargets';

/** 2171309 → "2.2M", 640179 → "640k", 812 → "812". */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function TransitionFacts({ a, b }: { a: string; b: string }) {
  const freq = transitionFrequency(a, b);
  const levels = roadmapAppearances(a, b);
  if (!freq && levels.length === 0) return null;

  return (
    <span className="muted" style={{ fontSize: 12, display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
      {freq && (
        <span title={`The ${freq.rank}${ordinal(freq.rank)} most common chord change in the catalog, out of ${TRANSITION_COUNT} · it appears in ${freq.songs.toLocaleString()} songs and is played ${freq.occurrences.toLocaleString()} times across them`}>
          <strong style={{ color: 'var(--ink)' }}>#{freq.rank}</strong> of {TRANSITION_COUNT} · {compact(freq.occurrences)} changes
        </span>
      )}
      {levels.map(l => (
        <span key={l.level}
          title={`Level ${l.level.slice(1)} asks for this change at ${l.target}/min`}
          style={{
            padding: '0 5px', borderRadius: 4, whiteSpace: 'nowrap',
            border: '1px solid var(--line)', fontWeight: 700,
          }}>
          L{l.level.slice(1)} {l.target}
        </span>
      ))}
    </span>
  );
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}
