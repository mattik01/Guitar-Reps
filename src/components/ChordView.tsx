import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChordCard } from './ChordCard';
import { ChordEditor } from './ChordEditor';
import { EditButton } from './EditButton';
import { Modal } from './Modal';
import { Sparkline } from './Sparkline';
import { CalibrationMic } from './CalibrationMic';
import { CAL_MIN_SCORE, profileScore } from '../audio/calibration';
import { CHORD_CATEGORIES } from '../data/chordCategories';
import { libraryChordById, materializeLibraryChord } from '../data/chordLibrary';
import { isKnown as isKnownAt, type MatchLevel } from '../data/chordNormalize';
import { cardFromKnownChord } from '../data/chordResolve';
import {
  useChordProfiles, useFingeringChoice, useRepertoire, useSwapRecords,
  useSetChordShape,
  type Chord, type ChordShape,
} from '../state/store';

// THE chord detail surface. Every "tell me about this chord" in the app renders
// THIS — the Chords grid, a chord chip in a song, a pair in a swap table, a
// chord name in an exercise. It is deliberately mount-agnostic: `ChordViewPage`
// puts it on a route, `ChordViewOverlay` puts it over whatever you were doing.
//
// The overlay is driven by the `?chord=` search param rather than local state,
// which is what makes it honest: Back closes it, reload keeps it open, and a URL
// like /songs?tab=mine&chord=Am is a real, shareable place.

const CHORD_PARAM = 'chord';

/** Read/mutate the app-wide "which chord is open" slot. */
export function useChordView(): {
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
  hrefFor: (id: string) => string;
} {
  const [params, setParams] = useSearchParams();
  const openId = params.get(CHORD_PARAM);

  const open = (id: string) => setParams(prev => {
    const next = new URLSearchParams(prev);
    next.set(CHORD_PARAM, id);
    return next;
  });

  // `replace` so closing doesn't leave a dead entry the user has to Back past twice.
  const close = () => setParams(prev => {
    const next = new URLSearchParams(prev);
    next.delete(CHORD_PARAM);
    return next;
  }, { replace: true });

  const hrefFor = (id: string) => {
    const next = new URLSearchParams(params);
    next.set(CHORD_PARAM, id);
    return `?${next}`;
  };

  return { openId, open, close, hrefFor };
}

/**
 * A chord name that opens the chord view. Use this ANYWHERE a chord is named —
 * song chip, swap pair, exercise header, roadmap. It is a real anchor (so
 * middle-click/copy-link work) that opens in place instead of navigating.
 */
export function ChordLink({ chordId, children, className, title, style }: {
  chordId: string;
  children?: React.ReactNode;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  const { open, hrefFor } = useChordView();
  return (
    <a
      href={hrefFor(chordId)}
      // Stable marker: call sites style the link themselves (a song chip keeps
      // its pill look), so the class can't be what identifies a chord link.
      data-chord-link={chordId}
      className={className ?? 'chord-link'}
      title={title ?? `Open ${chordId}`}
      style={style}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        open(chordId);
      }}
    >
      {children ?? chordId}
    </a>
  );
}

/**
 * THE chord pill. Wherever a chord is named inside a list of chords — a song's
 * chip row, a section's sequence, a picker — this is the element, so the three
 * visual tiers are defined once:
 *   filled green  you own it (at the active match level)
 *   dashed grey   a library chord you haven't learned yet
 *   dotted + "?"  not in the library at all — opening it registers the shape
 * `dense` is the tighter square-ish variant used inside a sequence chain.
 */
export function ChordChip({ chordId, knownSet, level, dense = false, suffix }: {
  chordId: string;
  knownSet: Set<string>;
  level: MatchLevel;
  dense?: boolean;
  suffix?: React.ReactNode; // trailing meta inside the pill (e.g. a bar-repeat count)
}) {
  const known = isKnownAt(chordId, knownSet, level);
  const unlibraried = !known && !libraryChordById(chordId);
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: dense ? '2px 8px' : '4px 10px',
    borderRadius: dense ? 6 : 999,
    background: known ? 'var(--good)' : 'transparent',
    color: known ? 'var(--accent-ink)' : 'var(--muted)',
    border: known ? '1px solid var(--good)' : unlibraried ? '1px dotted var(--muted)' : '1px dashed var(--line)',
    fontWeight: dense ? 600 : 700,
    fontSize: dense ? 12 : 13,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    textDecoration: 'none',
  };
  return (
    <ChordLink chordId={chordId} className="" style={style}
      title={unlibraried
        ? `${chordId} isn't in the chord library — open it to register the shape yourself`
        : `Open ${chordId}`}>
      {chordId}
      {unlibraried && <sup style={{ fontSize: 10, fontWeight: 800, opacity: 0.85 }}>?</sup>}
      {suffix}
    </ChordLink>
  );
}

