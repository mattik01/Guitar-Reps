import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChordCard } from '../components/ChordCard';
import { ChordCategorySections } from '../components/ChordCategorySections';
import { useChordView } from '../components/ChordView';
import { PageHeader } from '../components/PageHeader';
import { CHORD_LIBRARY, libraryChordById, type LibraryChord } from '../data/chordLibrary';
import { cardFromKnownChord } from '../data/chordResolve';
import { useRepertoire, useSetChordShape, type Chord } from '../state/store';

// ONE library. Every chord the app knows lives in this single category-ordered
// grid; whether you own it is a STATE of the card (full colour vs greyed), not a
// separate tab or a picker modal. Clicking any card opens the shared ChordView,
// which is where adding, editing, calibrating and practising a chord all happen.

type Row = {
  id: string;
  card: ReturnType<typeof cardFromKnownChord>;
  lib: LibraryChord | undefined;
  owned: Chord | null;
  category: LibraryChord['category'];
  difficulty: number;
  importance: number;
};

export default function Chords() {
  const [repertoire] = useRepertoire();
  const setChordShape = useSetChordShape();
  const { open } = useChordView();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(repertoire.map(c => [c.id, c]));
    // Library order first, then any repertoire chord the library doesn't have
    // (custom chords registered by hand) so nothing you own can be invisible.
    const fromLibrary = CHORD_LIBRARY.map(l => ({
      id: l.id,
      card: cardFromKnownChord(byId.get(l.id) ?? null, l),
      lib: l,
      owned: byId.get(l.id) ?? null,
      category: l.category,
      difficulty: l.difficulty,
      importance: l.importance,
    }));
    const custom = repertoire
      .filter(c => !libraryChordById(c.id))
      .map(c => ({
        id: c.id,
        card: cardFromKnownChord(c, undefined),
        lib: undefined,
        owned: c,
        category: (c.category ?? 'other') as LibraryChord['category'],
        difficulty: c.difficulty ?? 5,
        importance: c.importance ?? 5,
      }));
    return [...fromLibrary, ...custom];
  }, [repertoire]);

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter(r => r.id.toLowerCase().includes(q) || r.card.name.toLowerCase().includes(q)) : rows;

  return (
    <div>
      <PageHeader
        title="Chords"
        actions={
          <input
            className="input"
            type="search"
            placeholder="Search chords…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ maxWidth: 200 }}
          />
        }
      />

      {shown.length === 0 ? (
        <div className="card"><p className="muted">No chord matches “{query}”.</p></div>
      ) : (
        <ChordCategorySections
          items={shown}
          categoryOf={r => r.category}
          sortWithin={(a, b) => a.difficulty - b.difficulty}
          // Searching narrows to what matched; the full list shows every category
          // so the library's shape (and what's still ahead of you) stays visible.
          showEmptyCategories={!q}
          renderCard={r => (
            <ChordCard
              key={r.id}
              chord={r.card}
              dim={!r.owned}
              className={r.owned ? 'owned' : undefined}
              onClick={() => open(r.id)}
              // Owned or not, the card is the same — picking a fingering on a
              // chord you own moves its stored shape to that voicing.
              onFingeringSelect={r.owned ? f => setChordShape(r.id, f.shape) : undefined}
              // The same two numbers on EVERY card, owned or not — they are what
              // you scan a library by ("what should I learn next, and how hard
              // is it"). Rep counts are per-chord progress and live in the chord
              // view. Short form: the full "x/10" wording is in the view too.
              meta={<div>Difficulty {r.difficulty} · Importance {r.importance}</div>}
            />
          )}
        />
      )}

      <div className="footer-bar" style={{ marginTop: 24 }}>
        <button className="button" onClick={() => navigate('/routine/new')}>
          Learn a chord properly →
        </button>
      </div>
    </div>
  );
}
