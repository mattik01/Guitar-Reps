import type { Chord } from '../state/store';
import { ChordDiagram } from './ChordDiagram';

type Props = {
  chord: Chord;
  size?: number;
  footer?: React.ReactNode;
  onClick?: () => void;
};

export function ChordCard({ chord, size = 120, footer, onClick }: Props) {
  return (
    <div className="chord-card" onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="name">{chord.name}</div>
      <ChordDiagram shape={chord.shape} size={size} />
      {footer && <div className="meta">{footer}</div>}
    </div>
  );
}
