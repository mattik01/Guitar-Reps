import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { dayKey, useRepertoire, useRoutineLog, useSwapRecords } from '../state/store';
import { DayActivityGrid, buildDayCells } from '../components/DayActivityGrid';

export default function Home() {
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();
  const [log] = useRoutineLog();

  const todayKey = dayKey(Date.now());
  const todayCount = log.filter(l => dayKey(l.at) === todayKey).length;
  const bestSwap = Object.values(swaps).sort((a, b) => b.bestCount - a.bestCount)[0];
  const days = useMemo(() => buildDayCells(log, 7), [log]);

  const canSwap = repertoire.length >= 2;

  return (
    <div>
      <h1>Guitar Reps</h1>
      <p className="muted">Pick a routine — stack as many as you want today.</p>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Link to="/routine/quiz" className="card" style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center', opacity: repertoire.length === 0 ? 0.55 : 1 }}>
          <div style={{ fontSize: 40 }}>❓</div>
          <h2 style={{ margin: '4px 0' }}>Quiz</h2>
          <div className="muted">
            {repertoire.length === 0 ? 'Add a chord first' : 'Name only — you play, then reveal'}
          </div>
        </Link>
        <Link to="/routine/new" className="card" style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>➕</div>
          <h2 style={{ margin: '4px 0' }}>New chord</h2>
          <div className="muted">From the library, random, or custom</div>
        </Link>
        <Link to={canSwap ? '/routine/swap' : '/routine/new'}
          className="card"
          style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center', opacity: canSwap ? 1 : 0.55 }}>
          <div style={{ fontSize: 40 }}>🔁</div>
          <h2 style={{ margin: '4px 0' }}>Chord swap</h2>
          <div className="muted">
            {canSwap ? '1-minute drill between two chords' : 'Add 2+ chords first'}
          </div>
        </Link>
        <Link to="/routine/strum" className="card" style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>🎶</div>
          <h2 style={{ margin: '4px 0' }}>Strumming</h2>
          <div className="muted">Metronome + progression practice</div>
        </Link>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row">
          <h3 style={{ margin: 0 }}>This week</h3>
          <div className="spacer" />
          <Link to="/progress" className="button">Full progress</Link>
        </div>
        <div style={{ marginTop: 10 }}>
          <DayActivityGrid days={days} compact />
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <div className="muted">
          {repertoire.length} chord{repertoire.length === 1 ? '' : 's'} in repertoire ·
          {' '}{todayCount} routine{todayCount === 1 ? '' : 's'} today
          {bestSwap && <> · Best swap: {bestSwap.chordA} ↔ {bestSwap.chordB} ({bestSwap.bestCount})</>}
        </div>
      </div>
    </div>
  );
}
