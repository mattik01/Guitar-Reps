import { NavLink } from 'react-router-dom';

/**
 * The single source of truth for the top-level tabs. Add a tab here, not in App.tsx —
 * the nav is data-driven so the bar and the route table can never drift apart.
 */
export const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Home', end: true },
  { to: '/exercise', label: 'Exercise' },
  { to: '/chords', label: 'Chords' },
  { to: '/songs', label: 'Songs' },
  { to: '/roadmap', label: 'Roadmap' },
];

export function AppNav() {
  return (
    <nav className="topnav">
      {TABS.map(t => (
        <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>
      ))}
    </nav>
  );
}
