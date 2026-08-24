import { useState, type CSSProperties, type ReactNode } from 'react';
import { isKnown, type MatchLevel } from '../data/chordNormalize';
import { KEY_NAMES } from '../data/songResolve';
import { IconCollapsed, IconExpanded } from './icons';

// THE song filter bar — Browse and My songs render this same element, so a filter
// means the same thing on both and neither screen grows its own controls.
//
// Two rows, always:
//   1  narrow the list  — search, genre, BPM range, key, mode
//   2  qualify + order  — playable/strict, the chord disclosure, the match count, sort
// The chord toggles hang off row 2 as a disclosure rather than becoming a third row.

export type SongSort = 'popularity' | 'playability' | 'title' | 'artist';

export type SongFilters = {
  text: string;
  genre: string;
  sort: SongSort;
  tempoMin: string;
  tempoMax: string;
  key: string;   // '' = any, else '0'..'11'
  mode: string;  // '' = any, '1' major, '0' minor
  onlyPlayable: boolean;
  strict: boolean;      // false = lenient (base), true = exact
  excluded: Set<string>; // chords toggled OFF — songs using them are hidden
  showChords: boolean;
};

export const NO_FILTERS: SongFilters = {
  text: '', genre: '', sort: 'popularity',
  tempoMin: '', tempoMax: '', key: '', mode: '',
  onlyPlayable: false, strict: false, excluded: new Set(), showChords: false,
};

export type SongFilterApi = {
  f: SongFilters;
  set: <K extends keyof SongFilters>(key: K, value: SongFilters[K]) => void;
  toggleChord: (chord: string) => void;
  resetChords: () => void;
  /** Match level implied by `strict`. */
  level: MatchLevel;
};

export function useSongFilters(initial: Partial<SongFilters> = {}): SongFilterApi {
  const [f, setF] = useState<SongFilters>({ ...NO_FILTERS, ...initial });
  const set: SongFilterApi['set'] = (key, value) =>
    setF(prev => ({
      ...prev,
      [key]: value,
      // The match level flips which normalized chord column tokens line up with, so
      // previously excluded ones no longer mean anything — clear them with it.
      ...(key === 'strict' ? { excluded: new Set<string>() } : null),
    }));
  const toggleChord = (chord: string) => setF(prev => {
    const next = new Set(prev.excluded);
    if (next.has(chord)) next.delete(chord); else next.add(chord);
    return { ...prev, excluded: next };
  });
  const resetChords = () => setF(prev => ({ ...prev, excluded: new Set() }));
  return { f, set, toggleChord, resetChords, level: f.strict ? 'exact' : 'base' };
}

// One geometry for every control in the bar — it is only compact if the selects,
// inputs and buttons share a line height.
const CONTROL: CSSProperties = {
  padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13,
};

