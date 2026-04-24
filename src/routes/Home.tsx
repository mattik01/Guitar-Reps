import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { dayKey, useRepertoire, useRoutineLog, useSwapRecords, type RoutineKind, type RoutineLog } from '../state/store';

const KIND_COLOR: Record<RoutineKind, string> = {
  chord: '#2b5bd7',
  swap: '#2e8b57',
  strum: '#c0690b',
};

export default function Home() {
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();
  const [log] = useRoutineLog();

  const todayKey = dayKey(Date.now());
  const todayCount = log.filter(l => dayKey(l.at) === todayKey).length;
  const bestSwap = Object.values(swaps).sort((a, b) => b.bestCount - a.bestCount)[0];
  const days = useMemo(() => buildWeek(log, 7), [log]);

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
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gap: 6, marginTop: 10 }}>
          {days.map(d => {
            const byKind: Record<RoutineKind, number> = { chord: 0, swap: 0, strum: 0 };
            for (const e of d.entries) byKind[e.kind]++;
            const isToday = d.key === todayKey;
            const weekday = d.date.toLocaleDateString(undefined, { weekday: 'short' });
            return (
              <div key={d.key} style={{
                border: `1px solid ${isToday ? 'var(--ink)' : 'var(--line)'}`,
                borderRadius: 10,
                padding: 6,
                minHeight: 74,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                background: 'var(--panel)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{weekday}</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{d.date.getDate()}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 'auto' }}>
                  {(['chord', 'swap', 'strum'] as RoutineKind[]).flatMap(k =>
                    Array.from({ length: byKind[k] }).map((_, i) => (
                      <div key={`${k}-${i}`} style={{ width: 8, height: 8, borderRadius: '50%', background: KIND_COLOR[k] }} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
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

type DayCell = { key: string; date: Date; entries: RoutineLog[] };

function buildWeek(log: RoutineLog[], numDays: number): DayCell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cells: DayCell[] = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    cells.push({ key: dayKey(d.getTime()), date: d, entries: [] });
  }
  const byKey = new Map(cells.map(c => [c.key, c]));
  for (const l of log) {
    const k = dayKey(l.at);
    byKey.get(k)?.entries.push(l);
  }
  return cells;
}
