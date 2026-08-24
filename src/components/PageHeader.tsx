import type { ReactNode } from 'react';

/**
 * The one page header for the six nav tabs. The <h1> is deliberately screen-reader
 * only: the highlighted tab in AppNav already names the section, so drawing the
 * title again is redundant. It stays in the DOM so every page still has exactly
 * one h1 for structure and assistive tech.
 */
export function PageHeader({ title, subtitle, leading, actions, children }: {
  title: string;
  subtitle?: ReactNode;
  /** Left-aligned controls — where a page's "leave here" / cross-links belong. */
  leading?: ReactNode;
  actions?: ReactNode;
  /** Rendered under the header — where <SubTabs/> goes. */
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <h1 className="sr-only">{title}</h1>
      {(leading || actions) && (
        <div className="row">
          {leading}
          <div className="spacer" />
          {actions}
        </div>
      )}
      {subtitle && <p className="muted" style={{ margin: '6px 0 0' }}>{subtitle}</p>}
      {children}
    </header>
  );
}
