// Per-song chord-change surface, in two depths.
//
// Collapsed: the song's most common chord changes as pills, each coloured
// red→yellow→green by how fast the user swapped that pair in their latest swap
// exercise (grey = never trained). Green target is half the song's BPM (≤120/min),
// red floor is an eighth of it. See src/data/songTransitions.ts for the maths.
// The strip shows as many pills as the card is wide enough to hold on one line;
// the rest fold behind a "+N more" toggle so nothing ever spills outside the card.
//
// Expanded: the same pills in full, PLUS the song's actual structure — every
// labelled section (Intro, Verse 1, Chorus…) as its ordered chord sequence, with
// consecutive repeats collapsed to "×n" bars. The connector between two chords is
// the same graded, clickable change as the pill above it, so "which change happens
// where, and how fast am I on it" is answered in one place.
//
// A clickable pill or connector opens the swap exercise for that pair; if a chord
// isn't in the repertoire yet, the swap routine offers to register it first.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconExpanded } from './icons';
import { useNavigate } from 'react-router-dom';
import { useRepertoire, useSwapRecords } from '../state/store';

import { parseChord, type MatchLevel } from '../data/chordNormalize';
import { ChordChip } from './ChordView';
import {
  gradeTransition, playability, repertoireByBase, recordForPair, speedAnchors,
  type Transition, type TransitionGrade,
} from '../data/songTransitions';
import { EMPTY_ANALYSIS, cachedAnalysis, loadAnalysis, type SongAnalysis } from '../data/songAnalysis';

const GAP = 6; // must match the pill row's flex gap
const MAX_SECTION_CHORDS = 32; // a runaway section is truncated rather than flooding the card

// One chord change, graded and (when both chords are trainable) clickable. Shared by
// the pills and by the connectors inside the section sequence.
type Change = {
  g: TransitionGrade;
  trainable: boolean;
  title: string;
  open: (() => void) | undefined;
};

type PillModel = Change & {
  t: Transition;
  aLabel: string; // the actual chord from this song (e.g. "Am7"), not the bare base "A"
  bLabel: string;
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

// The connector between two chords in a section sequence: the change itself, as a
// small button wearing the same language as the pills above — solid, grade-coloured
// border once trained; the dashed "not yours yet" outline while it never has been,
// matching how an unowned chord chip reads.
function Connector({ c }: { c: Change | null }) {
  if (!c) return <span className="muted" style={{ fontSize: 12, opacity: 0.5, padding: '0 1px' }}>·</span>;
  const { g, trainable, title, open } = c;
  return (
    <span title={title}
      role={trainable ? 'button' : undefined}
      tabIndex={trainable ? 0 : undefined}
      onClick={open}
      onKeyDown={open ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }) : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 22, padding: '1px 5px', borderRadius: 999,
        fontSize: 12, fontWeight: 800, lineHeight: 1.3,
        color: g.trained ? g.color : 'var(--muted)',
        background: g.trained ? g.bg : 'transparent',
        border: g.trained ? `1.5px solid ${g.color}` : '1px dashed var(--line)',
        cursor: trainable ? 'pointer' : 'default',
      }}>→</span>
  );
}

// 0 % (nothing trained) → 100 % (every change at the green target).
function playabilityColor(score: number): string {
  return `hsl(${Math.round(Math.max(0, Math.min(100, score)) * 1.2)}, 70%, 42%)`;
}

