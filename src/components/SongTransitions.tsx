// Per-song chord-transition strip: the song's most common chord changes, each
// coloured red→yellow→green by how fast the user swapped it in their latest swap
// exercise (grey = never trained). Green target is half the song's BPM (≤120/min),
// red floor is an eighth of it. See src/data/songTransitions.ts for the maths.
//
// A clickable pill opens the swap exercise for that pair; if a chord isn't in the
// repertoire yet, the swap routine offers to register it first. The collapsed strip
// shows as many pills as the card is wide
// enough to hold on one line — the rest fold behind a "+N more" toggle so nothing
// ever spills outside the card.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRepertoire, useSwapRecords } from '../state/store';
import { getProgression } from '../data/catalogDb';
import { parseChord } from '../data/chordNormalize';
import {
  computeSongTransitions, gradeTransition, repertoireByBase, recordForPair, speedAnchors,
  type Transition, type TransitionGrade,
} from '../data/songTransitions';

const GAP = 6; // must match the pill row's flex gap

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

type PillModel = {
  t: Transition;
  aLabel: string; // the actual chord from this song (e.g. "Am7"), not the bare base "A"
  bLabel: string;
  g: TransitionGrade;
  trainable: boolean;
  title: string;
  open: (() => void) | undefined;
};

function Pill({ p }: { p: PillModel }) {
  const { g, trainable, title, open } = p;
  return (
    <span title={title}
      role={trainable ? 'button' : undefined}
      tabIndex={trainable ? 0 : undefined}
      onClick={open}
      onKeyDown={open ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }) : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999,
        background: g.bg,
        border: g.trained ? `1.5px solid ${g.color}` : '1px dashed var(--line)',
        fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap',
        cursor: trainable ? 'pointer' : 'default',
      }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flex: '0 0 auto' }} />
      {p.aLabel} ↔ {p.bLabel}
      <span style={{ opacity: 0.6, fontWeight: 600, marginLeft: 2 }}>×{p.t.count}</span>
    </span>
  );
}

export function SongTransitions({ catalogId, tempo, chords = [] }: {
  catalogId: number | null;
  tempo: number | null | undefined;
  chords?: string[]; // the song's chord list — used to label transitions with the real chord
}) {
  const navigate = useNavigate();
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
  const list = transitions ?? [];

  // Transitions are computed on base triads (Em7→E), but the chips above show the real
  // chords. Map each base back to the actual chord from THIS song so the strip reads
  // "Am7 ↔ Em7", not "A ↔ E". First chord wins when a base has several voicings.
  const displayByBase = useMemo(() => {
    const m = new Map<string, string>();
    for (const ch of chords) {
      const p = parseChord(ch);
      if (p.ok && !m.has(p.base)) m.set(p.base, ch);
    }
    return m;
  }, [chords]);

  const pills = useMemo<PillModel[]>(() => list.map(t => {
    const aLabel = displayByBase.get(t.a) ?? t.a;
    const bLabel = displayByBase.get(t.b) ?? t.b;
    const g = gradeTransition(recordForPair(t.a, t.b, byBase, swaps), tempo);
    // Prefer each chord's repertoire id (first shape variant); fall back to the base
    // token so the swap exercise can open even when a chord isn't owned yet — it now
    // offers to register any missing chord (prefilled from the library) before starting.
    const idA = byBase.get(t.a)?.[0] ?? t.a;
    const idB = byBase.get(t.b)?.[0] ?? t.b;
    const clickable = idA !== idB;
    const missing = [t.a, t.b].filter(x => !byBase.get(x)?.[0]);
    const title = missing.length
      ? `Click to train the ${aLabel} ↔ ${bLabel} swap — you'll register ${missing.join(' & ')} first`
      : g.trained
        ? `Your last: ${g.rate}/min · green at ${Math.round(anchors.green)}/min, red at ${Math.round(anchors.red)}/min · click to train`
        : `Never trained — click to train the ${aLabel} ↔ ${bLabel} swap`;
    const open = clickable
      ? () => navigate(`/routine/swap?a=${encodeURIComponent(idA)}&b=${encodeURIComponent(idB)}`)
      : undefined;
    return { t, aLabel, bLabel, g, trainable: clickable, title, open };
  }), [list, displayByBase, byBase, swaps, tempo, anchors.green, anchors.red, navigate]);

  // How many pills fit on one line at the current card width. Measured off-screen
  // (all pills laid out with no wrap), reserving room for the "+N more" toggle.
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fitCount, setFitCount] = useState<number>(pills.length);

  useLayoutEffect(() => {
    const row = rowRef.current, meas = measureRef.current;
    if (!row || !meas || pills.length === 0) return;
    const recompute = () => {
      const avail = row.clientWidth;
      if (!avail) return;
      const kids = Array.from(meas.children) as HTMLElement[];
      const pillW = kids.slice(0, pills.length).map(k => k.offsetWidth);
      const btnW = kids[pills.length]?.offsetWidth ?? 0;
      const totalAll = pillW.reduce((s, w) => s + w, 0) + GAP * Math.max(0, pillW.length - 1);
      if (totalAll <= avail) { setFitCount(pills.length); return; } // everything fits, no toggle
      // Otherwise reserve space for the "+N more" toggle on the same line.
      let used = 0, n = 0;
      for (let i = 0; i < pillW.length; i++) {
        const add = pillW[i] + (n > 0 ? GAP : 0);
        if (used + add + GAP + btnW > avail) break;
        used += add; n++;
      }
      setFitCount(Math.max(1, n));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(row);
    return () => ro.disconnect();
  }, [pills]);

  if (transitions == null) {
    return <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Analyzing transitions…</div>;
  }
  if (list.length === 0) return null;

  const collapsedCount = Math.min(fitCount, pills.length);
  const hasOverflow = collapsedCount < pills.length;
  const visible = expanded ? pills : pills.slice(0, collapsedCount);
  const hidden = pills.length - collapsedCount;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>Chord changes</span>
        <span className="muted" style={{ fontSize: 11 }}>
          · green ≈ {Math.round(anchors.green)}/min{tempo ? '' : ' (BPM unknown)'}
        </span>
      </div>

      {/* Off-screen measurer: all pills + a worst-case toggle, laid out on one line
          so we can read each pill's natural width. */}
      <div ref={measureRef} aria-hidden
        style={{
          position: 'absolute', left: 0, top: 0, visibility: 'hidden', pointerEvents: 'none',
          zIndex: -1, display: 'flex', flexWrap: 'nowrap', gap: GAP,
          // Clip to the card so the wide no-wrap row can't add page horizontal scroll;
          // children keep their natural offsetWidth regardless of the clip.
          maxWidth: '100%', overflow: 'hidden',
        }}>
        {pills.map(p => <Pill key={`m-${p.t.a}-${p.t.b}`} p={p} />)}
        <button className="button" style={{ padding: '2px 10px', fontSize: 12 }}>+{Math.max(1, pills.length - 1)} more</button>
      </div>

      <div ref={rowRef} className="row" style={{ flexWrap: 'wrap', gap: GAP }}>
        {visible.map(p => <Pill key={`${p.t.a}-${p.t.b}`} p={p} />)}
        {(hasOverflow || expanded) && (
          <button className="button" style={{ padding: '2px 10px', fontSize: 12 }}
            onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Show less' : `+${hidden} more`}
          </button>
        )}
      </div>
    </div>
  );
}
