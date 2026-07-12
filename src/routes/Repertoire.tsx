import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChordCard } from '../components/ChordCard';
import { ChordDiagram } from '../components/ChordDiagram';
import { ChordEditor } from '../components/ChordEditor';
import { LibraryChordGrid } from '../components/LibraryChordGrid';
import { CHORD_LIBRARY } from '../data/chordLibrary';
import { Sparkline } from '../routines/SwapRoutine';
import { useFingeringChoice, useRepertoire, useSwapRecords, type Chord, type ChordShape, type SwapRecord } from '../state/store';

export default function Repertoire() {
  const [repertoire, setRepertoire] = useRepertoire();
  const [swaps] = useSwapRecords();
  const [fingeringChoice] = useFingeringChoice();
  const [picking, setPicking] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const owned = useMemo(() => new Set(repertoire.map(c => c.id)), [repertoire]);
  const available = CHORD_LIBRARY.filter(c => !owned.has(c.id))
    .sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0));
  const trainedPairs = useMemo(
    () => Object.values(swaps).sort((a, b) => b.lastAt - a.lastAt),
    [swaps]
  );
  const names = useMemo(() => new Map(repertoire.map(c => [c.id, c.name])), [repertoire]);

  function addChord(id: string) {
    const lib = CHORD_LIBRARY.find(c => c.id === id);
    if (!lib) return;
    const idx = Math.min(Math.max(fingeringChoice[id] ?? 0, 0), lib.fingerings.length - 1);
    const chord: Chord = {
      id: lib.id, name: lib.name, shape: lib.fingerings[idx].shape,
      category: lib.category, difficulty: lib.difficulty, importance: lib.importance,
      info: lib.info, learnedAt: Date.now(), perfectReps: 0,
    };
    setRepertoire(prev => [...prev, chord]);
    setPicking(false);
  }

  function removeChord(id: string) {
    if (!confirm(`Remove ${id} from repertoire?`)) return;
    setRepertoire(prev => prev.filter(c => c.id !== id));
    setDetailId(null);
    setEditing(false);
  }

  function saveEdit(value: { name: string; shape: ChordShape }) {
    if (!detailId) return;
    setRepertoire(prev => prev.map(c =>
      c.id === detailId ? { ...c, name: value.name, shape: value.shape } : c
    ));
    setEditing(false);
  }

  const detail = detailId ? repertoire.find(c => c.id === detailId) : null;

  return (
    <div>
      <div className="row">
        <h1>Repertoire</h1>
        <div className="spacer" />
        <button className="button primary" onClick={() => setPicking(true)}>
          + Add chord
        </button>
      </div>

      <h2>Chords</h2>
      {repertoire.length === 0 ? (
        <div className="card">
          <p>No chords yet. Click <strong>Add chord</strong> above, or start a <Link to="/routine/new">New chord</Link> routine.</p>
        </div>
      ) : (
        <div className="grid">
          {repertoire.map(c => (
            <ChordCard
              key={c.id}
              chord={c}
              footer={`${c.perfectReps} reps · added ${timeAgo(c.learnedAt)}`}
              onClick={() => setDetailId(c.id)}
            />
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 20 }}>Chord swap pairs</h2>
      {trainedPairs.length === 0 ? (
        <div className="card">
          <p className="muted">No pairs trained yet. <Link to="/routine/swap">Start a swap routine</Link> to record your first.</p>
        </div>
      ) : (
        <div className="card">
          <table className="matrix" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Best</th>
                <th>Last</th>
                <th>Attempts</th>
                <th>Trend</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trainedPairs.map(r => (
                <tr key={r.pairKey}>
                  <th>{(names.get(r.chordA) ?? r.chordA)} ↔ {(names.get(r.chordB) ?? r.chordB)}</th>
                  <td>{r.bestCount}</td>
                  <td>{r.lastCount}</td>
                  <td>{r.attempts}</td>
                  <td><Sparkline history={r.history} small /></td>
                  <td>
                    <Link to="/routine/swap" className="button">Train</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picking && (
        <div className="modal-backdrop" onClick={() => setPicking(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="row">
              <h2>Pick a chord to learn</h2>
              <div className="spacer" />
              <button className="button" onClick={() => setPicking(false)}>Close</button>
            </div>
            {available.length === 0 ? (
              <p className="muted">You've added every chord in the library. Nice.</p>
            ) : (
              <LibraryChordGrid chords={available} onPick={addChord} />
            )}
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-backdrop" onClick={() => { setDetailId(null); setEditing(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="row">
              <h2>{detail.name}</h2>
              <button
                className="button"
                onClick={() => setEditing(v => !v)}
                title="Edit this chord"
                style={{ marginLeft: 6 }}
              >
                ✏️ {editing ? 'Cancel edit' : 'Edit'}
              </button>
              <div className="spacer" />
              <button className="button" onClick={() => { setDetailId(null); setEditing(false); }}>Close</button>
            </div>
            {editing ? (
              <ChordEditor
                title={`Edit ${detail.name}`}
                initialName={detail.name}
                initialShape={detail.shape}
                saveLabel="Save changes"
                onSave={saveEdit}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <ChordDiagram shape={detail.shape} size={200} />
                  <div className="col">
                    <div><strong>Perfection reps:</strong> {detail.perfectReps}</div>
                    <div><strong>Added:</strong> {new Date(detail.learnedAt).toLocaleDateString()}</div>
                    <SwapRelatedRecords chordId={detail.id} swaps={swaps} names={names} />
                  </div>
                </div>
                <div className="footer-bar">
                  <Link to={`/routine/quiz?chord=${encodeURIComponent(detail.id)}`} className="button primary">Quiz me on {detail.name}</Link>
                  <div className="spacer" />
                  <button className="button danger" onClick={() => removeChord(detail.id)}>Remove from repertoire</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SwapRelatedRecords({ chordId, swaps, names }: {
  chordId: string;
  swaps: Record<string, SwapRecord>;
  names: Map<string, string>;
}) {
  const related = Object.values(swaps).filter(
    s => s.chordA === chordId || s.chordB === chordId
  ).sort((a, b) => b.bestCount - a.bestCount);
  if (related.length === 0) return <div className="muted">No swap records yet.</div>;
  return (
    <div>
      <h3>Swap records</h3>
      <ul style={{ paddingLeft: 18 }}>
        {related.map(r => {
          const otherId = r.chordA === chordId ? r.chordB : r.chordA;
          const other = names.get(otherId) ?? otherId;
          return <li key={r.pairKey}>{names.get(chordId) ?? chordId} ↔ {other}: <strong>{r.bestCount}</strong> best · {r.lastCount} last</li>;
        })}
      </ul>
    </div>
  );
}

function timeAgo(t: number): string {
  const d = Date.now() - t;
  const day = 24 * 3600 * 1000;
  if (d < day) return 'today';
  if (d < 2 * day) return 'yesterday';
  return `${Math.floor(d / day)}d ago`;
}