export function SongTransitions({ catalogId, tempo, chords = [], knownSet, level }: {
  catalogId: number | null;
  tempo: number | null | undefined;
  chords?: string[]; // the song's chord list — used to label transitions with the real chord
  knownSet: Set<string>;
  level: MatchLevel;
}) {
  const navigate = useNavigate();
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();
  const [analysis, setAnalysis] = useState<SongAnalysis | null>(
    () => (catalogId != null ? cachedAnalysis(catalogId) : EMPTY_ANALYSIS),
  );
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (catalogId == null) { setAnalysis(EMPTY_ANALYSIS); return; }
    const hit = cachedAnalysis(catalogId);
    if (hit) { setAnalysis(hit); return; }
    setAnalysis(null);
    let cancelled = false;
    loadAnalysis(catalogId).then(a => { if (!cancelled) setAnalysis(a); });
    return () => { cancelled = true; };
  }, [catalogId]);

  const byBase = useMemo(() => repertoireByBase(repertoire), [repertoire]);
  // The same score Browse can sort by — shown here so the sort order is legible on
  // the card itself rather than being a mystery ranking.
  const score = useMemo(
    () => playability(analysis?.transitions ?? [], tempo, byBase, swaps),
    [analysis, tempo, byBase, swaps],
  );
  const anchors = speedAnchors(tempo);
  const list = analysis?.transitions ?? [];
  const sections = analysis?.sections ?? [];

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

  // Grade + wire one base pair. `null` when the two chords share a base (Am→Am7 is
  // not a swap you can train) — the caller renders a neutral separator instead.
  const changeFor = useMemo(() => (a: string, b: string, aLabel: string, bLabel: string): Change | null => {
    if (a === b) return null;
    const g = gradeTransition(recordForPair(a, b, byBase, swaps), tempo);
    // Prefer each chord's repertoire id (first shape variant); fall back to the base
    // token so the swap exercise can open even when a chord isn't owned yet — it now
    // offers to register any missing chord (prefilled from the library) before starting.
    const idA = byBase.get(a)?.[0] ?? a;
    const idB = byBase.get(b)?.[0] ?? b;
    const trainable = idA !== idB;
    const missing = [a, b].filter(x => !byBase.get(x)?.[0]);
    const title = missing.length
      ? `Click to train the ${aLabel} ↔ ${bLabel} swap — you'll register ${missing.join(' & ')} first`
      : g.trained
        ? `Your last: ${g.rate}/min · green at ${Math.round(anchors.green)}/min, red at ${Math.round(anchors.red)}/min · click to train`
        : `Never trained — click to train the ${aLabel} ↔ ${bLabel} swap`;
    return {
      g, trainable, title,
      open: trainable
        ? () => navigate(`/routine/swap?a=${encodeURIComponent(idA)}&b=${encodeURIComponent(idB)}`)
        : undefined,
    };
  }, [byBase, swaps, tempo, anchors.green, anchors.red, navigate]);

  const pills = useMemo<PillModel[]>(() => list.flatMap(t => {
    const aLabel = displayByBase.get(t.a) ?? t.a;
    const bLabel = displayByBase.get(t.b) ?? t.b;
    const c = changeFor(t.a, t.b, aLabel, bLabel);
    return c ? [{ ...c, t, aLabel, bLabel }] : [];
  }), [list, displayByBase, changeFor]);

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
      const pillW = kids.map(k => k.offsetWidth);
      const totalAll = pillW.reduce((s, w) => s + w, 0) + GAP * Math.max(0, pillW.length - 1);
      if (totalAll <= avail) { setFitCount(pills.length); return; }
      // The overflow count lives on the header toggle, so the line is free to fill.
      let used = 0, n = 0;
      for (let i = 0; i < pillW.length; i++) {
        const add = pillW[i] + (n > 0 ? GAP : 0);
        if (used + add > avail) break;
        used += add; n++;
      }
      setFitCount(Math.max(1, n));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(row);
    return () => ro.disconnect();
  }, [pills]);

  if (analysis == null) {
    return <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Analyzing transitions…</div>;
  }
  if (pills.length === 0) return null;

  const collapsedCount = Math.min(fitCount, pills.length);
  const hasOverflow = collapsedCount < pills.length;
  const visible = expanded ? pills : pills.slice(0, collapsedCount);
  const hidden = pills.length - collapsedCount;
  // Expanding is worth offering even when every pill already fits, as long as there
  // is a structure to reveal underneath.
  const canExpand = hasOverflow || sections.length > 0;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>Chord changes</span>
        {canExpand && (
          <button className="button" onClick={() => setExpanded(e => !e)}
            title={expanded
              ? 'Hide the section-by-section sequence'
              : `Show the section-by-section sequence${hidden > 0 ? ` and ${hidden} more change${hidden > 1 ? 's' : ''}` : ''}`}
            style={{ padding: '0 6px', fontSize: 10, lineHeight: 1.6, borderRadius: 'var(--r-sm)' }}>
            <IconExpanded size={13} style={{ transition: 'transform .15s', transform: expanded ? 'rotate(180deg)' : 'none' }} />
            {!expanded && hidden > 0 && <span style={{ fontSize: 11, marginLeft: 4, fontWeight: 700 }}>+{hidden}</span>}
          </button>
        )}
        <span className="muted" style={{ fontSize: 11 }}
          title={tempo
            ? `Green is half this song's tempo (${Math.round(tempo)} BPM), capped at 120 swaps/min; red is an eighth of it`
            : 'This song has no tempo in the catalog, so the target assumes a mid tempo (120 BPM)'}>
          · green ≈ {Math.round(anchors.green)}/min
        </span>
        {score != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: playabilityColor(score) }}
            title="Playability: how much of this song's chord changes you already have, weighted by how often each one occurs. A change at the green target counts in full, an untrained one counts as nothing — so 100% is every change at target. Browse can sort by this.">
            {score}%
          </span>
        )}
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
      </div>

      <div ref={rowRef} className="row" style={{ flexWrap: 'wrap', gap: GAP }}>
        {visible.map(p => <Pill key={`${p.t.a}-${p.t.b}`} p={p} />)}
      </div>

      {expanded && sections.length > 0 && (
        <div className="col" style={{ gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          {sections.map((sec, si) => {
            const shown = sec.chords.slice(0, MAX_SECTION_CHORDS);
            return (
              <div key={si} className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'nowrap' }}>
                <span className="muted" style={{ fontSize: 11, fontWeight: 700, flex: '0 0 72px', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {sec.label || 'Section'}
                </span>
                <div className="row" style={{ flexWrap: 'wrap', gap: 3, alignItems: 'center', minWidth: 0 }}>
                  {shown.map((ch, ci) => {
                    const prev = ci > 0 ? shown[ci - 1] : null;
                    const pa = prev ? parseChord(prev) : null;
                    const pb = parseChord(ch);
                    const c = prev && pa?.ok && pb.ok
                      ? changeFor(pa.base, pb.base, prev, ch)
                      : null;
                    const bars = sec.repeats[ci];
                    return (
                      <Fragment key={ci}>
                        {ci > 0 && <Connector c={c} />}
                        <ChordChip chordId={ch} knownSet={knownSet} level={level} dense
                          suffix={bars > 1
                            ? <span style={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>×{bars}</span>
                            : undefined} />
                      </Fragment>
                    );
                  })}
                  {sec.chords.length > shown.length && (
                    <span className="muted" style={{ fontSize: 11 }}>+{sec.chords.length - shown.length} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
