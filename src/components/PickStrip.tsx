import { STRING_NAMES } from '../audio/pluck';

// THE six-string row — the one place per-string state is rendered as UI.
//
// The app had no per-string display at all before picking existed (ChordDiagram
// draws six anonymous lines), so this is the shared component that concept gets,
// per docs/ui.md: the Pick Lab, the picking routine and anything later that
// needs "which string" all render this, with the caller deciding the states.
//
// Displayed low E → high e, left to right, matching a chord diagram — NOT the
// "string 6 … string 1" numbering, which reads right-to-left and would put the
// two views in opposite orders on the same screen.

export type PickState =
  | 'idle'     // in the chord, nothing to say about it
  | 'target'   // pick this one now
  | 'correct'
  | 'wrong'
  | 'unsure'   // heard a pick, could not name the string
  | 'muted';   // not part of the held shape

export function PickStrip({ states, notes, onSelect, selectTitle }: {
  states: PickState[];              // length 6, low E → high e
  notes?: (string | null)[];        // e.g. 'G2' — the note this string sounds
  onSelect?: (stringIndex: number) => void;  // present → the cells are buttons
  selectTitle?: string;
}) {
  return (
    <div className="pick-strip">
      {STRING_NAMES.map((label, i) => {
        const state = states[i] ?? 'idle';
        const cls = `pick-cell ${state}`;
        const body = (
          <>
            <span className="pick-cell-string">{label}</span>
            <span className="pick-cell-note">{notes?.[i] ?? ''}</span>
          </>
        );
        return onSelect && state !== 'muted'
          ? (
            <button key={i} className={cls} onClick={() => onSelect(i)} title={selectTitle}>
              {body}
            </button>
          )
          : <div key={i} className={cls}>{body}</div>;
      })}
    </div>
  );
}
