import { useEffect, useRef } from 'react';
import { STRING_NAMES } from '../audio/pluck';
import type { PickNote } from '../data/pickPatterns';

// THE way a pick sequence is drawn — the catalog's exercises, the setup preview
// and the live run all render this. Because a pattern over a held chord and a
// fixed riff both reduce to PickNote[], riffs needed no second renderer.
//
// ORIENTATION: standard tab, high e on TOP. That is not a contradiction of
// PickStrip's low-E-first rule, which is about a HORIZONTAL row of strings
// matching a chord diagram's column order. A tab lays the strings on the
// VERTICAL axis, and every guitarist reads that high-e-up; flipping it to be
// "consistent" would make the one thing here that is a real-world convention
// wrong.
//
// The down/up arrows are display only and must stay that way: pick direction is
// not recoverable from audio at all (docs/pick-detection.md), so nothing may
// ever score it.

const ROWS = [5, 4, 3, 2, 1, 0];  // high e … low E, top to bottom

export function PickTab({ notes, position = null, ariaLabel, compact = false, maxNotes }: {
  notes: PickNote[];
  position?: number | null;   // index of the note to mark as current
  ariaLabel?: string;
  // A card-sized sample of the sequence: smaller rows, no direction row, no
  // scrolling. Enough to SHOW what the exercise looks like without becoming a
  // second place the exercise is fully specified.
  compact?: boolean;
  maxNotes?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Keep the current column in view — a run4 pass over G is 44 notes wide.
  useEffect(() => {
    if (position == null) return;
    const el = ref.current?.querySelector<HTMLElement>('.tab-col.now');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [position]);

  // An empty sequence still draws its six strings. Returning null here would
  // collapse the tab's slot the moment a progression is cleared, and the whole
  // page above would jump — see .pick-chord for the same reasoning.
  const shown = maxNotes != null ? notes.slice(0, maxNotes) : notes;

  return (
    <div className={`tab${compact ? ' compact' : ''}`} ref={ref}
      role="img" aria-label={ariaLabel ?? 'tab'}>
      <div className="tab-strings">
        {ROWS.map(s => <span key={s}>{STRING_NAMES[s].replace(/ .*/, '')}</span>)}
      </div>
      <div className="tab-scroll">
        {shown.map((n, i) => (
          <div key={i} className={`tab-col${i === position ? ' now' : ''}`}>
            {ROWS.map(s => (
              <span key={s} className={`tab-cell${n.stringIndex === s ? ' on' : ''}`}>
                {n.stringIndex === s ? n.fret : ''}
              </span>
            ))}
            {!compact && (
              <span className="tab-dir" title="A suggestion — pick direction is never checked">
                {n.direction === 'down' ? '↓' : '↑'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