export function SongFilterBar({
  api, genres, chords, chordsLoading = false, knownSet, count, countNote, sticky = true, leading,
}: {
  api: SongFilterApi;
  genres: string[];
  /** The chord toggle list: what the OTHER filters allow, most common first. */
  chords: { chord: string; n: number }[];
  chordsLoading?: boolean;
  knownSet: Set<string>;
  /** How many songs match — not how many are rendered. null while unknown. */
  count: number | null;
  /** Qualifier shown after the count (e.g. a ranking cap). */
  countNote?: string;
  sticky?: boolean;
  /** Controls that belong above the bar (e.g. New playlist / Import). */
  leading?: ReactNode;
}) {
  const { f, set, toggleChord, resetChords, level } = api;
  const offCount = chords.reduce((n, c) => n + (f.excluded.has(c.chord) ? 1 : 0), 0);

  return (
    <>
      {leading && <div className="row" style={{ gap: 6, marginBottom: 6 }}>{leading}</div>}

      <div className="card"
        style={{ padding: 'var(--s3)', ...(sticky ? { position: 'sticky', top: 8, zIndex: 5 } : null) }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input type="text" value={f.text} onChange={e => set('text', e.target.value)}
            placeholder="Search title or artist…"
            style={{ ...CONTROL, flex: '1 1 150px', minWidth: 120 }} />
          <select value={f.genre} onChange={e => set('genre', e.target.value)}
            style={{ ...CONTROL, maxWidth: 140 }}>
            <option value="">All genres</option>
            {genres.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 12 }}>BPM</span>
          <input type="number" value={f.tempoMin} onChange={e => set('tempoMin', e.target.value)}
            placeholder="min" style={{ ...CONTROL, width: 58 }} />
          <span className="muted">–</span>
          <input type="number" value={f.tempoMax} onChange={e => set('tempoMax', e.target.value)}
            placeholder="max" style={{ ...CONTROL, width: 58 }} />
          <select value={f.key} onChange={e => set('key', e.target.value)}
            style={{ ...CONTROL, maxWidth: 96 }} title="Key">
            <option value="">Any key</option>
            {KEY_NAMES.map((k, i) => <option key={i} value={i}>{k}</option>)}
          </select>
          <select value={f.mode} onChange={e => set('mode', e.target.value)}
            style={{ ...CONTROL, maxWidth: 110 }}>
            <option value="">major/minor</option>
            <option value="1">major</option>
            <option value="0">minor</option>
          </select>
        </div>

        <div className="row" style={{ gap: 12, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="row" style={{ gap: 5, fontSize: 13 }}
            title="Songs whose chords are all in your Chords repertoire">
            <input type="checkbox" checked={f.onlyPlayable}
              onChange={e => set('onlyPlayable', e.target.checked)} />
            Only songs I can play
          </label>
          <label className="row" style={{ gap: 5, fontSize: 13 }}
            title="Lenient counts Cmaj7, C/G… as C. Strict treats them as distinct.">
            <input type="checkbox" checked={f.strict} onChange={e => set('strict', e.target.checked)} />
            Strict chord match
          </label>
          <button className="button small" onClick={() => set('showChords', !f.showChords)}
            title="Toggle a chord off to hide songs that use it">
            {f.showChords ? <IconExpanded size={13} /> : <IconCollapsed size={13} />} Chords
            {offCount > 0 && <span style={{ color: 'var(--muted)' }}> · {offCount} off</span>}
          </button>
          {offCount > 0 && <button className="button small" onClick={resetChords}>Reset</button>}
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
            title="Songs matching the current filters">
            {count == null ? '…' : `${count.toLocaleString()} song${count === 1 ? '' : 's'}`}
            {countNote && ` · ${countNote}`}
          </span>
          <select value={f.sort} onChange={e => set('sort', e.target.value as SongSort)}
            style={{ ...CONTROL, maxWidth: 150 }}
            title="Playability ranks by how fast you already swap this song's chord changes">
            <option value="popularity">Most popular</option>
            <option value="playability">Most playable</option>
            <option value="title">Title A–Z</option>
            <option value="artist">Artist A–Z</option>
          </select>
        </div>

        {f.showChords && (
          <div className="row" style={{
            flexWrap: 'wrap', gap: 6, marginTop: 8, paddingTop: 8,
            borderTop: '1px solid var(--line)', maxHeight: 132, overflowY: 'auto',
          }}>
            {chords.length === 0 && (
              <span className="muted" style={{ fontSize: 12 }}>
                {chordsLoading ? 'Finding chords…' : 'No chords for these filters.'}
              </span>
            )}
            {chords.map(({ chord, n }) => {
              const known = isKnown(chord, knownSet, level);
              const off = f.excluded.has(chord);
              return (
                <button key={chord} onClick={() => toggleChord(chord)}
                  title={`${n.toLocaleString()} song${n === 1 ? '' : 's'}${off ? ' · hidden' : ''}`}
                  style={{
                    padding: '2px 9px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                    background: !off && known ? 'var(--good)' : 'transparent',
                    color: off ? 'var(--muted)' : known ? 'var(--accent-ink)' : 'var(--muted)',
                    border: known ? '1px solid var(--good)' : '1px dashed var(--line)',
                    opacity: off ? 0.45 : 1,
                    textDecoration: off ? 'line-through' : 'none',
                  }}>{chord}</button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
