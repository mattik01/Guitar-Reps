import { useEffect, useMemo, useState } from 'react';
import { useCatalog, getProgression, type CatalogSong, type ChordCount } from '../data/catalogDb';
import { useRepertoire, useSongs, ensureInDefaultPlaylist, saveCatalogSong, resolveAndRefreshSongs, migrateSongsToRefs } from '../state/store';
import { knownSetAtLevel, isKnown, type MatchLevel } from '../data/chordNormalize';
import { parseProgression, type ProgressionSection } from '../data/chordonomicon';
import { PlaylistPicker } from '../components/PlaylistPicker';
import { AlbumArt } from '../components/AlbumArt';
import { SongCardShell } from '../components/SongCard';
import { SongEditor } from '../components/SongEditor';

const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
// "174 BPM · D major" style meta, when audio features are present.
function tempoKey(s: CatalogSong): string {
  const parts: string[] = [];
  if (s.tempo) parts.push(`${Math.round(s.tempo)} BPM`);
  if (s.key != null && s.key >= 0) parts.push(`${KEY_NAMES[s.key]} ${s.mode === 0 ? 'minor' : 'major'}`);
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

export default function Browse() {
  const { status, search, chords } = useCatalog();
  const [repertoire] = useRepertoire();
  const [songs] = useSongs();

  const [text, setText] = useState('');
  const [genre, setGenre] = useState('');
  const [onlyPlayable, setOnlyPlayable] = useState(false);
  const [strict, setStrict] = useState(false); // false = lenient (base), true = exact
  const [sort, setSort] = useState<'popularity' | 'title' | 'artist'>('popularity');

  const [tempoMin, setTempoMin] = useState('');
  const [tempoMax, setTempoMax] = useState('');
  const [keyFilter, setKeyFilter] = useState('');   // '' = any, else '0'..'11'
  const [modeFilter, setModeFilter] = useState(''); // '' = any, '1' major, '0' minor

  // Chord toggle filter: `available` is every chord the *other* filters allow;
  // `excludedChords` are the ones toggled off (default all on = empty set).
  const [available, setAvailable] = useState<ChordCount[]>([]);
  const [chordsLoading, setChordsLoading] = useState(false);
  const [excludedChords, setExcludedChords] = useState<Set<string>>(new Set());
  const [showChords, setShowChords] = useState(false);

  const [results, setResults] = useState<CatalogSong[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pickerSong, setPickerSong] = useState<string | null>(null);
  const [editingSong, setEditingSong] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [progCache, setProgCache] = useState<Record<number, ProgressionSection[]>>({});

  const level: MatchLevel = strict ? 'exact' : 'base';
  const PAGE = 50;

  // Audio-feature filter values (parsed) shared by search + load-more.
  const audioOpts = {
    tempoMin: tempoMin ? Number(tempoMin) : undefined,
    tempoMax: tempoMax ? Number(tempoMax) : undefined,
    key: keyFilter !== '' ? Number(keyFilter) : undefined,
    mode: modeFilter !== '' ? Number(modeFilter) : undefined,
  };

  // Known-chord set from the repertoire, normalized at the active strictness.
  const knownTokens = useMemo(() => repertoire.flatMap(c => [c.name, c.id]), [repertoire]);
  const knownSet = useMemo(() => knownSetAtLevel(knownTokens, level), [knownTokens, level]);
  const knownArr = useMemo(() => Array.from(knownSet), [knownSet]);

  const excludeArr = useMemo(() => Array.from(excludedChords), [excludedChords]);
  const excludeKey = useMemo(() => excludeArr.slice().sort().join('|'), [excludeArr]);

  const ready = status.phase === 'ready';

  // Keep saved songs sharing this catalog as their source of truth: once the catalog
  // is ready, re-resolve each saved song by its stable ref and refresh its cached
  // catalogId/tempo/chords (which go stale when a rebuild renumbers rows). Migrate
  // legacy songs to the ref+overlay model first.
  useEffect(() => {
    if (!ready) return;
    migrateSongsToRefs();
    resolveAndRefreshSongs().catch((err: unknown) => console.error('song resync failed:', err));
  }, [ready]);

  // Debounced (re)search whenever filters change. Only runs once the catalog is ready.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { songs: rows, hasMore } = await search({
          text, genre, known: knownArr, level, onlyPlayable, excludeChords: excludeArr, sort, limit: PAGE, offset: 0, ...audioOpts,
        });
        if (!cancelled) { setResults(rows); setHasMore(hasMore); }
      } catch (err) {
        console.error('BROWSE search error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, text, genre, onlyPlayable, strict, sort, knownArr.join('|'), excludeKey, tempoMin, tempoMax, keyFilter, modeFilter]);

  // Load the chord toggle list: distinct chords across the songs the *other*
  // filters allow (so it deliberately excludes `excludeChords` itself). Debounced.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!cancelled) setChordsLoading(true);
      try {
        const list = await chords({ text, genre, known: knownArr, level, onlyPlayable, ...audioOpts });
        if (!cancelled) setAvailable(list);
      } catch (err) {
        console.error('BROWSE chords error:', err);
      } finally {
        if (!cancelled) setChordsLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, text, genre, onlyPlayable, strict, knownArr.join('|'), tempoMin, tempoMax, keyFilter, modeFilter]);

  // Match level flips which normalized chord column we compare on, so previously
  // excluded tokens no longer line up — clear the toggle state when it changes.
  useEffect(() => { setExcludedChords(new Set()); }, [strict]);

  async function loadMore() {
    setLoading(true);
    try {
      const { songs: rows, hasMore } = await search({
        text, genre, known: knownArr, level, onlyPlayable, excludeChords: excludeArr, sort, limit: PAGE, offset: results.length, ...audioOpts,
      });
      setResults(prev => [...prev, ...rows]);
      setHasMore(hasMore);
    } finally { setLoading(false); }
  }

  const ownedKeys = useMemo(
    () => new Set(songs.map(s => `${s.title} ${s.artist}`.toLowerCase())),
    [songs],
  );

  function toggleChordFilter(ch: string) {
    setExcludedChords(prev => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch); else next.add(ch);
      return next;
    });
  }

  // How many of the currently-listed chords are toggled off.
  const offCount = useMemo(
    () => available.reduce((n, a) => n + (excludedChords.has(a.chord) ? 1 : 0), 0),
    [available, excludedChords],
  );

  // Expand/collapse a song's full chord sequence, lazily fetching + caching it.
  async function toggleSequence(id: number) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!progCache[id]) {
      const raw = await getProgression(id);
      setProgCache(prev => ({ ...prev, [id]: parseProgression(raw || '') }));
    }
  }


  return (
    <div>
      <div className="row">
        <h1>Browse</h1>
        <div className="spacer" />
        {ready && <span className="muted">{status.songs.toLocaleString()} songs</span>}
      </div>
      <p className="muted">
        Browse the song catalog. Chips are green for chords already in your repertoire, grey for ones to learn.
        Find the sheet & audio yourself, then <strong>Add</strong> a song to tweak its chords and attach files.
      </p>

      {status.phase !== 'ready' && <CatalogLoader status={status} />}

      {ready && (
        <>
          <div className="card" style={{ position: 'sticky', top: 8, zIndex: 5 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text" value={text} onChange={e => setText(e.target.value)}
                placeholder="Search title or artist…"
                style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, flex: '1 1 220px' }}
              />
              <select value={genre} onChange={e => setGenre(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }}>
                <option value="">All genres</option>
                {status.genres.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={sort} onChange={e => setSort(e.target.value as any)}
                style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }}>
                <option value="popularity">Most popular</option>
                <option value="title">Title A–Z</option>
                <option value="artist">Artist A–Z</option>
              </select>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 13 }}>BPM</span>
              <input type="number" value={tempoMin} onChange={e => setTempoMin(e.target.value)} placeholder="min"
                style={{ width: 64, padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
              <span className="muted">–</span>
              <input type="number" value={tempoMax} onChange={e => setTempoMax(e.target.value)} placeholder="max"
                style={{ width: 64, padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
              <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>Key</span>
              <select value={keyFilter} onChange={e => setKeyFilter(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 8 }}>
                <option value="">Any</option>
                {KEY_NAMES.map((k, i) => <option key={i} value={i}>{k}</option>)}
              </select>
              <select value={modeFilter} onChange={e => setModeFilter(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 8 }}>
                <option value="">major/minor</option>
                <option value="1">major</option>
                <option value="0">minor</option>
              </select>
            </div>
            <div className="row" style={{ gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={onlyPlayable} onChange={e => setOnlyPlayable(e.target.checked)} />
                Only songs I can play
              </label>
              <label className="row" style={{ gap: 6 }} title="Lenient counts Cmaj7, C/G… as C. Strict treats them as distinct.">
                <input type="checkbox" checked={strict} onChange={e => setStrict(e.target.checked)} />
                Strict chord match
              </label>
              {repertoire.length === 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  (Add chords to your Repertoire to light up playable songs.)
                </span>
              )}
            </div>

            <div className="col" style={{ gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="button" onClick={() => setShowChords(v => !v)}
                  title="Toggle a chord off to hide songs that use it"
                  style={{ padding: '2px 10px', fontSize: 13 }}>
                  <span style={{ display: 'inline-block', width: 10 }}>{showChords ? '▾' : '▸'}</span> Chords
                </button>
                {offCount > 0 && <span className="muted" style={{ fontSize: 12 }}>{offCount} hidden</span>}
                {offCount > 0 && (
                  <button className="button" onClick={() => setExcludedChords(new Set())}
                    style={{ padding: '2px 10px', fontSize: 12 }}>Reset</button>
                )}
                {!showChords && offCount === 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>Toggle off any chord to hide songs that use it.</span>
                )}
              </div>
              {showChords && (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 2, maxHeight: 168, overflowY: 'auto' }}>
                  {available.length === 0 && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {chordsLoading ? 'Finding chords…' : 'No chords for these filters.'}
                    </span>
                  )}
                  {available.map(({ chord, n }) => {
                    const known = isKnown(chord, knownSet, level);
                    const off = excludedChords.has(chord);
                    return (
                      <button key={chord} onClick={() => toggleChordFilter(chord)}
                        title={`${n.toLocaleString()} song${n === 1 ? '' : 's'}${off ? ' · hidden' : ''}`}
                        style={{
                          padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                          background: !off && known ? 'var(--good)' : 'transparent',
                          color: off ? 'var(--muted)' : known ? '#fff' : 'var(--muted)',
                          border: known ? '1px solid var(--good)' : '1px dashed var(--line)',
                          opacity: off ? 0.45 : 1,
                          textDecoration: off ? 'line-through' : 'none',
                        }}>{chord}</button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="col" style={{ gap: 12, marginTop: 12 }}>
            {results.length === 0 && !loading && <div className="card"><p className="muted">No matches.</p></div>}
            {results.map(s => {
              const added = ownedKeys.has(`${s.title} ${s.artist}`.toLowerCase());
              return (
                <SongCardShell
                  key={s.id}
                  art={<AlbumArt spotifyId={s.spotifyId} artUrl={s.artUrl} />}
                  title={s.title}
                  subtitle={<>{s.artist || '—'}{s.genre ? ` · ${s.genre}` : ''}{tempoKey(s)}</>}
                  actions={
                    <>
                      {s.spotifyId && (
                        <a className="button" href={`https://open.spotify.com/track/${s.spotifyId}`}
                          target="_blank" rel="noreferrer" title="Open on Spotify"
                          style={{ padding: '2px 10px', fontSize: 13, color: '#1DB954', borderColor: '#1DB954' }}>
                          Spotify ↗
                        </a>
                      )}
                      <button className="button" title="Edit chords, add a sheet or audio"
                        onClick={() => { const id = saveCatalogSong(s); ensureInDefaultPlaylist(id); setEditingSong(id); }}
                        style={{ padding: '2px 10px', fontSize: 15 }}>✏️</button>
                      <button className="button"
                        title={added ? 'In your playlists — click to change' : 'Add to a playlist'}
                        onClick={() => { const id = saveCatalogSong(s); ensureInDefaultPlaylist(id); setPickerSong(id); }}
                        style={{
                          padding: '2px 12px', fontWeight: 800, fontSize: 20, lineHeight: 1.2,
                          background: added ? 'var(--accent)' : undefined,
                          color: added ? 'var(--accent-ink)' : undefined,
                          borderColor: added ? 'var(--accent)' : undefined,
                        }}>+</button>
                    </>
                  }
                  chords={s.chords}
                  knownSet={knownSet}
                  level={level}
                  catalogId={s.id}
                  tempo={s.tempo}
                  chordsLeading={
                    <button onClick={() => toggleSequence(s.id)}
                      title="Show/hide the full chord sequence"
                      style={{
                        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 24, height: 24, borderRadius: '50%', color: 'var(--muted)',
                        border: '1px solid var(--line)', background: 'var(--panel)',
                      }}>
                      <span style={{ display: 'inline-block', fontSize: 9, lineHeight: 1, transition: 'transform .15s',
                        transform: expanded === s.id ? 'rotate(180deg)' : 'none' }}>▼</span>
                    </button>
                  }
                >
                  {expanded === s.id && (
                    <div className="col" style={{ gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                      {!progCache[s.id] && <span className="muted">Loading sequence…</span>}
                      {progCache[s.id]?.length === 0 && <span className="muted">No sequence data for this song.</span>}
                      {progCache[s.id]?.map((sec, si) => (
                        <div key={si}>
                          {sec.label && <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>{sec.label}</div>}
                          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                            {sec.chords.map((ch, ci) => {
                              const known = isKnown(ch, knownSet, level);
                              return (
                                <span key={ci} style={{
                                  padding: '2px 8px', borderRadius: 6,
                                  background: known ? 'var(--good)' : 'transparent',
                                  color: known ? '#fff' : 'var(--muted)',
                                  border: known ? '1px solid var(--good)' : '1px dashed var(--line)',
                                  fontWeight: 600, fontSize: 12,
                                }}>{ch}</span>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SongCardShell>
              );
            })}
          </div>

          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            {loading && <span className="muted">Loading…</span>}
            {!loading && hasMore && <button className="button" onClick={loadMore}>Load more</button>}
          </div>
        </>
      )}

      {pickerSong && <PlaylistPicker songId={pickerSong} onClose={() => setPickerSong(null)} />}
      {editingSong && <SongEditor songId={editingSong} onClose={() => setEditingSong(null)} />}
    </div>
  );
}

function CatalogLoader({ status }: { status: ReturnType<typeof useCatalog>['status'] }) {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';
  const isTabLock = status.phase === 'error' && status.error === 'TAB_LOCK';
  let msg = 'Preparing catalog…';
  if (status.phase === 'init') msg = 'Starting database…';
  else if (status.phase === 'downloading') msg = `Downloading catalog… ${mb(status.bytes)}`;
  else if (status.phase === 'importing') msg = `Installing catalog locally… ${mb(status.bytes)}`;
  else if (isTabLock) msg = 'The catalog is open in another tab.';
  else if (status.phase === 'error') msg = `Couldn't load catalog: ${status.error}`;
  return (
    <div className="card">
      <p style={{ margin: 0 }}>{msg}</p>
      {status.phase !== 'error' && (
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          One-time download, then it's stored on your device and works offline.
        </p>
      )}
      {isTabLock && (
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          Close any other tabs of this app, then <button className="button" style={{ padding: '2px 10px' }}
            onClick={() => location.reload()}>reload</button>. (The local database can only be open in one tab.)
        </p>
      )}
      {status.phase === 'error' && !isTabLock && (
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          Make sure the catalog was built (<code>npm run build:catalog</code>) so <code>public/catalog.sqlite.gz</code> exists.
        </p>
      )}
    </div>
  );
}
