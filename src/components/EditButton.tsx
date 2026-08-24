import type { CSSProperties } from 'react';
import { IconButton } from './IconButton';
import { IconEdit } from './icons';

// THE edit affordance, wherever something in the app can be edited — a song card, a
// chord shape, a roadmap note. One component so the icon, the size and the hit target
// never drift between screens (and so replacing the icon is one edit).
//
// Lucide's pencil, not the ✏️ emoji: an emoji renders in whatever the OS ships,
// ignores `currentColor`, and sits on a different baseline on every platform.
export function EditButton({ onClick, active = false, dot = false, title, label = 'Edit', style }: {
  onClick: () => void;
  /** True while the editor it opens is showing — the button reads as toggled. */
  active?: boolean;
  /** Marks "there is already something here" (e.g. this roadmap item has a note). */
  dot?: boolean;
  title: string;
  label?: string;
  /** Positioning only — never restyle the button here. */
  style?: CSSProperties;
}) {
  return (
    <IconButton onClick={onClick} title={title} label={label} active={active} dot={dot} style={style}>
      <IconEdit />
    </IconButton>
  );
}
