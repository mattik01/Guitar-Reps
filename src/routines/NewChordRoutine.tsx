import { useMemo, useState } from 'react';
import { IconRandom } from '../components/icons';
import { EditButton } from '../components/EditButton';
import { Link } from 'react-router-dom';
import { ChordCard } from '../components/ChordCard';
import { ChordEditor } from '../components/ChordEditor';
import { RoutineHeader } from '../components/RoutineHeader';
import { LibraryChordGrid } from '../components/LibraryChordGrid';
import { CHORD_LIBRARY, materializeLibraryChord } from '../data/chordLibrary';
import { cardFromChord } from '../data/chordResolve';
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
        <RoutineHeader
          title={`Added: ${justAdded.name}`}
          backLabel="Exercise"
          backTo="/exercise"
          stats={
            <EditButton onClick={() => setEditing(v => !v)} active={editing}
              title={editing ? 'Close the editor' : 'Edit this shape'} label="Edit shape" />
          }
        />
        {editing ? (
          <ChordEditor
            title={`Edit ${justAdded.name}`}
            calibratedChordId={justAdded.id}
            initialName={justAdded.name}
            initialShape={justAdded.shape}
            saveLabel="Save changes"
            onSave={saveEdit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="card stage">
            <div className="step-title">Place your fingers and strum it a few times</div>
            {/* The header already names the chord. */}
            <ChordCard variant="bare" size="xl" chord={cardFromChord(justAdded)} showName={false} />
            <div className="stage-actions">
              <Link to={`/routine/quiz?chord=${encodeURIComponent(justAdded.id)}`} className="button primary big">
                Quiz me on it
              </Link>
              <button className="button big" onClick={() => setJustAdded(null)}>Add another</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <RoutineHeader
        title="Learn a new chord"
        backLabel="Exercise"
        backTo="/exercise"
        stats={<>{available.length} in library · {repertoire.length} yours</>}
      />

      <div className="card">
        <div className="row">
          <button className="button primary" onClick={addRandomFromLibrary} disabled={available.length === 0}>
            <IconRandom /> Random chord
          </button>
          <button className="button" onClick={() => setCustomOpen(v => !v)}>
            {customOpen ? 'Close custom' : '+ Custom chord'}
          </button>
        </div>
      </div>

      {customOpen && (
        <ChordEditor withCategory onSave={addCustom} onCancel={() => setCustomOpen(false)} saveLabel="Save to repertoire" />
      )}

      <div className="row section-head" style={{ marginTop: 'var(--s5)' }}>
        <h2>Pick one from the library</h2>
      </div>
      {available.length === 0 ? (
        <p className="muted">You've added every chord in the library. Add a custom one to expand.</p>
      ) : (
        <LibraryChordGrid chords={available} onPick={addFromLibrary} />
      )}
    </div>
  );
}
