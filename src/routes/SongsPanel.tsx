import { useEffect, useMemo, useState } from 'react';
import { IconAdd, IconCollapsed, IconExpanded, IconImport, SpotifyMark, YouTubeMark } from '../components/icons';
import {
  usePlaylists, useSongs, useSongOverlays, useRepertoire, useSwapRecords,
  mergeSong, migrateSongsToRefs, resolveAndRefreshSongs, type Song,
} from '../state/store';
import { useCatalog } from '../data/catalogDb';
import { knownSetAtLevel, isKnown, parseChord, normalizeToLevel, type MatchLevel } from '../data/chordNormalize';
import { importSpotifyPlaylist, parsePlaylistId, type ImportResult } from '../data/spotifyImport';
import { importYoutubePlaylist, parseYoutubePlaylistId } from '../data/youtubeImport';
import { SongCard } from '../components/SongCard';
import { cardFromSong } from '../data/songResolve';
import { SongEditor } from '../components/SongEditor';
import { PlaylistPicker } from '../components/PlaylistPicker';
import { SongFilterBar, useSongFilters, type SongFilters } from '../components/SongFilters';
import { Modal } from '../components/Modal';
import { cachedAnalysis, loadAnalysis } from '../data/songAnalysis';
import { playability, repertoireByBase } from '../data/songTransitions';
import { catalogIdOf } from '../data/songTransitions';

