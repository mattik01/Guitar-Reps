import { useMemo, useState } from 'react';
import { IconWarn } from './icons';
import { ChordCard } from './ChordCard';
import { cardFromDraft } from '../data/chordResolve';
import { CHORD_CATEGORIES, type ChordCategoryId } from '../data/chordCategories';
import { profileScore, shapeKey } from '../audio/calibration';
import { clearChordProfile, useChordProfiles, type ChordShape, type FingerMark } from '../state/store';

type Props = {
  initialName?: string;
  initialShape?: ChordShape;
  onSave: (value: { name: string; shape: ChordShape; category?: ChordCategoryId }) => void;
  onCancel?: () => void;
  saveLabel?: string;
  title?: string;
  // When true, show a category picker (defaulting to `initialCategory`, else "Other")
  // and include the chosen category in the saved value. Used when registering a new chord.
  withCategory?: boolean;
  initialCategory?: ChordCategoryId;
  // The chord being EDITED, if any. Editing its shape invalidates the calibration
  // profile (which describes how the old shape sounds), so the editor owns both
  // the warning and the clearing — every edit path gets it for free, instead of
  // each call site remembering to invalidate.
  calibratedChordId?: string;
};

const EMPTY_FRETS: string[] = ['x', 'x', 'x', 'x', 'x', 'x'];
const EMPTY_FINGERS: string[] = ['', '', '', '', '', ''];

function shapeToInputs(shape?: ChordShape) {
  if (!shape) {
    return {
      frets: [...EMPTY_FRETS],
      fingers: [...EMPTY_FINGERS],
      baseFret: '1',
      barreEnabled: false,
      barreFromIndex: '0',
      barreToIndex: '5',
      barreFret: '1',
    };
  }
  return {
    frets: shape.frets.map(f => f === 'x' ? 'x' : String(f)),
    fingers: shape.fingers.map(f => f == null ? '' : String(f)),
    baseFret: String(shape.baseFret ?? 1),
    barreEnabled: !!shape.barre,
    barreFromIndex: String(shape.barre?.fromIndex ?? 0),
    barreToIndex: String(shape.barre?.toIndex ?? 5),
    barreFret: String(shape.barre?.fret ?? 1),
  };
}

function parseFinger(s: string): FingerMark {
  const t = s.trim();
  if (t === '') return null;
  const upper = t.toUpperCase();
  if (upper === 'T') return 'T';
  const n = parseInt(t, 10);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  throw new Error(`Finger must be 1–4 or T (got "${s}")`);
}

function parseFret(s: string, stringIdx: number): number | 'x' {
  const t = s.trim().toLowerCase();
  if (t === 'x' || t === '') return 'x';
  const n = parseInt(t, 10);
  if (!Number.isFinite(n) || n < 0 || n > 24) {
    throw new Error(`String ${stringIdx + 1}: fret must be 0–24 or x`);
  }
  return n;
}

