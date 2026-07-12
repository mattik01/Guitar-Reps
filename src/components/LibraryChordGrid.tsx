import { FingeringViewer } from './FingeringViewer';
import { CHORD_CATEGORIES } from '../data/chordCategories';
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

// The single source of truth for how library chords are displayed and grouped:
// grouped by category (easiest → most advanced per CHORD_CATEGORIES), sorted by
// difficulty within each category, each card showing the fingering picker,
// difficulty · importance, and an optional info blurb. Used by the Chords page and
// by every "pick a chord to learn" surface so they stay consistent.
export function LibraryChordGrid({ chords, onPick, showEmptyCategories = false }: Props) {
  return (
    <>
      {CHORD_CATEGORIES.map(cat => {
        const inCat = chords
          .filter(c => c.category === cat.id)
          .slice()
          .sort((a, b) => a.difficulty - b.difficulty);
        if (inCat.length === 0 && !showEmptyCategories) return null;
        return (
          <section key={cat.id} style={{ marginTop: 24 }}>
            <div className="row">
              <h2 style={{ margin: 0 }}>{cat.name}</h2>
              <div className="spacer" />
              <span className="meta">
                {cat.roadmapLevel} · {inCat.length} chord{inCat.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>{cat.description}</p>
            {inCat.length === 0 ? (
              <div className="card"><p className="muted">No chords yet.</p></div>
            ) : (
              <div className="grid">
                {inCat.map(c => (
                  <div
                    key={c.id}
                    className="chord-card"
                    onClick={onPick ? () => onPick(c.id) : undefined}
                    role={onPick ? 'button' : undefined}
                  >
                    <div className="name">{c.name}</div>
                    <FingeringViewer chordId={c.id} fingerings={c.fingerings} size={120} />
                    <div className="meta">Difficulty {c.difficulty}/10 · Importance {c.importance}/10</div>
                    {c.info && <div className="meta" style={{ marginTop: 4 }}>{c.info}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
