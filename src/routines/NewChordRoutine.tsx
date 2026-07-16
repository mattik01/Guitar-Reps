import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChordDiagram } from '../components/ChordDiagram';
import { ChordEditor } from '../components/ChordEditor';
import { LibraryChordGrid } from '../components/LibraryChordGrid';
import { CHORD_LIBRARY, materializeLibraryChord } from '../data/chordLibrary';
import type { ChordCategoryId } from '../data/chordCategories';
import { useFingeringChoice, useRepertoire, type Chord, type ChordShape } from '../state/store';

export default function NewChordRoutine() {
  const [repertoire, setRepertoire] = useRepertoire();
  const [fingeringChoice] = useFingeringChoice();
  const [justAdded, setJustAdded] = useState<Chord | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const owned = useMemo(() => new Set(repertoire.map(c => c.id)), [repertoire]);
  const available = useMemo(
    () => CHORD_LIBRARY.filter(c => !owned.has(c.id))
      .sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0)),
    [owned]
  );

  function addFromLibrary(id: string) {
    const chord = materializeLibraryChord(id, fingeringChoice[id] ?? 0);
    if (!chord) return;
    setRepertoire(prev => [...prev, chord]);
    setJustAdded(chord);
    setCustomOpen(false);
    setEditing(false);
  }

  function addRandomFromLibrary() {
    if (available.length === 0) return;
    addFromLibrary(available[Math.floor(Math.random() * available.length)].id);
  }

  function addCustom(value: { name: string; shape: ChordShape; category?: ChordCategoryId }) {
    let id = value.name;
    if (owned.has(id)) id = `${value.name}-${Date.now().toString(36)}`;
    const chord: Chord = {
      id, name: value.name, shape: value.shape, category: value.category ?? 'other',
      learnedAt: Date.now(), perfectReps: 0,
    };
    setRepertoire(prev => [...prev, chord]);
    setJustAdded(chord);
    setCustomOpen(false);
    setEditing(false);
  }

  function saveEdit(value: { name: string; shape: ChordShape }) {
    if (!justAdded) return;
    setRepertoire(prev => prev.map(c =>
      c.id === justAdded.id ? { ...c, name: value.name, shape: value.shape } : c
    ));
    setJustAdded({ ...justAdded, name: value.name, shape: value.shape });
    setEditing(false);
  }

  if (justAdded) {
    return (
      <div>
        <div className="row">
          <Link to="/" className="button">← Home</Link>
          <h1 style={{ margin: 0 }}>Added: {justAdded.name}</h1>
          <div className="spacer" />
          <button className="button" onClick={() => setEditing(v => !v)}>
            ✏️ {editing ? 'Close editor' : 'Edit'}
          </button>
        </div>
        {editing ? (
          <ChordEditor
            title={`Edit ${justAdded.name}`}
            initialName={justAdded.name}
            initialShape={justAdded.shape}
            saveLabel="Save changes"
            onSave={saveEdit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="card" style={{ textAlign: 'center' }}>
            <p>Take a minute to look at the shape, place your fingers, and strum it a few times.</p>
            <div style={{ margin: '16px 0' }}>
              <ChordDiagram shape={justAdded.shape} size={260} />
            </div>
            <div className="footer-bar" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to={`/routine/quiz?chord=${encodeURIComponent(justAdded.id)}`} className="button primary big">
                Quiz me on it
              </Link>
              <button className="button big" onClick={() => setJustAdded(null)}>
                Add another
              </button>
              <Link to="/" className="button">Home</Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="row">
        <Link to="/" className="button">← Home</Link>
        <h1 style={{ margin: 0 }}>Learn a new chord</h1>
      </div>

      <div className="card">
        <div className="row">
          <button className="button primary big" onClick={addRandomFromLibrary} disabled={available.length === 0}>
            🎲 Surprise me — random from library
          </button>
          <button className="button big" onClick={() => setCustomOpen(v => !v)}>
            {customOpen ? 'Close custom' : '+ Add custom chord'}
          </button>
          <div className="spacer" />
          <div className="muted">{available.length} in library, {repertoire.length} in repertoire</div>
        </div>
      </div>

      {customOpen && (
        <ChordEditor withCategory onSave={addCustom} onCancel={() => setCustomOpen(false)} saveLabel="Save to repertoire" />
      )}

      <h2 style={{ marginTop: 20 }}>Pick one from the library</h2>
      {available.length === 0 ? (
        <p className="muted">You've added every chord in the library. Add a custom one to expand.</p>
      ) : (
        <LibraryChordGrid chords={available} onPick={addFromLibrary} />
      )}
    </div>
  );
}
