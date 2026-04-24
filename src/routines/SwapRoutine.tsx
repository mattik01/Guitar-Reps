import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChordDiagram } from '../components/ChordDiagram';
import { Timer, type TimerHandle } from '../components/Timer';
import { pairKey, useRepertoire, useRoutineLog, useSwapRecords, type Chord, type SwapRecord } from '../state/store';

type Phase = 'picking' | 'ready' | 'running' | 'entering' | 'finished';

const MAX_HISTORY = 20;

export default function SwapRoutine() {
  const [repertoire] = useRepertoire();
  const [swaps, setSwaps] = useSwapRecords();
  const [, setLog] = useRoutineLog();

  const [pair, setPair] = useState<[Chord, Chord] | null>(null);
  const [phase, setPhase] = useState<Phase>('picking');
  const [seconds, setSeconds] = useState(60);
  const [entered, setEntered] = useState('');
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [priorBest, setPriorBest] = useState<number | null>(null);
  const [flashing, setFlashing] = useState(false);
  const timerRef = useRef<TimerHandle>(null);
  const flashTimeoutRef = useRef<number | null>(null);
  const beepCtxRef = useRef<AudioContext | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const key = pair ? pairKey(pair[0].id, pair[1].id) : null;
  const record = key ? swaps[key] : null;

  const notEnough = repertoire.length < 2;

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
      beepCtxRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (phase === 'entering') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [phase]);

  function pickRandom() {
    if (notEnough) return;
    setPair(randomPair(repertoire));
    setPhase('ready');
    resetRoundState();
  }

  function pickManual(aId: string, bId: string) {
    if (aId === bId) return;
    const a = repertoire.find(c => c.id === aId);
    const b = repertoire.find(c => c.id === bId);
    if (!a || !b) return;
    setPair([a, b]);
    setPhase('ready');
    resetRoundState();
  }

  function resetRoundState() {
    setEntered('');
    setSavedCount(null);
    setPriorBest(null);
    setFlashing(false);
  }

  function start() {
    if (!pair) return;
    setPriorBest(record?.bestCount ?? null);
    setPhase('running');
    setEntered('');
    setSavedCount(null);
    setTimeout(() => timerRef.current?.start(), 0);
  }

  function onTimerComplete() {
    setFlashing(true);
    playEndBeeps();
    if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setFlashing(false), 1600);
    setPhase('entering');
  }

  function playEndBeeps() {
    try {
      beepCtxRef.current = beepCtxRef.current ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ctx = beepCtxRef.current;
      [0, 0.25, 0.5].forEach(offset => {
        const t = ctx.currentTime + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 1200;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      });
    } catch { /* ignore — audio might be blocked */ }
  }

  function saveCount() {
    if (!pair || !key) return;
    const n = parseInt(entered, 10);
    if (!Number.isFinite(n) || n < 0) return;
    const now = Date.now();
    const [aSorted, bSorted] = [pair[0].id, pair[1].id].sort();
    setSwaps(prev => {
      const existing = prev[key];
      const history = [...(existing?.history ?? []), { count: n, at: now }].slice(-MAX_HISTORY);
      const next: SwapRecord = existing
        ? {
            ...existing,
            lastCount: n,
            bestCount: Math.max(existing.bestCount, n),
            attempts: existing.attempts + 1,
            lastAt: now,
            history,
          }
        : {
            pairKey: key,
            chordA: aSorted,
            chordB: bSorted,
            bestCount: n,
            lastCount: n,
            attempts: 1,
            lastAt: now,
            history: [{ count: n, at: now }],
          };
      return { ...prev, [key]: next };
    });
    setLog(prev => [...prev, { at: now, kind: 'swap', pairKey: key, swapCount: n }]);
    setSavedCount(n);
    setPhase('finished');
  }

  function cancelBackToPicker() {
    setPair(null);
    setPhase('picking');
    resetRoundState();
    timerRef.current?.reset();
  }

  function againSame() {
    setPhase('ready');
    resetRoundState();
    timerRef.current?.reset();
  }

  if (notEnough) {
    return (
      <div>
        <div className="row">
          <Link to="/" className="button">← Home</Link>
          <h1 style={{ margin: 0 }}>Chord swap routine</h1>
        </div>
        <div className="card">
          <p>You need at least 2 chords in your repertoire to run this routine.</p>
          <Link to="/routine/chord" className="button primary">Go learn some chords</Link>
        </div>
      </div>
    );
  }

  if (phase === 'picking' || !pair) {
    return (
      <div>
        <div className="row">
          <Link to="/" className="button">← Home</Link>
          <h1 style={{ margin: 0 }}>Chord swap routine</h1>
        </div>
        <p className="muted">Pick two chords. You'll have <strong>{seconds}s</strong> to swap between them — count in your head, type the number after.</p>

        <div className="card">
          <div className="row">
            <button className="button primary big" onClick={pickRandom}>🎲 Random pair</button>
            <label className="toggle">
              Timer (s)
              <input type="number" min={15} max={300} step={5} value={seconds}
                onChange={e => setSeconds(Math.max(15, Math.min(300, parseInt(e.target.value || '60', 10))))}
                style={{ width: 70 }}
              />
            </label>
          </div>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />
          <ManualPicker repertoire={repertoire} swaps={swaps} onPick={pickManual} />
        </div>

        <TrainedPairsList swaps={swaps} repertoire={repertoire} onPick={(a, b) => pickManual(a, b)} />
      </div>
    );
  }

  const [a, b] = pair;

  return (
    <div className={flashing ? 'flash-done' : ''} style={{ transition: 'background 0.1s' }}>
      <div className="row">
        <button className="button" onClick={cancelBackToPicker}>← Pick different pair</button>
        <h1 style={{ margin: 0 }}>{a.name} ↔ {b.name}</h1>
        <div className="spacer" />
        <div className="muted">
          Best: <strong>{record?.bestCount ?? '—'}</strong> · Last: <strong>{record?.lastCount ?? '—'}</strong> · Attempts: <strong>{record?.attempts ?? 0}</strong>
        </div>
      </div>

      <div className="pair">
        <div className="card" style={{ alignItems: 'center', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{a.name}</div>
          <ChordDiagram shape={a.shape} size={200} />
        </div>
        <div className="card" style={{ alignItems: 'center', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{b.name}</div>
          <ChordDiagram shape={b.shape} size={200} />
        </div>
      </div>

      <Timer ref={timerRef} seconds={seconds} onComplete={onTimerComplete} />

      {phase === 'ready' && (
        <div className="footer-bar">
          <button className="button primary huge" onClick={start}>Start {seconds}s</button>
        </div>
      )}

      {phase === 'running' && (
        <div className="card" style={{ marginTop: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Swap between the two chords — count in your head.</div>
          <div className="muted" style={{ marginTop: 6 }}>Screen will flash when the minute is up.</div>
        </div>
      )}

      {phase === 'entering' && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2 style={{ marginTop: 0, textAlign: 'center' }}>Time's up — how many did you count?</h2>
          <input
            ref={inputRef}
            className="big-number-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={500}
            value={entered}
            onChange={e => setEntered(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveCount(); }}
            placeholder="0"
          />
          <div className="footer-bar">
            <button className="button primary huge" onClick={saveCount} disabled={entered === '' || !Number.isFinite(parseInt(entered, 10))}>
              Save
            </button>
          </div>
        </div>
      )}

      {phase === 'finished' && savedCount != null && (
        <>
          <div style={{ textAlign: 'center', fontSize: 26, fontWeight: 800, margin: '10px 0' }}>
            {savedCount} swaps{priorBest == null || savedCount > priorBest ? ' — new record 🎉' : ''}
          </div>
          {record && record.history.length > 1 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3>History for this pair</h3>
              <Sparkline history={record.history} />
              <div className="muted">Showing last {record.history.length} attempts · best <strong>{record.bestCount}</strong></div>
            </div>
          )}
          <div className="footer-bar">
            <button className="button" onClick={againSame}>Again — same pair</button>
            <button className="button" onClick={() => { setPair(randomPair(repertoire)); setPhase('ready'); resetRoundState(); timerRef.current?.reset(); }}>
              Different random pair
            </button>
            <div className="spacer" />
            <button className="button" onClick={cancelBackToPicker}>Pick different</button>
            <Link to="/" className="button primary">Home</Link>
          </div>
        </>
      )}
    </div>
  );
}

function ManualPicker({ repertoire, swaps, onPick }: {
  repertoire: Chord[];
  swaps: Record<string, SwapRecord>;
  onPick: (a: string, b: string) => void;
}) {
  const [a, setA] = useState(repertoire[0]?.id ?? '');
  const [b, setB] = useState(repertoire[1]?.id ?? '');
  const key = a && b ? pairKey(a, b) : '';
  const rec = key ? swaps[key] : null;

  return (
    <div className="row">
      <label>
        Chord A
        <select value={a} onChange={e => setA(e.target.value)} style={{ marginLeft: 6 }}>
          {repertoire.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>
        Chord B
        <select value={b} onChange={e => setB(e.target.value)} style={{ marginLeft: 6 }}>
          {repertoire.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="muted">
        {rec ? `Best ${rec.bestCount} · Last ${rec.lastCount} · ${rec.attempts}×` : 'Never tried'}
      </div>
      <div className="spacer" />
      <button className="button primary" disabled={!a || !b || a === b} onClick={() => onPick(a, b)}>
        Use this pair
      </button>
    </div>
  );
}

function TrainedPairsList({ swaps, repertoire, onPick }: {
  swaps: Record<string, SwapRecord>;
  repertoire: Chord[];
  onPick: (a: string, b: string) => void;
}) {
  const names = useMemo(() => new Map(repertoire.map(c => [c.id, c.name])), [repertoire]);
  const list = Object.values(swaps).sort((x, y) => y.lastAt - x.lastAt);
  if (list.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Pairs you've trained</h3>
      <div className="col">
        {list.map(r => (
          <div key={r.pairKey} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <div style={{ fontWeight: 700 }}>
              {names.get(r.chordA) ?? r.chordA} ↔ {names.get(r.chordB) ?? r.chordB}
            </div>
            <div className="muted">best {r.bestCount} · last {r.lastCount} · {r.attempts}×</div>
            <div style={{ minWidth: 120 }}>
              <Sparkline history={r.history} small />
            </div>
            <div className="spacer" />
            <button className="button" onClick={() => onPick(r.chordA, r.chordB)}>Train</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ history, small = false }: { history: { count: number; at: number }[]; small?: boolean }) {
  if (history.length === 0) return null;
  const max = Math.max(...history.map(h => h.count), 1);
  const h = small ? 24 : 48;
  const barW = small ? 8 : 14;
  const gap = 2;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap, height: h }}>
      {history.map((item, i) => {
        const isLast = i === history.length - 1;
        const isBest = item.count === max;
        return (
          <div key={i}
            title={`${item.count} on ${new Date(item.at).toLocaleString()}`}
            style={{
              width: barW,
              height: Math.max(3, (item.count / max) * h),
              background: isBest ? 'var(--good)' : isLast ? 'var(--accent)' : 'var(--ink)',
              borderRadius: 2,
            }}
          />
        );
      })}
    </div>
  );
}

function randomPair(repertoire: Chord[]): [Chord, Chord] {
  const i = Math.floor(Math.random() * repertoire.length);
  let j = Math.floor(Math.random() * repertoire.length);
  while (j === i) j = Math.floor(Math.random() * repertoire.length);
  return [repertoire[i], repertoire[j]];
}