export function ChordEditor({ initialName = '', initialShape, onSave, onCancel, saveLabel = 'Save', title = 'Custom chord', withCategory = false, initialCategory, calibratedChordId }: Props) {
  const [profiles] = useChordProfiles();
  const calScore = calibratedChordId ? profileScore(profiles[calibratedChordId]?.samples ?? []) : 0;
  const initial = useMemo(() => shapeToInputs(initialShape), [initialShape]);
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState<ChordCategoryId>(initialCategory ?? 'other');
  const [frets, setFrets] = useState<string[]>(initial.frets);
  const [fingers, setFingers] = useState<string[]>(initial.fingers);
  const [baseFret, setBaseFret] = useState<string>(initial.baseFret);
  const [barreEnabled, setBarreEnabled] = useState(initial.barreEnabled);
  const [barreFromIndex, setBarreFromIndex] = useState<string>(initial.barreFromIndex);
  const [barreToIndex, setBarreToIndex] = useState<string>(initial.barreToIndex);
  const [barreFret, setBarreFret] = useState<string>(initial.barreFret);
  const [error, setError] = useState<string | null>(null);

  const shape = useMemo<ChordShape | null>(() => {
    try {
      const f = frets.map((v, i) => parseFret(v, i));
      const fi = fingers.map(parseFinger);
      const bf = parseInt(baseFret || '1', 10);
      if (!Number.isFinite(bf) || bf < 1 || bf > 24) throw new Error('Base fret must be 1–24');
      let barre: ChordShape['barre'] = null;
      if (barreEnabled) {
        const from = parseInt(barreFromIndex, 10);
        const to = parseInt(barreToIndex, 10);
        const bfret = parseInt(barreFret, 10);
        if (!Number.isFinite(from) || from < 0 || from > 5) throw new Error('Barre from-string must be 0–5');
        if (!Number.isFinite(to) || to < 0 || to > 5) throw new Error('Barre to-string must be 0–5');
        if (from >= to) throw new Error('Barre from-string must be less than to-string');
        if (!Number.isFinite(bfret) || bfret < 1) throw new Error('Barre fret must be ≥ 1');
        barre = { fromIndex: from, toIndex: to, fret: bfret };
      }
      return { frets: f, fingers: fi, baseFret: bf, barre };
    } catch {
      return null;
    }
  }, [frets, fingers, baseFret, barreEnabled, barreFromIndex, barreToIndex, barreFret]);

  function updateArr(arr: string[], setArr: (v: string[]) => void, i: number, value: string) {
    const next = [...arr];
    next[i] = value;
    setArr(next);
  }

  function save() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    try {
      const f = frets.map((v, i) => parseFret(v, i));
      const fi = fingers.map(parseFinger);
      const bf = parseInt(baseFret || '1', 10);
      if (!Number.isFinite(bf) || bf < 1 || bf > 24) throw new Error('Base fret must be 1–24');
      let barre: ChordShape['barre'] = null;
      if (barreEnabled) {
        const from = parseInt(barreFromIndex, 10);
        const to = parseInt(barreToIndex, 10);
        const bfret = parseInt(barreFret, 10);
        if (from >= to) throw new Error('Barre from-string must be less than to-string');
        barre = { fromIndex: from, toIndex: to, fret: bfret };
      }
      const nextShape: ChordShape = { frets: f, fingers: fi, baseFret: bf, barre };
      // shapeKey ignores `fingers`: re-annotating which finger frets a note doesn't
      // change how the chord SOUNDS, so it must not throw away the calibration.
      if (calibratedChordId && initialShape && shapeKey(nextShape) !== shapeKey(initialShape)) {
        clearChordProfile(calibratedChordId);
      }
      onSave({ name: trimmed, shape: nextShape, category: withCategory ? category : undefined });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const stringLabels = ['E (low)', 'A', 'D', 'G', 'B', 'e (high)'];

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="spacer" />
        {onCancel && <button className="button" onClick={onCancel}>Cancel</button>}
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        Strings are listed low E → high E. Fret: <code>0</code>–<code>24</code> or <code>x</code> for muted.
        Fingers: <code>1</code> index, <code>2</code> middle, <code>3</code> ring, <code>4</code> pinky, <code>T</code> thumb (blank for open/muted).
      </p>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <label className="col" style={{ gap: 4 }}>
            Name
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Csus4"
              style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }}
            />
          </label>

          {withCategory && (
            <label className="col" style={{ gap: 4, marginTop: 10 }}>
              Category
              <select value={category} onChange={e => setCategory(e.target.value as ChordCategoryId)}
                style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }}>
                {CHORD_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}

          <table className="matrix" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>String</th><th>Fret</th><th>Finger</th></tr>
            </thead>
            <tbody>
              {stringLabels.map((label, i) => (
                <tr key={i}>
                  <th>{label}</th>
                  <td>
                    <input type="text" value={frets[i]}
                      onChange={e => updateArr(frets, setFrets, i, e.target.value)}
                      style={{ width: 48, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6, textAlign: 'center' }}
                    />
                  </td>
                  <td>
                    <input type="text" value={fingers[i]}
                      onChange={e => updateArr(fingers, setFingers, i, e.target.value)}
                      placeholder="1-4/T"
                      style={{ width: 56, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6, textAlign: 'center' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: 10 }}>
            <label>
              Base fret
              <input type="number" min={1} max={24} value={baseFret}
                onChange={e => setBaseFret(e.target.value)}
                style={{ marginLeft: 6, width: 60 }}
              />
            </label>
          </div>

          <label className="toggle" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={barreEnabled} onChange={e => setBarreEnabled(e.target.checked)} />
            Barre chord
          </label>
          {barreEnabled && (
            <div className="row" style={{ marginTop: 6 }}>
              <label>From string
                <input type="number" min={0} max={5} value={barreFromIndex}
                  onChange={e => setBarreFromIndex(e.target.value)}
                  style={{ marginLeft: 6, width: 60 }}
                />
              </label>
              <label>To string
                <input type="number" min={0} max={5} value={barreToIndex}
                  onChange={e => setBarreToIndex(e.target.value)}
                  style={{ marginLeft: 6, width: 60 }}
                />
              </label>
              <label>At fret
                <input type="number" min={1} max={24} value={barreFret}
                  onChange={e => setBarreFret(e.target.value)}
                  style={{ marginLeft: 6, width: 60 }}
                />
              </label>
            </div>
          )}
        </div>

        <div style={{ minWidth: 240, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Preview</div>
          {/* id '' — an unsaved draft has nothing to calibrate yet, so no chip. */}
          <ChordCard
            variant="bare"
            chord={cardFromDraft('', name, shape)}
            showName={false}
            diagramFallback={<div className="muted" style={{ padding: 20 }}>Fix the errors to preview.</div>}
          />
        </div>
      </div>

      {error && <div style={{ color: 'var(--bad)', marginTop: 8 }}>{error}</div>}

      {calScore > 0 && (
        <div className="muted" style={{ marginTop: 8, color: 'var(--warn)' }}>
          <IconWarn size={13} /> This chord is calibrated ({calScore}/100). Saving a different shape clears that —
          you'd need a few clean strums in the Calibration Studio to build it back up.
          (Changing only the finger numbers is fine.)
        </div>
      )}

      <div className="footer-bar">
        <button className="button primary big" onClick={save} disabled={!shape || !name.trim()}>
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
