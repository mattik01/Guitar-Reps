import { useEffect, useMemo, useState } from 'react';
import { usePlaylists, useSongs, useSongOverlays, useRepertoire, mergeSong, migrateSongsToRefs, resolveAndRefreshSongs } from '../state/store';
import { useCatalog } from '../data/catalogDb';
import { knownSetAtLevel, isKnown, type MatchLevel } from '../data/chordNormalize';
import { importSpotifyPlaylist, parsePlaylistId, type ImportResult } from '../data/spotifyImport';
import { importYoutubePlaylist, parseYoutubePlaylistId } from '../data/youtubeImport';
import { SongCard } from '../components/SongCard';
import { SongEditor } from '../components/SongEditor';
import { PlaylistPicker } from '../components/PlaylistPicker';

export default function Playlists() {
  const [playlists, setPlaylists] = usePlaylists();
  const [songs] = useSongs();
  const [overlays] = useSongOverlays();
  const [repertoire] = useRepertoire();

  // Cheap, catalog-independent: stamp refs + move inline edits into overlays so display
  // can merge them. (The heavier live catalog resolve is gated on having songs below.)
  useEffect(() => { migrateSongsToRefs(); }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [pickerSong, setPickerSong] = useState<string | null>(null);
  const [editingSong, setEditingSong] = useState<string | null>(null);

  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<(ImportResult & { matchedExact?: number }) | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [onlyPlayable, setOnlyPlayable] = useState(false);
  const [strict, setStrict] = useState(false); // false = lenient (base), true = exact
  const level: MatchLevel = strict ? 'exact' : 'base';

  const knownSet = useMemo(
    () => knownSetAtLevel(repertoire.flatMap(c => [c.name, c.id]), level),
    [repertoire, level],
  );
  // Display = catalog cache ⊕ user overlay, keyed by song id for playlist lookup.
  const songById = useMemo(
    () => new Map(songs.map(s => [s.id, mergeSong(s, s.ref ? overlays[s.ref] : undefined)])),
    [songs, overlays],
  );
  const selected = playlists.find(p => p.id === selectedId) ?? null;

  const playable = (s: { chords: string[] }) =>
    s.chords.length > 0 && s.chords.every(ch => isKnown(ch, knownSet, level));

  function create() {
    const name = newName.trim();
    if (!name) return;
    const id = `pl-${Date.now().toString(36)}`;
    setPlaylists(prev => [...prev, { id, name, songIds: [], createdAt: Date.now() }]);
    setNewName('');
    setSelectedId(id);
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

  function removeFromPlaylist(pid: string, sid: string) {
    setPlaylists(prev => prev.map(p => (p.id === pid ? { ...p, songIds: p.songIds.filter(i => i !== sid) } : p)));
  }

  // One input for both services; the link shape decides which importer runs.
  function importSource(url: string): 'spotify' | 'youtube' | null {
    if (parsePlaylistId(url)) return 'spotify';
    if (/youtu\.?be/i.test(url) && parseYoutubePlaylistId(url)) return 'youtube';
    return null;
  }

  async function runImport() {
    const source = importSource(importUrl);
    if (!source) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = source === 'youtube'
        ? await importYoutubePlaylist(importUrl, setImportStatus)
        : await importSpotifyPlaylist(importUrl, setImportStatus);
      setImportResult(result);
      setImportUrl('');
      setSelectedId(result.playlistId);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setImportStatus(null);
    }
  }

  const allSelectedSongs = selected
    ? selected.songIds.map(id => songById.get(id)).filter((s): s is NonNullable<typeof s> => !!s)
    : [];
  const selectedSongs = onlyPlayable ? allSelectedSongs.filter(playable) : allSelectedSongs;
  const hiddenCount = allSelectedSongs.length - selectedSongs.length;

  return (
    <div>
      <div className="row">
        <h1>Songs</h1>
        <div className="spacer" />
      </div>
      <p className="muted">Your songs, grouped into playlists. Add them from the <strong>Browse</strong> catalog or import a Spotify or YouTube playlist below.</p>

      <div className="card">
        <div className="row" style={{ gap: 6 }}>
          <input type="text" value={newName} placeholder="New playlist name"
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, flex: 1 }} />
          <button className="button primary" onClick={create} disabled={!newName.trim()}>＋ Create playlist</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 6 }}>
          <input type="text" value={importUrl} placeholder="Paste a Spotify or YouTube playlist link…"
            onChange={e => setImportUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !importing && importSource(importUrl)) { e.preventDefault(); runImport(); } }}
            disabled={importing}
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, flex: 1 }} />
          <button className="button primary" onClick={runImport} disabled={importing || !importSource(importUrl)}>
            {importing ? 'Importing…' : importSource(importUrl) === 'youtube' ? '⬇ Import from YouTube' : '⬇ Import from Spotify'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontSize: 13 }}>
          Every track we know chords for gets added to a playlist named after the source playlist.
          Re-importing merges new tracks into it. (The playlist must be public.)
        </p>
        {importStatus && <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>{importStatus}</p>}
        {importError && <p style={{ marginTop: 8, marginBottom: 0, color: '#b02020' }}>{importError}</p>}
        {importResult && (
          <div style={{ marginTop: 8 }}>
            <p style={{ margin: 0 }}>
              Imported <strong>{importResult.playlistName}</strong>: matched {importResult.matched} of {importResult.total} tracks
              {importResult.added < importResult.matched ? ` (${importResult.added} new, the rest were already there)` : ''}.
              {importResult.matchedExact != null && (
                <span className="muted"> {importResult.matchedExact} matched exactly by video id.</span>
              )}
            </p>
            {importResult.unmatched.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
                  {importResult.unmatched.length} tracks not in the chord catalog
                </summary>
                <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 13 }}>
                  {importResult.unmatched.map((t, i) => <li key={i}>{t.title} — {t.artist}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {playlists.length === 0 && (
        <div className="card"><p className="muted">No playlists yet. Create one above, then add songs from the <strong>Browse</strong> catalog.</p></div>
      )}

      {playlists.length > 0 && (
        <div className="row" style={{ gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
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
      )}

      <div className="col" style={{ gap: 8, marginTop: 12 }}>
        {playlists.map(p => (
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
                  {selectedId === p.id ? '▾ ' : '▸ '}{p.name}
                </button>
              )}
              <span className="muted" style={{ fontSize: 13 }}>
                {p.songIds.length} songs
                {onlyPlayable && ` · ${p.songIds.filter(id => { const s = songById.get(id); return s && playable(s); }).length} playable`}
              </span>
              <div className="spacer" />
              <button className="button" style={{ padding: '2px 8px', fontSize: 12 }}
                onClick={() => { setRenamingId(p.id); setRenameVal(p.name); }}>Rename</button>
              <button className="button danger" style={{ padding: '2px 8px', fontSize: 12 }}
                onClick={() => del(p.id)}>Delete</button>
            </div>

            {selectedId === p.id && (
              <div className="col" style={{ gap: 12, marginTop: 12 }}>
                {allSelectedSongs.length === 0 && (
                  <p className="muted">Empty. Add songs from the <strong>Browse</strong> catalog.</p>
                )}
                {hiddenCount > 0 && (
                  <p className="muted" style={{ margin: 0 }}>
                    {hiddenCount} {hiddenCount === 1 ? 'song' : 'songs'} hidden — chords you don't know yet.
                  </p>
                )}
                {selectedSongs.map(s => (
                  <SongCard key={s.id} song={s} knownSet={knownSet} level={level}
                    actions={
                      <>
                        <button className="button" title="Edit" onClick={() => setEditingSong(s.id)}>✏️</button>
                        <button className="button" onClick={() => setPickerSong(s.id)}>＋ Playlist</button>
                        <button className="button" onClick={() => removeFromPlaylist(p.id, s.id)}>Remove</button>
                      </>
                    } />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Only load the catalog (and re-resolve songs against it) when there ARE songs —
          so opening an empty Songs page never triggers the catalog download. */}
      {songs.length > 0 && <SongCatalogResync />}

      {pickerSong && <PlaylistPicker songId={pickerSong} onClose={() => setPickerSong(null)} />}
      {editingSong && <SongEditor songId={editingSong} onClose={() => setEditingSong(null)} />}
    </div>
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
