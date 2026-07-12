import { useEffect, useRef, useState } from 'react';
import { usePlaylists, deleteSongEverywhere, DEFAULT_PLAYLIST_ID } from '../state/store';

// Modal to manage which playlists a song is in (checkbox style). A song must be in at
// least one playlist to stay "added" — unchecking the last one removes it entirely.
export function PlaylistPicker({ songId, onClose }: { songId: string; onClose: () => void }) {
  const [playlists, setPlaylists] = usePlaylists();
  const [newName, setNewName] = useState('');
  const touched = useRef(false);

  // Once the user has interacted, if the song ends up in no playlist, remove it.
  useEffect(() => {
    if (touched.current && !playlists.some(p => p.songIds.includes(songId))) {
      deleteSongEverywhere(songId);
      onClose();
    }
  }, [playlists, songId, onClose]);

  function toggle(pid: string) {
    touched.current = true;
    setPlaylists(prev => prev.map(p => {
      if (p.id !== pid) return p;
      const has = p.songIds.includes(songId);
      return { ...p, songIds: has ? p.songIds.filter(i => i !== songId) : [...p.songIds, songId] };
    }));
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    touched.current = true;
    const id = `pl-${Date.now().toString(36)}`;
    setPlaylists(prev => [...prev, { id, name, songIds: [songId], createdAt: Date.now() }]);
    setNewName('');
  }

  // Default playlist first, then the rest.
  const ordered = [...playlists].sort((a, b) =>
    a.id === DEFAULT_PLAYLIST_ID ? -1 : b.id === DEFAULT_PLAYLIST_ID ? 1 : a.createdAt - b.createdAt);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ marginTop: 0 }}>Playlists</h2>
          <div className="spacer" />
          <button className="button" onClick={onClose}>Close</button>
        </div>

        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Uncheck every playlist to remove the song.</p>

        <div className="col" style={{ gap: 8 }}>
          {ordered.map(p => (
            <label key={p.id} className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" checked={p.songIds.includes(songId)} onChange={() => toggle(p.id)} />
              <span style={{ fontWeight: p.id === DEFAULT_PLAYLIST_ID ? 800 : 700 }}>{p.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{p.songIds.length} songs</span>
            </label>
          ))}
        </div>

        <div className="row" style={{ gap: 6, marginTop: 12 }}>
          <input type="text" value={newName} placeholder="New playlist name"
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, flex: 1 }} />
          <button className="button primary" onClick={create} disabled={!newName.trim()}>＋ New</button>
        </div>
      </div>
    </div>
  );
}