export default function SongsPanel() {
  const [playlists, setPlaylists] = usePlaylists();
  const [songs] = useSongs();
  const [overlays] = useSongOverlays();
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();

  // Cheap, catalog-independent: stamp refs + move inline edits into overlays so display
  // can merge them. (The heavier live catalog resolve is gated on having songs below.)
  useEffect(() => { migrateSongsToRefs(); }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [pickerSong, setPickerSong] = useState<string | null>(null);
  const [editingSong, setEditingSong] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // The same filter element Browse uses. It shapes the songs INSIDE each playlist —
  // the playlists themselves keep their own order, so the page doesn't reshuffle
  // under you while you're filtering.
  const api = useSongFilters();
  const { f, level } = api;

  const knownSet = useMemo(
    () => knownSetAtLevel(repertoire.flatMap(c => [c.name, c.id]), level),
    [repertoire, level],
  );
  // Display = catalog cache ⊕ user overlay, keyed by song id for playlist lookup.
  const songById = useMemo(
    () => new Map(songs.map(s => [s.id, mergeSong(s, s.ref ? overlays[s.ref] : undefined)])),
    [songs, overlays],
  );

  // Playability is a function of the user's swap history, not of the song, so it is
  // scored here from each song's cached analysis. Songs whose progression isn't in
  // the cache yet are fetched once, then this re-runs.
  const byBase = useMemo(() => repertoireByBase(repertoire), [repertoire]);
  const [scoreTick, setScoreTick] = useState(0);
  useEffect(() => {
    if (f.sort !== 'playability') return;
    let cancelled = false;
    const missing = songs
      .map(s => catalogIdOf(s))
      .filter((id): id is number => id != null && cachedAnalysis(id) == null);
    if (missing.length === 0) return;
    Promise.all(missing.map(loadAnalysis)).then(() => { if (!cancelled) setScoreTick(t => t + 1); });
    return () => { cancelled = true; };
  }, [f.sort, songs]);

  const scoreOf = useMemo(() => {
    const cache = new Map<string, number>();
    return (s: Song): number => {
      const hit = cache.get(s.id);
      if (hit != null) return hit;
      const id = catalogIdOf(s);
      const analysis = id == null ? null : cachedAnalysis(id);
      const score = playability(analysis?.transitions ?? [], s.tempo ?? null, byBase, swaps) ?? -1;
      cache.set(s.id, score);
      return score;
    };
    // scoreTick: analyses that arrived after the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byBase, swaps, scoreTick]);

  const matches = useMemo(() => songMatcher(f, knownSet, level), [f, knownSet, level]);

  /** A playlist's songs, filtered and ordered by the bar. */
  function songsOf(playlistId: string): Song[] {
    const p = playlists.find(x => x.id === playlistId);
    if (!p) return [];
    const list = p.songIds
      .map(id => songById.get(id))
      .filter((s): s is Song => !!s && matches(s));
    return sortSongs(list, f.sort, scoreOf);
  }

  // How many songs match right now, counted once per song even when it sits in
  // several playlists — that is the number the bar reports.
  const matchCount = useMemo(() => {
    const inAPlaylist = new Set(playlists.flatMap(p => p.songIds));
    let n = 0;
    for (const id of inAPlaylist) {
      const s = songById.get(id);
      if (s && matches(s)) n++;
    }
    return n;
  }, [playlists, songById, matches]);

  // The chord toggle list + genre list, derived from the songs the user actually has.
  const { chordCounts, genres } = useMemo(() => {
    const chords = new Map<string, number>();
    const genreSet = new Set<string>();
    for (const s of songById.values()) {
      if (s.genre) genreSet.add(s.genre);
      const seen = new Set<string>();
      for (const ch of s.chords) {
        const p = parseChord(ch);
        const token = p.ok ? normalizeToLevel(ch, level) : ch;
        if (seen.has(token)) continue;
        seen.add(token);
        chords.set(token, (chords.get(token) ?? 0) + 1);
      }
    }
    return {
      chordCounts: [...chords.entries()]
        .map(([chord, n]) => ({ chord, n }))
        .sort((a, b) => b.n - a.n || a.chord.localeCompare(b.chord)),
      genres: [...genreSet].sort(),
    };
  }, [songById, level]);

  function create(name: string) {
    const id = `pl-${Date.now().toString(36)}`;
    setPlaylists(prev => [...prev, { id, name, songIds: [], createdAt: Date.now() }]);
    setSelectedId(id);
    setCreating(false);
  }

  function del(id: string) {
    if (!confirm('Delete this playlist? (Songs stay in your Songs list.)')) return;
    setPlaylists(prev => prev.filter(p => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function commitRename(id: string) {
    const name = renameVal.trim();
    if (name) setPlaylists(prev => prev.map(p => (p.id === id ? { ...p, name } : p)));
    setRenamingId(null);
  }

  return (
    <div>
      <SongFilterBar
        api={api}
        genres={genres}
        chords={chordCounts}
        knownSet={knownSet}
        count={matchCount}
        leading={
          <>
            <button className="button small" onClick={() => setCreating(true)}
              title="Create an empty playlist">
              <IconAdd size={14} /> New playlist
            </button>
            <button className="button small" onClick={() => setImportOpen(true)}
              title="Import a Spotify or YouTube playlist">
              <IconImport size={14} /> Import playlist
              <YouTubeMark size={14} /><SpotifyMark size={14} />
            </button>
          </>
        }
      />

      {playlists.length === 0 && (
        <div className="card" style={{ marginTop: 12 }}><p className="muted">No playlists yet.</p></div>
      )}

      <div className="col" style={{ gap: 8, marginTop: 12 }}>
        {playlists.map(p => {
          const shown = selectedId === p.id ? songsOf(p.id) : [];
          const matching = p.songIds.reduce((n, id) => {
            const s = songById.get(id);
            return n + (s && matches(s) ? 1 : 0);
          }, 0);
          const filtered = matching < p.songIds.length;
          return (
            <div key={p.id} className="card" style={{ padding: '10px 12px' }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                {renamingId === p.id ? (
                  <input autoFocus type="text" value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(p.id); if (e.key === 'Escape') setRenamingId(null); }}
                    onBlur={() => commitRename(p.id)}
                    style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 8, flex: 1 }} />
                ) : (
                  <button className="button" style={{ all: 'unset', cursor: 'pointer', fontWeight: 800, fontSize: 17 }}
                    onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}>
                    {selectedId === p.id ? <IconExpanded size={14} /> : <IconCollapsed size={14} />} {p.name}
                  </button>
                )}
                <span className="muted" style={{ fontSize: 13 }}
                  title={filtered ? 'Matching the current filters / total in this playlist' : undefined}>
                  {filtered ? `${matching} of ${p.songIds.length}` : `${p.songIds.length} songs`}
                </span>
                <div className="spacer" />
                <button className="button small"
                  onClick={() => { setRenamingId(p.id); setRenameVal(p.name); }}>Rename</button>
                <button className="button small danger" onClick={() => del(p.id)}>Delete</button>
              </div>

              {selectedId === p.id && (
                <div className="col" style={{ gap: 12, marginTop: 12 }}>
                  {shown.length === 0 && (
                    <p className="muted" style={{ margin: 0 }}>
                      {p.songIds.length === 0 ? 'Empty.' : 'Nothing here matches the filters.'}
                    </p>
                  )}
                  {shown.map(s => (
                    <SongCard key={s.id} song={cardFromSong(s)} knownSet={knownSet} level={level}
                      playlistCount={playlists.filter(pl => pl.songIds.includes(s.id)).length}
                      onEdit={() => setEditingSong(s.id)}
                      onPlaylists={() => setPickerSong(s.id)}
                      ensureSaved={() => s.id} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Only load the catalog (and re-resolve songs against it) when there ARE songs —
          so opening an empty Songs page never triggers the catalog download. */}
      {songs.length > 0 && <SongCatalogResync />}

      {creating && <NewPlaylistModal onCreate={create} onClose={() => setCreating(false)} />}
      {importOpen && <ImportModal onDone={id => { setSelectedId(id); }} onClose={() => setImportOpen(false)} />}
      {pickerSong && <PlaylistPicker songId={pickerSong} onClose={() => setPickerSong(null)} />}
      {editingSong && <SongEditor songId={editingSong} onClose={() => setEditingSong(null)} />}
    </div>
  );
}

// --- filtering + ordering ----------------------------------------------------

/** The bar's filters as a predicate over a saved song. */
function songMatcher(f: SongFilters, knownSet: Set<string>, level: MatchLevel) {
  const text = f.text.trim().toLowerCase();
  const genre = f.genre.trim().toLowerCase();
  const tempoMin = f.tempoMin ? Number(f.tempoMin) : null;
  const tempoMax = f.tempoMax ? Number(f.tempoMax) : null;
  const key = f.key === '' ? null : Number(f.key);
  const mode = f.mode === '' ? null : Number(f.mode);

  return (s: Song): boolean => {
    if (text && !`${s.title} ${s.artist}`.toLowerCase().includes(text)) return false;
    if (genre && !(s.genre ?? '').toLowerCase().includes(genre)) return false;
    if (tempoMin != null && !(s.tempo != null && s.tempo >= tempoMin)) return false;
    if (tempoMax != null && !(s.tempo != null && s.tempo <= tempoMax)) return false;
    if (key != null && s.key !== key) return false;
    if (mode != null && s.mode !== mode) return false;
    if (f.onlyPlayable && !(s.chords.length > 0 && s.chords.every(ch => isKnown(ch, knownSet, level)))) return false;
    if (f.excluded.size > 0 && s.chords.some(ch => f.excluded.has(normalizeToLevel(ch, level)))) return false;
    return true;
  };
}

function sortSongs(list: Song[], sort: SongFilters['sort'], scoreOf: (s: Song) => number): Song[] {
  const out = [...list];
  switch (sort) {
    case 'title': return out.sort((a, b) => a.title.localeCompare(b.title));
    case 'artist': return out.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    case 'playability': return out.sort((a, b) => scoreOf(b) - scoreOf(a));
    default: return out.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  }
}

// --- the two dialogs ---------------------------------------------------------

function NewPlaylistModal({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Modal onClose={onClose} width={420}>
      <h2 style={{ marginTop: 0 }}>New playlist</h2>
      <input autoFocus type="text" value={name} placeholder="Playlist name"
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { e.preventDefault(); onCreate(name.trim()); } }}
        style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, width: '100%' }} />
      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <div className="spacer" />
        <button className="button" onClick={onClose}>Cancel</button>
        <button className="button primary" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>Create</button>
      </div>
    </Modal>
  );
}

// One link field, two buttons — the service is the user's choice, not something
// inferred silently, and each button says exactly what it will do.
function ImportModal({ onDone, onClose }: { onDone: (playlistId: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<(ImportResult & { matchedExact?: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSpotify = !!parsePlaylistId(url);
  const canYoutube = /youtu\.?be/i.test(url) && !!parseYoutubePlaylistId(url);

  async function run(source: 'spotify' | 'youtube') {
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const r = source === 'youtube'
        ? await importYoutubePlaylist(url, setStatus)
        : await importSpotifyPlaylist(url, setStatus);
      setResult(r);
      setUrl('');
      onDone(r.playlistId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setStatus(null);
    }
  }

  return (
    <Modal onClose={onClose} width={520}>
      <h2 style={{ marginTop: 0 }}>Import a playlist</h2>
      <input autoFocus type="text" value={url} placeholder="Paste a Spotify or YouTube playlist link…"
        onChange={e => setUrl(e.target.value)} disabled={importing}
        style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, width: '100%' }} />

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="button" onClick={() => run('spotify')} disabled={importing || !canSpotify}
          title="Every track we know chords for is added to a playlist named after the source. Re-importing merges new tracks in. The source playlist must be public.">
          <IconImport /> Import from Spotify
        </button>
        <button className="button" onClick={() => run('youtube')} disabled={importing || !canYoutube}
          title="Matched by video id where possible, else by title and artist. The source playlist must be public.">
          <IconImport /> Import from YouTube
        </button>
        <div className="spacer" />
        <button className="button" onClick={onClose}>{result ? 'Done' : 'Cancel'}</button>
      </div>

      {status && <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>{status}</p>}
      {error && <p style={{ marginTop: 10, marginBottom: 0, color: 'var(--bad)' }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}>
            Imported <strong>{result.playlistName}</strong>: matched {result.matched} of {result.total} tracks
            {result.added < result.matched ? ` (${result.added} new, the rest were already there)` : ''}.
            {result.matchedExact != null && (
              <span className="muted"> {result.matchedExact} matched exactly by video id.</span>
            )}
          </p>
          {result.unmatched.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
                {result.unmatched.length} tracks not in the chord catalog
              </summary>
              <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 13 }}>
                {result.unmatched.map((t, i) => <li key={i}>{t.title} — {t.artist}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

// Loads the catalog and, once ready, re-resolves saved songs by their stable ref to
// refresh cached catalogId/tempo/chords (which go stale when a rebuild renumbers rows).
// Rendered only when songs exist, so it never forces the catalog download otherwise.
function SongCatalogResync() {
  const { status } = useCatalog();
  useEffect(() => {
    if (status.phase !== 'ready') return;
    migrateSongsToRefs();
    resolveAndRefreshSongs().catch((err: unknown) => console.error('song resync failed:', err));
  }, [status.phase]);
  return null;
}
