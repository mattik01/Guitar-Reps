import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Sparkline } from '../routines/SwapRoutine';
import { useRepertoire, useRoutineLog, useSwapRecords, type RoutineLog } from '../state/store';
import { DayActivityGrid, buildDayCells, KIND_COLOR, KIND_LABEL, ROUTINE_KINDS } from '../components/DayActivityGrid';

export default function Progress() {
  const [log] = useRoutineLog();
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();

  const days = useMemo(() => buildDayCells(log, 7), [log]);
  const recent = useMemo(() => [...log].sort((a, b) => b.at - a.at).slice(0, 15), [log]);
  const names = useMemo(() => new Map(repertoire.map(c => [c.id, c.name])), [repertoire]);

  return (
    <div>
      <h1>Progress</h1>

      <div className="card">
        <h3>This week</h3>
        <DayActivityGrid days={days} />
        <div className="row" style={{ marginTop: 10, fontSize: 13 }}>
          {ROUTINE_KINDS.map(k => (
            <span key={k} className="row" style={{ gap: 6 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>Recent activity</h3>
        {recent.length === 0 ? (
          <p className="muted">No routines logged yet.</p>
        ) : (
          <table className="matrix">
            <thead>
              <tr><th>When</th><th>Routine</th><th>Details</th></tr>
            </thead>
            <tbody>
              {recent.map((l, i) => (
                <tr key={i}>
                  <td>{new Date(l.at).toLocaleString()}</td>
                  <td>
                    <span style={{
                      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                      background: KIND_COLOR[l.kind], marginRight: 6,
                    }} />
                    {KIND_LABEL[l.kind]}
                  </td>
                  <td>{describeLog(l, names)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>Chord-swap pairs</h3>
        {Object.values(swaps).length === 0 ? (
          <p className="muted">No pairs trained yet. <Link to="/routine/swap">Run a swap routine</Link>.</p>
        ) : (
          <table className="matrix">
            <thead>
              <tr><th>Pair</th><th>Best</th><th>Last</th><th>Attempts</th><th>Trend</th></tr>
            </thead>
            <tbody>
              {Object.values(swaps).sort((a, b) => b.bestCount - a.bestCount).map(r => (
                <tr key={r.pairKey}>
                  <th>{(names.get(r.chordA) ?? r.chordA)} ↔ {(names.get(r.chordB) ?? r.chordB)}</th>
                  <td>{r.bestCount}</td>
                  <td>{r.lastCount}</td>
                  <td>{r.attempts}</td>
                  <td><Sparkline history={r.history} small /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function describeLog(l: RoutineLog, names: Map<string, string>): string {
  if (l.kind === 'chord') {
    return `${names.get(l.chordId ?? '') ?? l.chordId ?? '?'} · ${l.perfectReps ?? 0} reps`;
  }
  if (l.kind === 'swap') {
    const [a, b] = (l.pairKey ?? '').split('|');
    return `${names.get(a) ?? a} ↔ ${names.get(b) ?? b} · ${l.swapCount ?? 0} swaps`;
  }
  if (l.kind === 'strum') {
    const mins = l.durationMs ? Math.round(l.durationMs / 60000) : 0;
    return `${l.progressionId ?? ''} · ${mins}m`;
  }
  return '';
}
