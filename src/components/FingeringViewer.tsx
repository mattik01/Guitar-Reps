import { useRef, type PointerEvent } from 'react';
import { ChordDiagram } from './ChordDiagram';
import { useFingeringChoice, type Fingering } from '../state/store';

type Props = {
  chordId: string;
  fingerings: Fingering[];
  size?: number;
  // Fired when the user picks a fingering. Owned chords use it to move their
  // stored shape to the chosen voicing — the choice index alone wouldn't, since
  // a repertoire chord carries its own shape.
  onSelect?: (fingering: Fingering, index: number) => void;
};

// Shows one fingering of a chord with swipe / arrow navigation between them.
// The chosen index is persisted per chord (localStorage) via useFingeringChoice,
// so it's remembered across visits and reused when the chord is added to a
// repertoire. When there's only one fingering, it renders a plain diagram.
export function FingeringViewer({ chordId, fingerings, size = 120, onSelect }: Props) {
  const [choices, setChoices] = useFingeringChoice();
  const many = fingerings.length > 1;
  const idx = Math.min(Math.max(choices[chordId] ?? 0, 0), fingerings.length - 1);
  const startX = useRef<number | null>(null);

  function select(next: number) {
    const wrapped = (next % fingerings.length + fingerings.length) % fingerings.length;
    setChoices(prev => ({ ...prev, [chordId]: wrapped }));
    onSelect?.(fingerings[wrapped], wrapped);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    startX.current = e.clientX;
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (startX.current == null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (many && Math.abs(dx) > 30) select(idx + (dx < 0 ? 1 : -1));
  }

  const current = fingerings[idx];

  return (
    <div className="fingering">
      <div className="fingering-controls" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          className={'arrow' + (many ? '' : ' hidden')}
          aria-label="Previous fingering"
          aria-hidden={!many}
          tabIndex={many ? 0 : -1}
          onClick={e => { e.stopPropagation(); if (many) select(idx - 1); }}
        >‹</button>
        <div className="fingering-center">
          <div className="fingering-dots" role="tablist">
            {fingerings.map((f, i) => (
              <button
                key={i}
                type="button"
                className={'d' + (i === idx ? ' on' : '')}
                aria-label={f.label ?? `Fingering ${i + 1}`}
                aria-selected={i === idx}
                disabled={!many}
                onClick={e => { e.stopPropagation(); select(i); }}
              />
            ))}
          </div>
          <div className="fingering-label">
            {current.label ?? (many ? `Fingering ${idx + 1} of ${fingerings.length}` : ' ')}
          </div>
        </div>
        <button
          type="button"
          className={'arrow' + (many ? '' : ' hidden')}
          aria-label="Next fingering"
          aria-hidden={!many}
          tabIndex={many ? 0 : -1}
          onClick={e => { e.stopPropagation(); if (many) select(idx + 1); }}
        >›</button>
      </div>

      <div
        className="fingering-stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        style={{ touchAction: 'pan-y', cursor: many ? 'grab' : 'default' }}
      >
        <ChordDiagram shape={current.shape} size={size} />
      </div>
    </div>
  );
}
