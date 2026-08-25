import { useEffect, useRef, useState } from 'react';
import { DeleteButton } from './DeleteButton';
import { IconCollapsed } from './icons';

// A progression picker that is a MENU rather than a <select>.
//
// A native select cannot hold a control, and each saved progression needs its
// own delete affordance sitting next to it — so this is a button plus a popover
// list. It wears `.button` so it still reads as one of the row of controls it
// sits in.
//
// Deleting goes through the shared DeleteButton, so a kept progression is
// removed with the same glyph and the same confirmation as anything else the
// user made — here, a picking run in the ledger.

export type MenuProgression = {
  id: string;
  name: string;
  chordIds: string[];
};

export function ProgressionMenu({ builtIn, saved, value, onPick, onDelete, disabled }: {
  builtIn: MenuProgression[];
  saved: MenuProgression[];
  value: string;                       // '' = nothing loaded
  onPick: (p: MenuProgression) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = [...builtIn, ...saved].find(p => p.id === value) ?? null;

  // Click-away and Escape. Bound only while open, so the page carries no
  // listeners for a menu nobody has touched.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  function row(p: MenuProgression, deletable: boolean) {
    return (
      <div key={p.id} className={`menu-row${p.id === value ? ' on' : ''}`}>
        <button className="menu-item" onClick={() => { onPick(p); setOpen(false); }}>
          {p.name}
        </button>
        {deletable && (
          <DeleteButton what={p.name} heading="Delete this progression?"
            onDelete={() => onDelete(p.id)} />
        )}
      </div>
    );
  }

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        className={`button${value ? ' chosen' : ''}`}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Load a progression"
      >
        {current ? current.name : 'Progression…'}
        <IconCollapsed size={13} style={{ transform: 'rotate(90deg)' }} />
      </button>

      {open && (
        <div className="menu" role="listbox">
          {builtIn.map(p => row(p, false))}
          {saved.length > 0 && <div className="menu-sep" />}
          {saved.map(p => row(p, true))}
        </div>
      )}

    </div>
  );
}
