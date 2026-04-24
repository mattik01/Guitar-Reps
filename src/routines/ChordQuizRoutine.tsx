import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChordDiagram } from '../components/ChordDiagram';
import { ChordEditor } from '../components/ChordEditor';
import { useRepertoire, useRoutineLog, type Chord, type ChordShape } from '../state/store';

type Phase = 'picking' | 'asking' | 'revealed';

export default function ChordQuizRoutine() {
  const [repertoire, setRepertoire] = useRepertoire();
  const [, setLog] = useRoutineLog();
  const [params] = useSearchParams();

  const [chord, setChord] = useState<Chord | null>(null);
  const [phase, setPhase] = useState<Phase>('picking');
  const [asked, setAsked] = useState(0);
  const [gotRight, setGotRight] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const presetId = params.get('chord');
    if (presetId && phase === 'picking') {
      const c = repertoire.find(r => r.id === presetId);
      if (c) ask(c);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const otherChords = useMemo(() => {
    return repertoire.filter(c => c.id !== chord?.id);
  }, [repertoire, chord]);

  function ask(c: Chord) {
    setChord(c);
    setPhase('asking');
    setAsked(a => a + 1);
    if (!startedAt) setStartedAt(Date.now());
  }

  function askRandom() {
    const pool = chord ? otherChords : repertoire;
    if (pool.length === 0) {
      if (repertoire.length === 0) return;
      ask(repertoire[Math.floor(Math.random() * repertoire.length)]);
      return;
    }
    ask(pool[Math.floor(Math.random() * pool.length)]);
  }

  function reveal() {
    setPhase('revealed');
    setEditing(false);
  }

  function saveEdit(value: { name: string; shape: ChordShape }) {
    if (!chord) return;
    setRepertoire(prev => prev.map(c =>
      c.id === chord.id ? { ...c, name: value.name, shape: value.shape } : c
    ));
    setChord({ ...chord, name: value.name, shape: value.shape });
    setEditing(false);
  }

  function gotIt() {
    if (chord) {
      setRepertoire(prev => prev.map(c =>
        c.id === chord.id ? { ...c, perfectReps: c.perfectReps + 1 } : c
      ));
    }
    setGotRight(g => g + 1);
    askRandom();
  }

  function didNot() {
    askRandom();
  }

  function finish() {
    if (startedAt && asked > 0) {
      setLog(prev => [...prev, {
        at: startedAt,
        kind: 'chord',
        perfectReps: gotRight,
        durationMs: Date.now() - startedAt,
      }]);
    }
    setChord(null);
    setPhase('picking');
    setAsked(0);
    setGotRight(0);
    setStartedAt(null);
  }

  if (repertoire.length === 0) {
    return (
      <div>
        <div className="row">
          <Link to="/" className="button">← Home</Link>
          <h1 style={{ margin: 0 }}>Chord quiz</h1>
        </div>
        <div className="card">
          <p>Your repertoire is empty. Add a chord first.</p>
          <Link to="/routine/new" className="button primary">Learn a new chord</Link>
        </div>
      </div>
    );
  }

  if (phase === 'picking') {
    return (
      <div>
        <div className="row">
          <Link to="/" className="button">← Home</Link>
          <h1 style={{ margin: 0 }}>Chord quiz</h1>
        </div>
        <p className="muted">
          You'll see a chord name. Try to play it from memory, then reveal the diagram to check.
        </p>

        <div className="card">
          <div className="row">
            <button className="button primary huge" onClick={askRandom}>
              🎲 Start — random chord
            </button>
          </div>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />
          <h3>Or pick a specific chord</h3>
          <div className="grid">
            {repertoire.map(c => (
              <div key={c.id} className="chord-card" onClick={() => ask(c)} style={{ cursor: 'pointer' }}>
                <div className="name">{c.name}</div>
                <div className="meta">{c.perfectReps} reps</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!chord) return null;

  return (
    <div>
      <div className="row">
        <button className="button" onClick={finish}>← Finish</button>
        <h1 style={{ margin: 0 }}>Chord quiz</h1>
        <div className="spacer" />
        <div className="muted">
          Asked <strong>{asked}</strong> · Got <strong>{gotRight}</strong>
        </div>
      </div>

      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <div className="muted" style={{ marginBottom: 10 }}>Play this chord:</div>
        <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 1 }}>{chord.name}</div>

        {phase === 'asking' ? (
          <>
            <p className="muted" style={{ marginTop: 20 }}>
              Place your fingers, strum, check every string. Reveal when you're ready.
            </p>
            <div className="footer-bar" style={{ justifyContent: 'center' }}>
              <button className="button primary huge" onClick={reveal} style={{ maxWidth: 420 }}>
                Reveal diagram
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ margin: '24px 0', position: 'relative' }}>
              <ChordDiagram shape={chord.shape} size={240} />
              <button
                className="button"
                onClick={() => setEditing(v => !v)}
                style={{ position: 'absolute', top: 0, right: 0 }}
                title="Edit this chord"
              >
                ✏️ Edit
              </button>
            </div>
            {!editing && (
              <div className="footer-bar" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="button primary big" onClick={gotIt}>✓ Got it — next</button>
                <button className="button big" onClick={didNot}>✗ Didn't know — next</button>
              </div>
            )}
          </>
        )}
      </div>

      {editing && phase === 'revealed' && (
        <ChordEditor
          title={`Edit ${chord.name}`}
          initialName={chord.name}
          initialShape={chord.shape}
          saveLabel="Save changes"
          onSave={saveEdit}
          onCancel={() => setEditing(false)}
        />
      )}

      <div className="footer-bar">
        <div className="spacer" />
        <button className="button" onClick={finish}>Finish and log</button>
      </div>
    </div>
  );
}
