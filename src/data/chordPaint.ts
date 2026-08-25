// Which colour a chord is drawn in.
//
// Colour here is DIFFICULTY, not family: a chord wears the colour of the
// roadmap level it belongs to, so the same ramp that orders the Roadmap's level
// cards (cool & light → warm → hot → deep → ink, see roadmapPaint.ts) also runs
// through every chord grid. A barre chord looks harder than an open C because
// its ink says L3, not because it is "the barre colour".
//
// It never means "clickable" — that is --accent alone (docs/ui.md §2). Owned /
// calibrated / selected are still carried by border weight, the mic ring and
// the check, not by hue.
//
// The level comes from the chord's category (`ChordCategory.roadmapLevel`, e.g.
// "L3–6"), read as its LOWEST level — the point at which you would first meet
// the shape. Values live in styles.css as --level-1 … --level-8.

import { libraryChordById } from './chordLibrary';
import { chordCategoryById, type ChordCategoryId } from './chordCategories';

/** 1–8, or null for a category with no roadmap level (custom chords). */
export function levelForCategory(category: ChordCategoryId): number | null {
  const raw = chordCategoryById(category)?.roadmapLevel;
  const first = raw?.match(/\d/)?.[0];
  return first ? Number(first) : null;
}

export function levelForChord(id: string, category?: ChordCategoryId): number | null {
  if (category) return levelForCategory(category);
  const lib = libraryChordById(id);
  return lib ? levelForCategory(lib.category) : null;
}

// The class that sets --paint. Styles live in styles.css next to .chord-card.
// A chord with no level (one you registered yourself) gets the neutral ink
// rather than a guessed rung on the ramp.
export function paintClass(id: string, category?: ChordCategoryId): string {
  const level = levelForChord(id, category);
  return level ? `level-${level}` : 'level-none';
}
