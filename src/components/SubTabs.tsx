import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type SubTab<T extends string> = { id: T; label: string };

/**
 * Sub-tab state lives in the URL (`?tab=`) so every view inside a page stays
 * deep-linkable and the legacy top-level routes can redirect straight onto the
 * right sub-tab. Unknown/absent values coerce to `tabs[0]`.
 */
export function useTabParam<T extends string>(tabs: SubTab<T>[]): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const active = tabs.some(t => t.id === raw) ? (raw as T) : tabs[0].id;

  const setActive = useCallback((t: T) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      // The default tab is the bare URL — no `?tab=` noise for the common case.
      if (t === tabs[0].id) next.delete('tab');
      else next.set('tab', t);
      return next;
    }, { replace: true });
  }, [setParams, tabs]);

  return [active, setActive];
}

/** Reuses the `.seg` segmented-control style the calibration studio established. */
export function SubTabs<T extends string>({ tabs, active, onChange }: {
  tabs: SubTab<T>[];
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="subtabs">
      <div className="seg" role="tablist">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === active}
            className={`seg-btn ${t.id === active ? 'on' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
