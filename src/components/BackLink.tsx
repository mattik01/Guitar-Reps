import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconBack } from './icons';

/**
 * THE way out of a screen, everywhere: the borderless `.back-btn` the routines
 * wear — an arrow, the name of where you land, muted until hovered. It is
 * navigation, so it is deliberately NOT styled as a button; a bordered button here
 * competes with the screen's actual actions.
 *
 * Use it for any "leave this page" or cross-page link in a page header (the
 * roadmap's All videos link uses it with its own icon). `to` links, `onClick`
 * acts (a routine that must log before leaving).
 */
export function BackLink({ to, onClick, label, icon, title }: {
  to?: string;
  onClick?: () => void;
  /** Name the destination, not the direction — "Roadmap", not "Back". */
  label: ReactNode;
  /** Defaults to the back arrow; pass another mark when it isn't strictly "back". */
  icon?: ReactNode;
  title?: string;
}) {
  const body = <>{icon ?? <IconBack size={14} />} {label}</>;
  return to
    ? <Link to={to} className="back-btn" title={title}>{body}</Link>
    : <button className="back-btn" onClick={onClick} title={title}>{body}</button>;
}
