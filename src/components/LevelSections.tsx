import type { ReactNode } from 'react';
import { ROADMAP } from '../data/roadmap';

// THE way anything is grouped by roadmap level on screen: one section per level,
// in roadmap order, with the same section chrome chords already use.
//
// The sibling of ChordCategorySections, not a replacement for it — that one
// iterates CHORD_CATEGORIES (chords are grouped by category, and the *category*
// carries a display level string) and hard-codes the word "chord" in its count.
// This one iterates the levels themselves, for things that genuinely belong to a
// level. Markup is deliberately identical so a section header looks the same
// wherever you meet one.
//
// Levels with nothing in them are dropped: an exercise ladder that only reaches
// Level 1 should show one heading, not eight, seven of them empty.

const LEVELS = ROADMAP.flatMap(phase => phase.levels);

export type LevelSectionsProps<T> = {
  items: T[];
  levelOf: (item: T) => string;         // a ROADMAP level id, e.g. 'l1'
  renderCard: (item: T) => ReactNode;   // must set its own key
  sortWithin?: (a: T, b: T) => number;
  countNoun?: string;                   // singular; pluralised with a bare 's'
  compact?: boolean;
  gridClassName?: string;
};

export function LevelSections<T>({
  items, levelOf, renderCard, sortWithin,
  countNoun = 'item', compact = false, gridClassName = 'grid',
}: LevelSectionsProps<T>) {
  return (
    <>
      {LEVELS.map(level => {
        const inLevel = items.filter(i => levelOf(i) === level.id);
        if (inLevel.length === 0) return null;
        if (sortWithin) inLevel.sort(sortWithin);
        const count = `${inLevel.length} ${countNoun}${inLevel.length === 1 ? '' : 's'}`;
        return (
          <section key={level.id} style={{ marginTop: compact ? 16 : 24 }}>
            <div className="row section-head">
              {compact
                ? <h3 style={{ margin: 0, fontSize: 15 }}>{level.name}</h3>
                : <h2 style={{ margin: 0 }}>{level.name}</h2>}
              <div className="spacer" />
              <span className="meta">{count}</span>
            </div>
            <div className={gridClassName}>{inLevel.map(i => renderCard(i))}</div>
          </section>
        );
      })}
    </>
  );
}
