// Which of the six Gouache Bal paints a chord is drawn in.
//
// Colour here is IDENTITY, not state: it says "this is a barre chord", the way
// a balfolk flyer gives each band its own ink. It never means "clickable" —
// that is --accent alone (docs/ui.md §2). Owned / calibrated / selected are all
// still carried by border weight, the mic ring and the check, not by hue.
//
// The mapping is arranged so that CONSECUTIVE categories differ, because the
// Chords page stacks them as adjacent sections via ChordCategorySections.

import { libraryChordById } from './chordLibrary';
import type { ChordCategoryId } from './chordCategories';

export type PaintName = 'terracotta' | 'ochre' | 'sage' | 'teal' | 'plum' | 'indigo';

export const PAINTS: PaintName[] = ['terracotta', 'ochre', 'sage', 'teal', 'plum', 'indigo'];

const BY_CATEGORY: Record<ChordCategoryId, PaintName> = {
  'open-basic': 'terracotta',
  'open-colorful': 'ochre',
  power: 'sage',
  barre: 'plum',
  'sevenths-open': 'teal',
  'sevenths-movable': 'indigo',
  extended: 'ochre',
  'altered-dominant': 'terracotta',
  'advanced-voicings': 'plum',
  other: 'sage',
};

export function paintForCategory(category: ChordCategoryId): PaintName {
  return BY_CATEGORY[category] ?? 'terracotta';
}

// Chords the user registered themselves have no library entry, so they get a
// stable paint from their id instead of all collapsing into one colour.
function paintFromId(id: string): PaintName {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PAINTS[h % PAINTS.length];
}

export function paintForChord(id: string, category?: ChordCategoryId): PaintName {
  if (category) return paintForCategory(category);
  const lib = libraryChordById(id);
  if (lib) return paintForCategory(lib.category);
  return id ? paintFromId(id) : 'terracotta';
}

// The class that sets --paint. Styles live in styles.css next to .chord-card.
export function paintClass(id: string, category?: ChordCategoryId): string {
  return `paint-${paintForChord(id, category)}`;
}
