import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChordDiagram } from '../components/ChordDiagram';
import { PATTERNS, PROGRESSIONS } from '../data/progressions';
import { useRepertoire, useRoutineLog } from '../state/store';

export default function StrumRoutine() {
  const [repertoire] = useRepertoire();
  const [, setLog] = useRoutineLog();
  const [progressionId, setProgressionId] = useState(PROGRESSIONS[0].id);
  const [patternId, setPatternId] = useState(PATTERNS[1].id);
  const [bpm, setBpm] = useState(80);
  const [barsPerChord, setBarsPerChord] = useState(2);
  const [running, setRunning] = useState(false);
  const [slot, setSlot] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const progression = PROGRESSIONS.find(p => p.id === progressionId)!;
  const pattern = PATTERNS.find(p => p.id === patternId)!;

  const chordsInProgression = useMemo(() => {
    return progression.chordIds
      .map(id => repertoire.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c != null);
  }, [progression, repertoire]);

  const missingChords = progression.chordIds.filter(id => !repertoire.some(r => r.id === id));

  const patternChars = useMemo(() => {
    const p = pattern.pattern.padEnd(8, '-').slice(0, 8);
    return p.split('');
  }, [pattern]);

  const slotsPerBar = 8;
  const slotsPerChord = slotsPerBar * barsPerChord;
  const currentChordIdx = chordsInProgression.length > 0
    ? Math.floor(slot / slotsPerChord) % chordsInProgression.length
    : 0;
  const currentChord = chordsInProgression[currentChordIdx];
  const slotInBar = slot % slotsPerBar;

  useEffect(() => {
    if (!running) return;
    const slotMs = 30_000 / bpm;
    ctxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    let s = 0;
    const playClick = (accent: boolean) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = accent ? 1100 : 800;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.28, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    };
    const tick = () => {
      setSlot(s);
      if (s % 2 === 0) playClick(s % slotsPerBar === 0);
      s++;
    };
    tick();
    const id = setInterval(tick, slotMs);
    return () => {
      clearInterval(id);
      ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [running, bpm]);

  function start() {
    setStartedAt(Date.now());
    setSlot(0);
    setRunning(true);
  }

  function stop() {
    setRunning(false);
  }

  function finish() {
    if (startedAt) {
      setLog(prev => [...prev, {
        at: startedAt,
        kind: 'strum',
        progressionId,
        durationMs: Date.now() - startedAt,
      }]);
    }
    setStartedAt(null);
    setRunning(false);
    setSlot(0);
  }

  return (
    <div>
      <div className="row">
        <Link to="/" className="button">← Home</Link>
        <h1 style={{ margin: 0 }}>Strumming routine</h1>
      </div>

      <div className="card">
        <div className="row">
          <label>Progression
            <select value={progressionId} onChange={e => setProgressionId(e.target.value)} style={{ marginLeft: 8 }}>
              {PROGRESSIONS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Pattern
            <select value={patternId} onChange={e => setPatternId(e.target.value)} style={{ marginLeft: 8 }}>
              {PATTERNS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>BPM
            <input type="number" min={40} max={200} value={bpm}
              onChange={e => setBpm(Math.max(40, Math.min(200, parseInt(e.target.value || '80', 10))))}
              style={{ marginLeft: 8, width: 70 }} />
          </label>
          <label>Bars/chord
            <input type="number" min={1} max={8} value={barsPerChord}
              onChange={e => setBarsPerChord(Math.max(1, Math.min(8, parseInt(e.target.value || '2', 10))))}
              style={{ marginLeft: 8, width: 60 }} />
          </label>
        </div>

        {missingChords.length > 0 && (
          <p className="muted">
            Not in your repertoire yet: <strong>{missingChords.join(', ')}</strong>. These bars will be skipped.
          </p>
        )}

        {chordsInProgression.length === 0 ? (
          <p className="muted">You don't know any of these chords yet. Pick a different progression or add chords to your repertoire.</p>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'center', margin: '16px 0' }}>
              {currentChord && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800 }}>{currentChord.name}</div>
                  <ChordDiagram shape={currentChord.shape} size={200} />
                  <div className="muted">
                    Next: {chordsInProgression[(currentChordIdx + 1) % chordsInProgression.length]?.name}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, fontFamily: 'monospace', fontSize: 24, margin: '12px 0' }}>
              {patternChars.map((ch, i) => (
                <span key={i} style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: i === slotInBar && running ? 'var(--ink)' : 'transparent',
                  color: i === slotInBar && running ? '#fff' : ch === '-' ? 'var(--muted)' : 'var(--ink)',
                  minWidth: 28,
                  textAlign: 'center',
                  fontWeight: 700,
                }}>
                  {ch}
                </span>
              ))}
            </div>
          </>
        )}

        <div className="footer-bar">
          {running ? (
            <button className="button big" onClick={stop}>Pause</button>
          ) : (
            <button className="button primary big" onClick={start} disabled={chordsInProgression.length === 0}>
              {startedAt ? 'Resume' : 'Start'}
            </button>
          )}
          <button className="button primary" onClick={finish} disabled={!startedAt}>
            Finish — log this
          </button>
          <div className="spacer" />
          <Link to="/" className="button">Cancel</Link>
        </div>
      </div>
    </div>
  );
}