/** Mounted once in App: renders the overlay whenever `?chord=` is set. */
export function ChordViewOverlay() {
  const { openId, close } = useChordView();
  if (!openId) return null;
  return (
    <Modal onClose={close}>
      <ChordView chordId={openId} onClose={close} />
    </Modal>
  );
}

// ── the view itself ──────────────────────────────────────────────────────────

export function ChordView({ chordId, onClose, showClose = true }: {
  chordId: string;
  /** Where to go when the chord stops existing (removed) or the user dismisses. */
  onClose?: () => void;
  /** The route already has a back link, so it hides the header's Close button. */
  showClose?: boolean;
}) {
  const [repertoire, setRepertoire] = useRepertoire();
  const setChordShape = useSetChordShape();
  const [fingeringChoice] = useFingeringChoice();
  const [profiles] = useChordProfiles();
  const [editing, setEditing] = useState(false);

  const owned = repertoire.find(c => c.id === chordId) ?? null;
  const lib = libraryChordById(chordId);
  const score = profileScore(profiles[chordId]?.samples ?? []);
  const names = useMemo(() => new Map(repertoire.map(c => [c.id, c.name])), [repertoire]);

  function addToRepertoire() {
    const chord = materializeLibraryChord(chordId, fingeringChoice[chordId] ?? 0);
    if (!chord) return;
    setRepertoire(prev => prev.some(c => c.id === chord.id) ? prev : [...prev, chord]);
  }

  function removeFromRepertoire() {
    if (!confirm(`Remove ${owned?.name ?? chordId} from your repertoire?`)) return;
    setRepertoire(prev => prev.filter(c => c.id !== chordId));
    onClose?.();
  }

  function saveEdit(value: { name: string; shape: ChordShape }) {
    setRepertoire(prev => prev.map(c =>
      c.id === chordId ? { ...c, name: value.name, shape: value.shape } : c
    ));
    setEditing(false);
  }

  function registerCustom(value: { name: string; shape: ChordShape }) {
    const chord: Chord = {
      id: chordId, name: value.name, shape: value.shape,
      learnedAt: Date.now(), perfectReps: 0,
    };
    setRepertoire(prev => prev.some(c => c.id === chord.id) ? prev : [...prev, chord]);
    setEditing(false);
  }

  const name = owned?.name ?? lib?.name ?? chordId;

  // ONE primary button in the whole view, and it is always the genuine next
  // step for this chord: get it, then teach the app to hear it, then drill it.
  const nextStep: 'add' | 'calibrate' | 'practice' =
    !owned ? 'add' : score < CAL_MIN_SCORE ? 'calibrate' : 'practice';

  // A chord the app has never heard of — reachable from a song chip whose chord
  // isn't in the library. The view's job there is to let you register the shape.
  if (!owned && !lib) {
    return (
      <div className="chord-view">
        <ChordViewHeader name={chordId} chordId={chordId} score={score} onClose={showClose ? onClose : undefined} />
        <p className="muted">
          <strong>{chordId}</strong> isn't in the chord library yet. Register the shape you play
          and it joins your repertoire — exercises and mic calibration then work on it like any
          other chord.
        </p>
        <ChordEditor
          withCategory
          title={`Register ${chordId}`}
          initialName={chordId}
          saveLabel="Add to repertoire"
          onSave={registerCustom}
          onCancel={() => onClose?.()}
        />
      </div>
    );
  }

  const card = cardFromKnownChord(owned, lib);

  return (
    <div className="chord-view">
      <ChordViewHeader name={name} chordId={chordId} score={score} onClose={showClose ? onClose : undefined} />

      {editing && owned ? (
        <ChordEditor
          title={`Edit ${owned.name}`}
          calibratedChordId={owned.id}
          initialName={owned.name}
          initialShape={owned.shape}
          saveLabel="Save changes"
          onSave={saveEdit}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="chord-view-top">
            <ChordCard
              variant="bare"
              size="md"
              chord={card}
              showName={false}
              calibration={false}
              diagramFallback={<p className="muted">No shape yet.</p>}
              onFingeringSelect={owned ? f => setChordShape(owned.id, f.shape) : undefined}
              actions={owned && (
                <EditButton onClick={() => setEditing(true)}
                  title="Edit this shape" label="Edit shape" />
              )}
            />
            <div className="chord-view-facts">
              <ChordFacts owned={owned} lib={lib} />
              {!owned && (
                <div className="row">
                  <button className="button primary" onClick={addToRepertoire}>+ Add to repertoire</button>
                </div>
              )}
            </div>
          </div>

          <PracticeSection chordId={chordId} name={name} owned={!!owned}
            primary={nextStep === 'practice'} />
          <SwapSection chordId={chordId} names={names} />

          {owned && (
            <div className="footer-bar">
              <div className="spacer" />
              <button className="button danger" onClick={removeFromRepertoire}>Remove from repertoire</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChordViewHeader({ name, chordId, score, onClose }: {
  name: string; chordId: string; score: number; onClose?: () => void;
}) {
  return (
    <div className="row chord-view-header">
      <h2 className="chord-view-name">{name}</h2>
      {/* The app-wide indicator IS the calibration story here — score in the ring,
          click to open the Studio. No separate calibration section below. */}
      <CalibrationMic
        percent={score}
        done={score >= CAL_MIN_SCORE}
        to={`/calibrate/${encodeURIComponent(chordId)}`}
        size={30}
        title={score >= CAL_MIN_SCORE
          ? `Calibrated ${score}/100 — open the Studio to sharpen it`
          : score > 0
            ? `Calibrated ${score}/100 — below the ${CAL_MIN_SCORE} the mic exercises need`
            : 'Not calibrated — open the Calibration Studio'}
      />
      <div className="spacer" />
      {onClose && <button className="button" onClick={onClose}>Close</button>}
    </div>
  );
}

function ChordFacts({ owned, lib }: { owned: Chord | null; lib: ReturnType<typeof libraryChordById> }) {
  const cat = lib ? CHORD_CATEGORIES.find(c => c.id === lib.category) : undefined;
  return (
    <div className="chord-view-fact-list">
      {cat && <div className="muted">{cat.name} · {cat.roadmapLevel}</div>}
      {lib && <div className="muted">Difficulty {lib.difficulty}/10 · Importance {lib.importance}/10</div>}
      {lib?.info && <p style={{ margin: '6px 0' }}>{lib.info}</p>}
      {owned ? (
        <div>
          <strong>In your repertoire</strong> · added {new Date(owned.learnedAt).toLocaleDateString()}
          {' · '}{owned.perfectReps} perfect rep{owned.perfectReps === 1 ? '' : 's'}
        </div>
      ) : (
        <div className="muted">Not in your repertoire yet.</div>
      )}
    </div>
  );
}

function PracticeSection({ chordId, name, owned, primary }: {
  chordId: string; name: string; owned: boolean; primary: boolean;
}) {
  const q = encodeURIComponent(chordId);
  return (
    <section className="chord-view-section">
      <h3>Practice</h3>
      {owned ? (
        <div className="row">
          <Link to={`/routine/quiz?chord=${q}`} className={`button ${primary ? 'primary' : ''}`}>Quiz me on {name}</Link>
          <Link to={`/routine/swap?a=${q}`} className="button">Train swaps</Link>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Add {name} to your repertoire to quiz and train it. Or take it through the{' '}
          <Link to="/routine/new">New chord</Link> routine.
        </p>
      )}
    </section>
  );
}

function SwapSection({ chordId, names }: { chordId: string; names: Map<string, string> }) {
  const [swaps] = useSwapRecords();
  const related = useMemo(
    () => Object.values(swaps)
      .filter(s => s.chordA === chordId || s.chordB === chordId)
      .sort((a, b) => b.bestCount - a.bestCount),
    [swaps, chordId]
  );
  if (related.length === 0) return null;
  return (
    <section className="chord-view-section">
      <h3>Swap pairs with {names.get(chordId) ?? chordId}</h3>
      <table className="matrix" style={{ width: '100%' }}>
        <thead>
          <tr><th>Partner</th><th>Best</th><th>Last</th><th>Attempts</th><th>Trend</th></tr>
        </thead>
        <tbody>
          {related.map(r => {
            const otherId = r.chordA === chordId ? r.chordB : r.chordA;
            return (
              <tr key={r.pairKey}>
                <th><ChordLink chordId={otherId}>{names.get(otherId) ?? otherId}</ChordLink></th>
                <td>{r.bestCount}</td>
                <td>{r.lastCount}</td>
                <td>{r.attempts}</td>
                <td><Sparkline history={r.history} small /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
