import { useEffect, useMemo, useState } from 'react';
import { useCatalog, type CatalogSong, type ChordCount } from '../data/catalogDb';
import { playability, repertoireByBase } from '../data/songTransitions';
import { primeAnalysis } from '../data/songAnalysis';
import {
  useRepertoire, useSwapRecords, useSongs, useSongOverlays, usePlaylists, mergeSong, songRefOf,
  ensureInDefaultPlaylist, saveCatalogSong, resolveAndRefreshSongs, migrateSongsToRefs,
} from '../state/store';
import { knownSetAtLevel } from '../data/chordNormalize';
import { PlaylistPicker } from '../components/PlaylistPicker';
import { SongCard } from '../components/SongCard';
import { cardFromCatalog, cardFromSong } from '../data/songResolve';
import { SongFilterBar, useSongFilters } from '../components/SongFilters';
import { SongEditor } from '../components/SongEditor';

export default function BrowsePanel() {
  const { status, search, chords, count, pool } = useCatalog();
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();
  const [songs] = useSongs();
  const [overlays] = useSongOverlays();
  const [playlists] = usePlaylists();

  const api = useSongFilters();
  const { f, level } = api;
  const { text, genre, sort, onlyPlayable } = f;
  const excludedChords = f.excluded;

  // Chord toggle list: what the OTHER filters allow (so it deliberately ignores the
  // toggles themselves), most common first.
  const [available, setAvailable] = useState<ChordCount[]>([]);
  const [chordsLoading, setChordsLoading] = useState(false);

  const [results, setResults] = useState<CatalogSong[]>([]);
  const [total, setTotal] = useState<number | null>(null);   // matches, not rows rendered
  // Playability is scored here, not in SQL (it depends on the user's swap history),
  // so that sort works off a bounded pool of the most popular matches. `poolCapped`
  // says so out loud rather than pretending the whole catalog was ranked.
  const [ranked, setRanked] = useState<CatalogSong[]>([]);
  const [poolCapped, setPoolCapped] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pickerSong, setPickerSong] = useState<string | null>(null);
  const [editingSong, setEditingSong] = useState<string | null>(null);

  const PAGE = 50;
  const POOL = 1000; // playability candidates (most popular matches) — the cap is shown

  // Audio-feature filter values (parsed) shared by search + load-more.
  const audioOpts = {
    tempoMin: f.tempoMin ? Number(f.tempoMin) : undefined,
    tempoMax: f.tempoMax ? Number(f.tempoMax) : undefined,
    key: f.key !== '' ? Number(f.key) : undefined,
    mode: f.mode !== '' ? Number(f.mode) : undefined,
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

  const byBase = useMemo(() => repertoireByBase(repertoire), [repertoire]);

  // Debounced (re)search whenever filters change. Only runs once the catalog is ready.
  // Two paths: SQL can order by popularity/title/artist itself, but playability is a
  // function of the user's swap history, so that sort pulls a bounded pool of matches
  // WITH their progressions and ranks them here.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const opts = { text, genre, known: knownArr, level, onlyPlayable, excludeChords: excludeArr, sort, ...audioOpts };
      try {
        if (sort === 'playability') {
          const { songs: rows, total } = await pool({ ...opts, poolLimit: POOL });
          if (cancelled) return;
          const scored = rows
            .map(row => {
              // Priming the shared analysis cache means each card's transition strip
              // reuses this progression instead of re-querying the worker for it.
              const { transitions } = primeAnalysis(row.id, row.progression);
              return { row, score: playability(transitions, row.tempo, byBase, swaps) };
            })
            // A song with no usable transitions can't be ranked — send it to the back.
            .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
            .map(x => x.row as CatalogSong);
          setRanked(scored);
          setResults(scored.slice(0, PAGE));
          setHasMore(scored.length > PAGE);
          setTotal(total);
          setPoolCapped(total > rows.length);
        } else {
          const [{ songs: rows, hasMore }, n] = await Promise.all([
            search({ ...opts, limit: PAGE, offset: 0 }),
            count(opts),
          ]);
          if (cancelled) return;
          setRanked([]);
          setPoolCapped(false);
          setResults(rows);
          setHasMore(hasMore);
          setTotal(n);
        }
      } catch (err) {
        console.error('BROWSE search error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, text, genre, onlyPlayable, level, sort, knownArr.join('|'), excludeKey, f.tempoMin, f.tempoMax, f.key, f.mode, swaps, byBase]);

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
  }, [ready, text, genre, onlyPlayable, level, knownArr.join('|'), f.tempoMin, f.tempoMax, f.key, f.mode]);

  async function loadMore() {
    if (sort === 'playability') {
      const next = ranked.slice(0, results.length + PAGE);
      setResults(next);
      setHasMore(ranked.length > next.length);
      return;
    }
    setLoading(true);
    try {
      const { songs: rows, hasMore } = await search({
        text, genre, known: knownArr, level, onlyPlayable, excludeChords: excludeArr, sort, limit: PAGE, offset: results.length, ...audioOpts,
      });
      setResults(prev => [...prev, ...rows]);
      setHasMore(hasMore);
    } finally { setLoading(false); }
  }

  // A catalog row that the user has already saved renders from the SAVED song
  // (catalog cache ⊕ user overlay), so Browse shows their edited chords, notes and
  // attachments — the card is identical to the one on My songs, data included.
  const savedByRef = useMemo(
    () => new Map(songs.map(s => {
      const ref = s.ref ?? songRefOf(s);
      return [ref, mergeSong(s, overlays[ref])] as const;
    })),
    [songs, overlays],
  );

  return (
    <div>

      {status.phase !== 'ready' && <CatalogLoader status={status} />}

      {ready && (
        <>
          <SongFilterBar
            api={api}
            genres={status.genres}
            chords={available}
            chordsLoading={chordsLoading}
            knownSet={knownSet}
            count={total}
            countNote={poolCapped ? `ranking top ${POOL.toLocaleString()}` : undefined}
          />

          <div className="col" style={{ gap: 12, marginTop: 12 }}>
            {results.length === 0 && !loading && <div className="card"><p className="muted">No matches.</p></div>}
            {results.map(s => {
              const saved = savedByRef.get(songRefOf(s));
              return (
                <SongCard
                  key={s.id}
                  song={saved ? cardFromSong(saved) : cardFromCatalog(s)}
                  knownSet={knownSet}
                  level={level}
                  playlistCount={saved ? playlists.filter(p => p.songIds.includes(saved.id)).length : 0}
                  // Editing or choosing playlists materializes the catalog row into
                  // reps.songs first — that is what "adding" a song means here.
                  onEdit={() => { const id = saveCatalogSong(s); ensureInDefaultPlaylist(id); setEditingSong(id); }}
                  onPlaylists={() => { const id = saveCatalogSong(s); ensureInDefaultPlaylist(id); setPickerSong(id); }}
                  ensureSaved={() => { const id = saveCatalogSong(s); ensureInDefaultPlaylist(id); return id; }}
                />
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
