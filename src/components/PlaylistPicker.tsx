import { useMemo, useState } from 'react';
import { IconAdd } from './icons';
import { usePlaylists, useSongs, deleteSongEverywhere, setSongPlaylists, DEFAULT_PLAYLIST_ID } from '../state/store';
import { Modal } from './Modal';

// Which playlists a song is in. Edits are a DRAFT — nothing is written until Apply,
// because the same dialog is also the only way to remove a song (a song lives as long
// as it's in at least one playlist), and a live-committing checkbox that can delete
// the song on the third click is not something you want to undo by re-adding it.
//
// Clearing every box is therefore a deliberate, labelled action: Apply turns into
// "Remove song" and says so.
export function PlaylistPicker({ songId, onClose }: { songId: string; onClose: () => void }) {
  const [playlists] = usePlaylists();
  const [songs] = useSongs();
  const [newName, setNewName] = useState('');

  const title = songs.find(s => s.id === songId)?.title ?? 'this song';

  // Draft state: ids of existing playlists that will contain the song, plus playlists
  // that don't exist yet and get created on Apply.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(playlists.filter(p => p.songIds.includes(songId)).map(p => p.id)),
  );
  const [pending, setPending] = useState<string[]>([]);

  const initial = useMemo(
    () => playlists.filter(p => p.songIds.includes(songId)).map(p => p.id).sort().join('|'),
    [playlists, songId],
  );
  const dirty = pending.length > 0 || [...checked].sort().join('|') !== initial;
  const emptied = checked.size === 0 && pending.length === 0;

  const toggle = (pid: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  });

  function stageNew() {
    const name = newName.trim();
    if (!name) return;
    setPending(prev => [...prev, name]);
    setNewName('');
  }

  function apply() {
    if (emptied) {
      deleteSongEverywhere(songId);
      onClose();
      return;
    }
    // Committed through the store helper, not the hook setter: this component
    // unmounts on the same tick and would lose a deferred write.
    setSongPlaylists(songId, [...checked], pending);
    onClose();
  }

  // Default playlist first, then the rest.
  const ordered = [...playlists].sort((a, b) =>
    a.id === DEFAULT_PLAYLIST_ID ? -1 : b.id === DEFAULT_PLAYLIST_ID ? 1 : a.createdAt - b.createdAt);

  return (
    <Modal onClose={onClose} width={460}>
      <div className="row">
        <h2 style={{ marginTop: 0 }}>Playlists</h2>
        <span className="muted" style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
      </div>

      <div className="col" style={{ gap: 8 }}>
        {ordered.map(p => {
          const on = checked.has(p.id);
          const was = p.songIds.includes(songId);
          return (
            <label key={p.id} className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
              <span style={{ fontWeight: p.id === DEFAULT_PLAYLIST_ID ? 800 : 700 }}>{p.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {p.songIds.length + (on && !was ? 1 : !on && was ? -1 : 0)} songs
              </span>
            </label>
          );
        })}

        {pending.map((name, i) => (
          <label key={`new-${i}`} className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked readOnly onChange={() => setPending(prev => prev.filter((_, j) => j !== i))} />
            <span style={{ fontWeight: 700 }}>{name}</span>
            <span className="muted" style={{ fontSize: 12 }}>new</span>
          </label>
        ))}
      </div>

      <div className="row" style={{ gap: 6, marginTop: 12 }}>
        <input type="text" value={newName} placeholder="New playlist name"
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); stageNew(); } }}
          style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, flex: 1 }} />
        <button className="button" onClick={stageNew} disabled={!newName.trim()}><IconAdd /> New</button>
      </div>

      <div className="rule" style={{ margin: '14px 0 12px' }} />

      <div className="row" style={{ gap: 8 }}>
        <div className="spacer" />
        <button className="button" onClick={onClose}>Cancel</button>
        {emptied ? (
          <button className="button danger" onClick={apply}
            title="This song is in no playlist any more, so applying removes it from your songs">
            Remove song
          </button>
        ) : (
          <button className="button primary" onClick={apply} disabled={!dirty}>Apply</button>
        )}
      </div>
    </Modal>
  );
}
