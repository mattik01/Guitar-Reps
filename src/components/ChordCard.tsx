import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalibrationMic } from './CalibrationMic';
import { ChordDiagram } from './ChordDiagram';
import { FingeringViewer } from './FingeringViewer';
import { CAL_MIN_SCORE, profileScore } from '../audio/calibration';
import { useChordProfiles } from '../state/store';
import { paintClass } from '../data/chordPaint';
import type { CardChord } from '../data/chordResolve';

// THE single way a chord is displayed anywhere in the app — grids, pickers, and
// the big focused diagrams inside the exercises. Everything varies by prop, so a
// cross-cutting feature (the calibration chip) is written once here and shows up
// on every surface at once.
//
// Frame:
//   'tile'    bordered grid member (repertoire, library, calibrate index, quiz picker)
//   'feature' roomier bordered panel (studio, swap pair, new-chord, quiz reveal)
//   'bare'    no frame (strum, editor preview, repertoire detail modal)
export type ChordCardVariant = 'tile' | 'feature' | 'bare';

// Diagram px + name px move together.
export type ChordCardSize = 'sm' | 'md' | 'lg' | 'xl';
const DIAGRAM_PX: Record<ChordCardSize, number> = { sm: 120, md: 200, lg: 240, xl: 260 };

export type ChordCardProps = {
  chord: CardChord;

  variant?: ChordCardVariant;
  size?: ChordCardSize;

  // 'auto' picks the fingering swiper when there is more than one fingering,
  // else a plain diagram. 'none' is REQUIRED where a diagram would be wrong.
  diagram?: 'auto' | 'shape' | 'fingerings' | 'none';
  diagramFallback?: ReactNode;   // shown when there is no shape to draw

  showName?: boolean;
  meta?: ReactNode;              // muted line(s) under the diagram
  footer?: ReactNode;            // full-width block under meta
  actions?: ReactNode;           // overlaid top-right of the diagram
  status?: ReactNode;            // above the diagram (verdict / cleanliness)

  calibration?: boolean;         // show the score chip (default true)
  score?: number;                // override when the caller already computed it
  needsCalibration?: boolean;    // highlight the chip (calibration-gate contract)

  // Only meaningful with a fingering swiper — see FingeringViewer.onSelect.
  onFingeringSelect?: (fingering: NonNullable<CardChord['fingerings']>[number], index: number) => void;

  onClick?: () => void;
  to?: string;                   // renders the whole card as a link instead
  selected?: boolean;
  // Greyed-back but still fully interactive — the Chords grid's "not in your
  // repertoire yet" state. NOT `disabled`, which also kills pointer events.
  dim?: boolean;
  disabled?: boolean;
  className?: string;
};

export function ChordCard({
  chord,
  variant = 'tile',
  size,
  diagram = 'auto',
  diagramFallback,
  showName = true,
  meta,
  footer,
  actions,
  status,
  calibration = true,
  score,
  needsCalibration = false,
  onFingeringSelect,
  onClick,
  to,
  selected = false,
  dim = false,
  disabled = false,
  className,
}: ChordCardProps) {
  const scale: ChordCardSize = size ?? (variant === 'tile' ? 'sm' : 'md');
  const px = DIAGRAM_PX[scale];

  // Subscribing here (rather than making every call site pass a score) is what
  // makes the chip cross-cutting. reps.chordProfiles is only ever WRITTEN from
  // the Calibration Studio, where a single card is mounted — no grid is on
  // screen during a write — so the per-subscriber re-parse cost stays bounded.
  const [profiles] = useChordProfiles();
  const profile = profiles[chord.id];
  const ownScore = useMemo(
    () => (chord.id && calibration && score == null ? profileScore(profile?.samples ?? []) : 0),
    // `profile` identity changes only when that chord's profile changes.
    [profile, chord.id, calibration, score]
  );
  const shownScore = score ?? ownScore;
  const showChip = calibration && !!chord.id;

  // 'auto' keys off whether the source carried fingerings at all: cardFromLibrary
  // always does, cardFromChord never does. So library chords get the swiper (with
  // its arrows hidden when there is only one fingering, which keeps every card in
  // a grid the same height) and repertoire chords get their single edited shape.
  const useViewer =
    diagram === 'fingerings' ||
    (diagram === 'auto' && !!chord.fingerings && chord.fingerings.length > 0 && !!chord.id);

  const clickable = !disabled && (!!onClick || !!to);
  const cls = [
    'chord-card',
    variant,
    `cc-${scale}`,
    // Chord-family colour. Identity, not state — see src/data/chordPaint.ts.
    paintClass(chord.id),
    clickable ? 'clickable' : 'static',
    selected ? 'selected' : '',
    dim ? 'dim' : '',
    disabled ? 'disabled' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  const body = (
    <>
      {showName && <div className="name">{chord.name}</div>}
      {status && <div className="chord-card-status">{status}</div>}
      {diagram !== 'none' && (
        <div className="chord-card-body">
          {chord.shape || useViewer ? (
            useViewer && chord.fingerings
              ? <FingeringViewer chordId={chord.id} fingerings={chord.fingerings} size={px}
                  onSelect={onFingeringSelect} />
              : chord.shape && <ChordDiagram shape={chord.shape} size={px} />
          ) : diagramFallback}
          {actions && <div className="chord-card-actions">{actions}</div>}
        </div>
      )}
      {meta && <div className="meta">{meta}</div>}
      {showChip && <CalibrationChip chordId={chord.id} score={shownScore} needs={needsCalibration} asLink={!to} />}
      {footer && <div className="chord-card-footer">{footer}</div>}
    </>
  );

  if (to && !disabled) {
    return <Link to={to} className={cls} aria-label={chord.name}>{body}</Link>;
  }

  if (onClick && !disabled) {
    const activate = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    };
    return (
      <div className={cls} role="button" tabIndex={0} aria-label={chord.name}
        onClick={onClick} onKeyDown={activate}>
        {body}
      </div>
    );
  }

  return <div className={cls}>{body}</div>;
}

// The per-chord calibration state, linking into the Calibration Studio. Rendered
// on every card so "how well does the app know this chord on my rig" is visible
// wherever a chord is — as the app-wide mic-in-a-ring button.
function CalibrationChip({ chordId, score, needs, asLink }: {
  chordId: string; score: number; needs: boolean; asLink: boolean;
}) {
  const done = score >= CAL_MIN_SCORE;
  const title = done
    ? `Calibrated (${score}/100) — open the studio to sharpen it`
    : score > 0
      ? `Calibration ${score}/100 — below what the mic exercises need`
      : 'Not calibrated — open the calibration studio';
  return (
    <CalibrationMic
      percent={score}
      done={done}
      needs={needs}
      asLink={asLink}
      to={`/calibrate/${encodeURIComponent(chordId)}`}
      title={title}
      ariaLabel={`Calibration ${score}/100 — calibrate ${chordId}`}
    />
  );
}
