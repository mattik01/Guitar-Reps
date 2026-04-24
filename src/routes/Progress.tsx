import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Sparkline } from '../routines/SwapRoutine';
import { dayKey, useRepertoire, useRoutineLog, useSwapRecords, type RoutineKind, type RoutineLog } from '../state/store';

const KIND_LABEL: Record<RoutineKind, string> = {
  chord: 'Chord',
  swap: 'Swap',
  strum: 'Strum',
};
const KIND_COLOR: Record<RoutineKind, string> = {
  chord: '#2b5bd7',
  swap: '#2e8b57',
  strum: '#c0690b',
};

export default function Progress() {
  const [log] = useRoutineLog();
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();

  const days = useMemo(() => buildWeek(log, 7), [log]);
  const recent = useMemo(() => [...log].sort((a, b) => b.at - a.at).slice(0, 15), [log]);
  const names = useMemo(() => new Map(repertoire.map(c => [c.id, c.name])), [repertoire]);

  return (
    <div>
      <h1>Progress</h1>

      <div className="card">
        <h3>This week</h3>
        <WeekGrid days={days} />
        <div className="row" style={{ marginTop: 10, fontSize: 13 }}>
          {(['chord', 'swap', 'strum'] as RoutineKind[]).map(k => (
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

function WeekGrid({ days }: { days: DayCell[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gap: 8 }}>
      {days.map(d => {
        const byKind: Record<RoutineKind, number> = { chord: 0, swap: 0, strum: 0 };
        for (const e of d.entries) byKind[e.kind]++;
        const isToday = d.key === dayKey(Date.now());
        const weekday = d.date.toLocaleDateString(undefined, { weekday: 'short' });
        return (
          <div key={d.key} style={{
            border: `1px solid ${isToday ? 'var(--ink)' : 'var(--line)'}`,
            borderRadius: 10,
            padding: 8,
            background: 'var(--panel)',
            minHeight: 90,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{weekday}</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{d.date.getDate()}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 'auto' }}>
              {(['chord', 'swap', 'strum'] as RoutineKind[]).flatMap(k =>
                Array.from({ length: byKind[k] }).map((_, i) => (
                  <div key={`${k}-${i}`} style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: KIND_COLOR[k],
                  }} />
                ))
              )}
            </div>
          </div>
        );
      })}
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
