import type { CSSProperties, ReactNode } from 'react';

// The shell every icon-only control in the app wears: one square tap target
// (.icon-btn), one place for the "toggled on" look, and one badge slot — so a pen,
// a playlist count and anything added later are the same size and weight wherever
// they sit next to each other.
export function IconButton({
  onClick, title, label, active = false, badge, dot = false, tone = 'default', style, children,
}: {
  onClick: () => void;
  title: string;
  /** Accessible name — the button itself is icon-only. */
  label: string;
  /** True while whatever it opens is showing — the button reads as toggled. */
  active?: boolean;
  /** A count in the corner (e.g. how many playlists a song is in). */
  badge?: number;
  /** A plain marker for "there is already something here" (e.g. a note exists). */
  dot?: boolean;
  /** 'accent' = this is the invitation to act (nothing here yet — add something). */
  tone?: 'default' | 'accent';
  /** Positioning only (e.g. the song card's corner) — never restyle the button here. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      className="icon-btn"
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={active}
      style={{
        position: 'relative',
        ...(tone === 'accent'
          ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' }
          : null),
        ...style,
      }}
    >
      {children}
      {/* The badge is deliberately NOT accent-coloured: it is a count of where the
          thing lives, not an unread notification demanding attention. */}
      {badge != null && (
        <span aria-hidden style={{
          position: 'absolute', top: -5, right: -5, minWidth: 15, height: 15, padding: '0 3px',
          borderRadius: 999, background: 'var(--panel)', border: '1px solid var(--line)',
          color: 'var(--muted)',
          fontSize: 10, fontWeight: 700, lineHeight: '13px', textAlign: 'center',
        }}>{badge}</span>
      )}
      {dot && (
        <span aria-hidden style={{
          position: 'absolute', top: 3, right: 3, width: 6, height: 6,
          borderRadius: '50%', background: 'var(--accent)',
        }} />
      )}
    </button>
  );
}
