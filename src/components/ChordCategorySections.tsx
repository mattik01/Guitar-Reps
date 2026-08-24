import type { ReactNode } from 'react';
import { CHORD_CATEGORIES, type ChordCategoryId } from '../data/chordCategories';

// THE way chords are grouped on screen: one section per CHORD_CATEGORIES entry,
// easiest → most advanced, with the same section chrome everywhere. Owns only the
// grouping/sorting/headers — the cards come from the caller (they differ: the
// library shows diagrams, the quiz picker deliberately must not).
//
// `compact` is the in-card picker sizing: smaller heading, no category blurb.
export type ChordCategorySectionsProps<T> = {
  items: T[];
  categoryOf: (item: T) => ChordCategoryId | undefined;   // undefined → 'other'
  renderCard: (item: T) => ReactNode;   // must set its own key
  sortWithin?: (a: T, b: T) => number;
  // Chords page shows every category (with a placeholder when empty); pickers
  // leave fully-covered categories out instead of showing empties.
  showEmptyCategories?: boolean;
  compact?: boolean;
  gridClassName?: string;
};

export function ChordCategorySections<T>({
  items, categoryOf, renderCard, sortWithin,
  showEmptyCategories = false, compact = false, gridClassName = 'grid',
}: ChordCategorySectionsProps<T>) {
  return (
    <>
      {CHORD_CATEGORIES.map(cat => {
        const inCat = items.filter(i => (categoryOf(i) ?? 'other') === cat.id);
        if (sortWithin) inCat.sort(sortWithin);
        if (inCat.length === 0 && !showEmptyCategories) return null;
        const count = `${inCat.length} chord${inCat.length === 1 ? '' : 's'}`;
        return (
          <section key={cat.id} style={{ marginTop: compact ? 16 : 24 }}>
            <div className="row section-head">
              {compact
                ? <h3 style={{ margin: 0, fontSize: 15 }}>{cat.name}</h3>
                : <h2 style={{ margin: 0 }}>{cat.name}</h2>}
              <div className="spacer" />
              <span className="meta">{cat.roadmapLevel} · {count}</span>
            </div>
            {!compact && <p className="muted" style={{ margin: '4px 0 14px' }}>{cat.description}</p>}
            {inCat.length === 0 ? (
              <div className="card empty"><p className="muted">No chords yet.</p></div>
            ) : (
              <div className={gridClassName}>{inCat.map(i => renderCard(i))}</div>
            )}
          </section>
        );
      })}
    </>
  );
}
