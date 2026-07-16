// Shared "this week" activity heatmap used on Home (compact) and Progress (full).
// One cell per day, each showing a coloured dot per logged routine of that kind.
import { dayKey, type RoutineKind, type RoutineLog } from '../state/store';

export const KIND_COLOR: Record<RoutineKind, string> = {
  chord: '#2b5bd7',
  swap: '#2e8b57',
  strum: '#c0690b',
};

export const KIND_LABEL: Record<RoutineKind, string> = {
  chord: 'Chord',
  swap: 'Swap',
  strum: 'Strum',
};

export const ROUTINE_KINDS: RoutineKind[] = ['chord', 'swap', 'strum'];

export type DayCell = { key: string; date: Date; entries: RoutineLog[] };

// The last `numDays` days (oldest → newest, ending today), each with its log entries.
export function buildDayCells(log: RoutineLog[], numDays: number): DayCell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cells: DayCell[] = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    cells.push({ key: dayKey(d.getTime()), date: d, entries: [] });
  }
  const byKey = new Map(cells.map(c => [c.key, c]));
  for (const l of log) byKey.get(dayKey(l.at))?.entries.push(l);
  return cells;
}

// `compact` is the Home sizing (denser); default is the roomier Progress sizing.
const SIZES = {
  full:    { gap: 8, pad: 8, minH: 90, wdFont: 12, dateFont: 16, dotGap: 3, dot: 10 },
  compact: { gap: 6, pad: 6, minH: 74, wdFont: 11, dateFont: 14, dotGap: 2, dot: 8 },
};

export function DayActivityGrid({ days, compact = false }: { days: DayCell[]; compact?: boolean }) {
  const s = compact ? SIZES.compact : SIZES.full;
  const todayKey = dayKey(Date.now());
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gap: s.gap }}>
      {days.map(d => {
        const byKind: Record<RoutineKind, number> = { chord: 0, swap: 0, strum: 0 };
        for (const e of d.entries) byKind[e.kind]++;
        const isToday = d.key === todayKey;
        const weekday = d.date.toLocaleDateString(undefined, { weekday: 'short' });
        return (
          <div key={d.key} style={{
            border: `1px solid ${isToday ? 'var(--ink)' : 'var(--line)'}`,
            borderRadius: 10,
            padding: s.pad,
            minHeight: s.minH,
            display: 'flex',
            flexDirection: 'column',
            gap: compact ? 2 : 4,
            background: 'var(--panel)',
          }}>
            <div style={{ fontSize: s.wdFont, color: 'var(--muted)', fontWeight: 700 }}>{weekday}</div>
            <div style={{ fontSize: s.dateFont, fontWeight: 700 }}>{d.date.getDate()}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: s.dotGap, marginTop: 'auto' }}>
              {ROUTINE_KINDS.flatMap(k =>
                Array.from({ length: byKind[k] }).map((_, i) => (
                  <div key={`${k}-${i}`} style={{ width: s.dot, height: s.dot, borderRadius: '50%', background: KIND_COLOR[k] }} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
