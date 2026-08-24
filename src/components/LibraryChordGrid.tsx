import { ChordCard } from './ChordCard';
import { ChordCategorySections } from './ChordCategorySections';
import { cardFromLibrary } from '../data/chordResolve';
import type { LibraryChord } from '../data/chordLibrary';

type Props = {
  // Library chords to show (already filtered — e.g. only the ones not yet owned).
  chords: LibraryChord[];
  // When set, each card is clickable and calls this with the chord id (picker mode).
  onPick?: (id: string) => void;
  // Chords page shows every category (with a "No chords yet" placeholder when empty);
  // pickers pass false so fully-owned categories disappear instead of showing empties.
  showEmptyCategories?: boolean;
};

// How library chords are displayed: category sections (shared with every other
// chord surface via ChordCategorySections), sorted by difficulty within each,
// drawn with the shared ChordCard. Used by the Chords page and by every "pick a
// chord to learn" surface so they stay consistent.
export function LibraryChordGrid({ chords, onPick, showEmptyCategories = false }: Props) {
  return (
    <ChordCategorySections
      items={chords}
      categoryOf={c => c.category}
      sortWithin={(a, b) => a.difficulty - b.difficulty}
      showEmptyCategories={showEmptyCategories}
      renderCard={c => (
        <ChordCard
          key={c.id}
          chord={cardFromLibrary(c)}
          onClick={onPick ? () => onPick(c.id) : undefined}
          meta={
            <>
              <div>Difficulty {c.difficulty}/10 · Importance {c.importance}/10</div>
              {c.info && <div style={{ marginTop: 4 }}>{c.info}</div>}
            </>
          }
        />
      )}
    />
  );
}
