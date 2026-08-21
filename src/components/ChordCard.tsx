import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChordDiagram } from './ChordDiagram';
import { FingeringViewer } from './FingeringViewer';
import { CAL_MIN_SCORE, profileScore } from '../audio/calibration';
import { useChordProfiles } from '../state/store';
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

  onClick?: () => void;
  to?: string;                   // renders the whole card as a link instead
  selected?: boolean;
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
  onClick,
  to,
  selected = false,
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
    clickable ? 'clickable' : 'static',
    selected ? 'selected' : '',
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
              ? <FingeringViewer chordId={chord.id} fingerings={chord.fingerings} size={px} />
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

// The per-chord calibration score, linking into the Calibration Studio. Rendered
// on every card so "how well does the app know this chord on my rig" is visible
// wherever a chord is.
//
// `asLink` is false when the CARD is already a <Link>: an <a> inside an <a> is
// invalid HTML and the parser would close the outer anchor, leaving a DOM that no
// longer matches React's tree. Those cards already point at the studio anyway.
function CalibrationChip({ chordId, score, needs, asLink }: {
  chordId: string; score: number; needs: boolean; asLink: boolean;
}) {
  const done = score >= CAL_MIN_SCORE;
  const cls = `cal-chip ${done ? 'good' : score > 0 ? 'partial' : 'warn'}${needs ? ' needs' : ''}`;
  const label = score > 0 ? `${score}/100${done ? ' ✓' : ''}` : 'not calibrated';
  const title = done
    ? 'Calibrated — open the studio to sharpen it'
    : 'Below the score the mic exercises need — open the calibration studio';

  if (!asLink) return <span className={cls} title={title}>{label}</span>;
  return (
    <Link
      to={`/calibrate/${encodeURIComponent(chordId)}`}
      className={cls}
      title={title}
      aria-label={`Calibration ${label} — calibrate this chord`}
      // The card around this is a role=button; without both of these a chip
      // click (or Enter on the focused chip) would also fire the card's action.
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >{label}</Link>
  );
}
