import { useState } from 'react';
import { Modal } from './Modal';
import { IconDelete } from './icons';

// THE way anything is deleted: a bin glyph that opens a confirmation.
//
// Deleting always confirms, because everything that wears this button is user
// data with no undo — a kept progression, a logged run — unlike the rest of the
// app, which can be rebuilt with a click.
//
// It carries its own dialog state so a list can hand every row one of these
// without threading a "which one is confirming" through the parent. The dialog
// renders where the button sits, which is what keeps it working inside a
// popover: the backdrop is a DESCENDANT of the menu, so the menu's click-away
// doesn't fire and pull the dialog down with it.

export function DeleteButton({ what, heading, onDelete, size = 14 }: {
  what: string;                 // named in the tooltip and echoed in the dialog
  heading: string;              // the dialog's question
  onDelete: () => void;
  size?: number;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <button className="icon-del" title={`Delete ${what}`} aria-label={`Delete ${what}`}
        onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirming(true); }}>
        <IconDelete size={size} />
      </button>

      {confirming && (
        <Modal onClose={() => setConfirming(false)} width={380}>
          <h3 style={{ marginTop: 0 }}>{heading}</h3>
          <p className="muted">{what}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="button" onClick={() => setConfirming(false)}>Keep</button>
            <button className="button danger"
              onClick={() => { onDelete(); setConfirming(false); }}>
              <IconDelete size={14} /> Delete
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
