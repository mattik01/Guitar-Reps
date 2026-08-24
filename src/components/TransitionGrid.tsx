// THE way a set of chord-change targets is rendered: one cell per transition,
// showing your best minute against that change's own target, coloured on the same
// red→yellow→green ramp the song cards use.
//
// Used under every roadmap target step (see src/data/transitionTargets.ts). Every
// cell counts: the step's checkbox lights only when all of them are green.
//
// A cell whose chord isn't in the library yet is greyed and inert: the change is
// still placed in the curriculum, you just can't train it today.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRepertoire, useSwapRecords } from '../state/store';
import { recordForPair, repertoireByBase } from '../data/songTransitions';
import { transitionAvailable, type TransitionTarget } from '../data/transitionTargets';

type CellModel = {
  key: string;
  a: string;
  b: string;
  target: number;
  best: number | null;      // your best minute for the pair, null = never trained
  trained: boolean;
  inLibrary: boolean;
  owned: boolean;           // both chords in the repertoire (so it can be trained now)
  met: boolean;
  color: string;
  bg: string;
  title: string;
  open: (() => void) | undefined;
};

function Cell({ c }: { c: CellModel }) {
  return (
    <div title={c.title}
      role={c.open ? 'button' : undefined}
      tabIndex={c.open ? 0 : undefined}
      onClick={c.open}
      onKeyDown={c.open ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.open!(); } }) : undefined}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        padding: '4px 8px', borderRadius: 8, minWidth: 62,
        background: c.bg,
        border: c.trained ? `1.5px solid ${c.color}` : `1px dashed ${c.color}`,
        opacity: c.inLibrary ? 1 : 0.45,
        cursor: c.open ? 'pointer' : 'default',
      }}>
      <span style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{c.a} ↔ {c.b}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: c.color, whiteSpace: 'nowrap' }}>
        {c.best ?? '—'} / {c.target}
      </span>
    </div>
  );
}

export function TransitionGrid({ targets }: { targets: TransitionTarget[] }) {
  const navigate = useNavigate();
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();

  const cells = useMemo<CellModel[]>(() => {
    const byBase = repertoireByBase(repertoire);
    const build = (t: TransitionTarget): CellModel => {
      const inLibrary = transitionAvailable(t.a, t.b);
      const idA = byBase.get(t.a)?.[0];
      const idB = byBase.get(t.b)?.[0];
      const owned = Boolean(idA && idB);
      const record = recordForPair(t.a, t.b, byBase, swaps);
      const best = record ? record.bestCount : null;
      const met = (best ?? 0) >= t.target;
      // Same ramp as gradeTransition: 0 = red, 120 = green — here the scale is the
      // level's own target rather than a song's tempo.
      const hue = Math.round(Math.max(0, Math.min(1, (best ?? 0) / t.target)) * 120);
      const trained = best != null;
      const color = trained ? `hsl(${hue}, 70%, 42%)` : 'var(--muted)';
      const bg = trained ? `hsla(${hue}, 70%, 45%, 0.16)` : 'transparent';
      const title = !inLibrary
        ? `${t.a} ↔ ${t.b} — not in the chord library yet, so it doesn't count towards this target`
        : !owned
          ? `${t.a} ↔ ${t.b} — add both chords to your repertoire to train this`
          : trained
            ? `Your best: ${best}/min · target ${t.target}/min · click to train`
            : `Never trained — target ${t.target}/min · click to train`;
      return {
        key: `${t.a}|${t.b}`, a: t.a, b: t.b, target: t.target, best, trained, inLibrary, owned,
        met, color, bg, title,
        open: inLibrary && owned
          ? () => navigate(`/routine/swap?a=${encodeURIComponent(idA!)}&b=${encodeURIComponent(idB!)}`)
          : undefined,
      };
    };
    return targets.map(build);
  }, [targets, repertoire, swaps, navigate]);

  if (cells.length === 0) return null;
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '4px 0 0 30px' }}>
      {cells.map(c => <Cell key={c.key} c={c} />)}
    </div>
  );
}
