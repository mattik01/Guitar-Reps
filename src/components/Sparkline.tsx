// Bar chart of a swap pair's attempt history. Lives here rather than in
// SwapRoutine so a page showing a swap table doesn't pull in the whole routine.
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
              background: isBest ? 'var(--good)' : isLast ? 'var(--paint-terracotta)' : 'var(--line)',
              borderRadius: 2,
            }}
          />
        );
      })}
    </div>
  );
}
