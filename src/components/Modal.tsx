import type { ReactNode } from 'react';

/**
 * The shared modal shell: backdrop click closes, clicks inside do not.
 * Was copy-pasted across Repertoire, SongEditor and PlaylistPicker.
 */
export function Modal({ onClose, width, children }: {
  onClose: () => void;
  /** Override the default 720px cap (e.g. a narrow picker). */
  width?: number;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={width ? { maxWidth: width } : undefined}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
