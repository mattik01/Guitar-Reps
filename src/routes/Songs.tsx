import { useMemo, useState } from 'react';
import { useRepertoire, useSongs, type Song } from '../state/store';

export default function Songs() {
  const [songs, setSongs] = useSongs();
  const [repertoire] = useRepertoire();
  const [editing, setEditing] = useState<Song | null>(null);
  const [adding, setAdding] = useState(false);

  const repertoireIds = useMemo(() => new Set(repertoire.map(c => c.id)), [repertoire]);
  const repertoireByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of repertoire) {
      m.set(c.name.toLowerCase(), c.id);
      m.set(c.id.toLowerCase(), c.id);
    }
    return m;
  }, [repertoire]);

  function isKnown(chord: string): boolean {
    return repertoireIds.has(chord) || repertoireByName.has(chord.toLowerCase());
  }

  function save(song: Song) {
    setSongs(prev => {
      const idx = prev.findIndex(s => s.id === song.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = song;
        return next;
      }
      return [...prev, song];
    });
    setEditing(null);
    setAdding(false);
  }

  function remove(id: string) {
    if (!confirm('Delete this song?')) return;
    setSongs(prev => prev.filter(s => s.id !== id));
    setEditing(null);
  }

  const sorted = [...songs].sort((a, b) => b.addedAt - a.addedAt);

  return (
    <div>
      <div className="row">
        <h1>Songs</h1>
        <div className="spacer" />
        <button className="button primary" onClick={() => { setAdding(true); setEditing(null); }}>
          + Add song
        </button>
      </div>
      <p className="muted">Track songs you want to play along with (Chordify, YouTube, etc.). Chips are green for chords you know, grey for ones you still need to learn.</p>

      {adding && (
        <SongForm
          repertoire={repertoire}
          onSave={save}
          onCancel={() => setAdding(false)}
        />
      )}

      {songs.length === 0 && !adding && (
        <div className="card">
          <p>No songs yet. Click <strong>+ Add song</strong> above to start — try <em>Born in the U.S.A.</em> (Springsteen) or <em>Dance the Night Away</em> (The Mavericks).</p>
        </div>
      )}

      <div className="col" style={{ gap: 12, marginTop: 12 }}>
        {sorted.map(s => (
          editing?.id === s.id ? (
            <SongForm key={s.id} song={s} repertoire={repertoire} onSave={save} onCancel={() => setEditing(null)} onDelete={() => remove(s.id)} />
          ) : (
            <div key={s.id} className="card">
              <div className="row">
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{s.title}</div>
                  <div className="muted">{s.artist || '—'}</div>
                </div>
                <div className="spacer" />
                {s.url && (
                  <a className="button" href={s.url} target="_blank" rel="noreferrer">
                    Open link ↗
                  </a>
                )}
                <button className="button" onClick={() => setEditing(s)}>✏️ Edit</button>
              </div>
              <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                {s.chords.length === 0 && <span className="muted">No chords set</span>}
                {s.chords.map((ch, i) => {
                  const known = isKnown(ch);
                  return (
                    <span key={i} style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: known ? 'var(--good)' : 'transparent',
                      color: known ? '#fff' : 'var(--muted)',
                      border: known ? '1px solid var(--good)' : '1px dashed var(--line)',
                      fontWeight: 700,
                      fontSize: 13,
                    }}>
                      {ch}
                    </span>
                  );
                })}
              </div>
              {s.notes && <p className="muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{s.notes}</p>}
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function SongForm({ song, repertoire, onSave, onCancel, onDelete }: {
  song?: Song;
  repertoire: { id: string; name: string }[];
  onSave: (s: Song) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(song?.title ?? '');
  const [artist, setArtist] = useState(song?.artist ?? '');
  const [url, setUrl] = useState(song?.url ?? '');
  const [notes, setNotes] = useState(song?.notes ?? '');
  const [chords, setChords] = useState<string[]>(song?.chords ?? []);
  const [newChord, setNewChord] = useState('');

  function addChord(raw: string) {
    const v = raw.trim();
    if (!v) return;
    setChords(prev => [...prev, v]);
    setNewChord('');
  }

  function removeAt(i: number) {
    setChords(prev => prev.filter((_, idx) => idx !== i));
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= chords.length) return;
    const next = [...chords];
    [next[i], next[j]] = [next[j], next[i]];
    setChords(next);
  }

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSave({
      id: song?.id ?? `song-${Date.now().toString(36)}`,
      title: trimmed,
      artist: artist.trim(),
      chords,
      url: url.trim() || undefined,
      notes: notes.trim() || undefined,
      addedAt: song?.addedAt ?? Date.now(),
    });
  }

  const inRep = new Set(chords.map(c => c.toLowerCase()));
  const unusedFromRep = repertoire.filter(c => !inRep.has(c.name.toLowerCase()) && !inRep.has(c.id.toLowerCase()));

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{song ? `Edit ${song.title}` : 'New song'}</h3>
      <div className="col" style={{ gap: 10 }}>
        <label className="col" style={{ gap: 4 }}>
          Title
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Born in the U.S.A."
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }}
          />
        </label>
        <label className="col" style={{ gap: 4 }}>
          Artist
          <input type="text" value={artist} onChange={e => setArtist(e.target.value)} placeholder="Bruce Springsteen"
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }}
          />
        </label>
        <label className="col" style={{ gap: 4 }}>
          Link (Chordify, YouTube, etc.)
          <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://chordify.net/..."
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }}
          />
        </label>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Chords</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {chords.length === 0 && <span className="muted">No chords yet.</span>}
            {chords.map((ch, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 999,
                background: 'var(--ink)', color: '#fff',
                fontWeight: 700, fontSize: 13,
              }}>
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  title="Move left"
                  style={{ all: 'unset', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.4 : 1 }}>←</button>
                {ch}
                <button onClick={() => move(i, 1)} disabled={i === chords.length - 1}
                  title="Move right"
                  style={{ all: 'unset', cursor: i === chords.length - 1 ? 'default' : 'pointer', opacity: i === chords.length - 1 ? 0.4 : 1 }}>→</button>
                <button onClick={() => removeAt(i)} title="Remove"
                  style={{ all: 'unset', cursor: 'pointer', marginLeft: 4 }}>✕</button>
              </span>
            ))}
          </div>

          <div className="row" style={{ gap: 6 }}>
            <input type="text" value={newChord} onChange={e => setNewChord(e.target.value)}
              placeholder="Type a chord name (e.g. B7)"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChord(newChord); } }}
              style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, flex: 1 }}
            />
            <button className="button" onClick={() => addChord(newChord)} disabled={!newChord.trim()}>Add</button>
          </div>

          {unusedFromRep.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>From your repertoire:</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {unusedFromRep.map(c => (
                  <button key={c.id} className="button" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => addChord(c.name)}>
                    + {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <label className="col" style={{ gap: 4 }}>
          Notes
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="Capo, strumming pattern, tempo..."
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </label>
      </div>

      <div className="footer-bar">
        <button className="button primary big" onClick={submit} disabled={!title.trim()}>
          {song ? 'Save changes' : 'Save song'}
        </button>
        <button className="button" onClick={onCancel}>Cancel</button>
        <div className="spacer" />
        {onDelete && <button className="button danger" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}
