// Per-song chord-transition strip: the song's most common chord changes, each
// coloured red→yellow→green by how fast the user swapped it in their latest swap
// exercise (grey = never trained). Green target is half the song's BPM (≤120/min),
// red floor is an eighth of it. See src/data/songTransitions.ts for the maths.
import { useEffect, useMemo, useState } from 'react';
import { useRepertoire, useSwapRecords } from '../state/store';
import { getProgression } from '../data/catalogDb';
import {
  computeSongTransitions, gradeTransition, repertoireByBase, recordForPair, speedAnchors,
  type Transition,
} from '../data/songTransitions';

const TOP_N = 4;

// Cache computed transitions per catalog id — a progression never changes, and the
// same song can appear on several screens.
const cache = new Map<number, Transition[]>();
const inflight = new Map<number, Promise<Transition[]>>();

function loadTransitions(id: number): Promise<Transition[]> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(id);
  if (!p) {
    p = getProgression(id)
      .then(raw => { const t = computeSongTransitions(raw || ''); cache.set(id, t); inflight.delete(id); return t; })
      .catch(() => { inflight.delete(id); return [] as Transition[]; });
    inflight.set(id, p);
  }
  return p;
}

export function SongTransitions({ catalogId, tempo }: { catalogId: number | null; tempo: number | null | undefined }) {
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();
  const [transitions, setTransitions] = useState<Transition[] | null>(
    () => (catalogId != null ? cache.get(catalogId) ?? null : []),
  );
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (catalogId == null) { setTransitions([]); return; }
    const hit = cache.get(catalogId);
    if (hit) { setTransitions(hit); return; }
    setTransitions(null);
    let cancelled = false;
    loadTransitions(catalogId).then(t => { if (!cancelled) setTransitions(t); });
    return () => { cancelled = true; };
  }, [catalogId]);

  const byBase = useMemo(() => repertoireByBase(repertoire), [repertoire]);
  const anchors = speedAnchors(tempo);

  if (transitions == null) {
    return <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Analyzing transitions…</div>;
  }
  if (transitions.length === 0) return null;

  const shown = expanded ? transitions : transitions.slice(0, TOP_N);
  const hidden = transitions.length - shown.length;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>Chord changes</span>
        <span className="muted" style={{ fontSize: 11 }}>
          · green ≈ {Math.round(anchors.green)}/min{tempo ? '' : ' (BPM unknown)'}
        </span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {shown.map(t => {
          const rec = recordForPair(t.a, t.b, byBase, swaps);
          const g = gradeTransition(rec, tempo);
          const title = g.trained
            ? `Your last: ${g.rate}/min · green at ${Math.round(anchors.green)}/min, red at ${Math.round(anchors.red)}/min`
            : `Never trained — try the ${t.a} ↔ ${t.b} swap exercise`;
          return (
            <span key={`${t.a}-${t.b}`} title={title}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 999,
                background: g.bg,
                border: g.trained ? `1.5px solid ${g.color}` : '1px dashed var(--line)',
                fontWeight: 700, fontSize: 13,
              }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: g.color, flex: '0 0 auto',
              }} />
              {t.a} ↔ {t.b}
              <span style={{ opacity: 0.6, fontWeight: 600, marginLeft: 2 }}>×{t.count}</span>
            </span>
          );
        })}
        {transitions.length > TOP_N && (
          <button className="button" style={{ padding: '2px 10px', fontSize: 12 }}
            onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Show less' : `+${hidden} more`}
          </button>
        )}
      </div>
    </div>
  );
}
