// Modal editor for a materialized song (reps.songs). Opened by the pen button on
// both Browse and the Songs (playlists) page. Lets the user fix title/artist/chords,
// add a link/notes, and attach a chord-sheet PDF + mp3. Songs that came from the seed
// catalog can be reset with "Restore original".
import { useState } from 'react';
import { useSongs, useRepertoire, deleteSongEverywhere, updateSong, type Song } from '../state/store';
import { getCatalogSongById } from '../data/catalogDb';
import { catalogIdOf } from '../data/songTransitions';
import { AttachmentField, resolveAttachment, type AttachmentDraft } from './AttachmentField';

export function SongEditor({ songId, onClose }: { songId: string; onClose: () => void }) {
  const [songs] = useSongs();
  const [repertoire] = useRepertoire();
  const song = songs.find(s => s.id === songId);

  const [title, setTitle] = useState(song?.title ?? '');
  const [artist, setArtist] = useState(song?.artist ?? '');
  const [url, setUrl] = useState(song?.url ?? '');
  const [notes, setNotes] = useState(song?.notes ?? '');
  const [chords, setChords] = useState<string[]>(song?.chords ?? []);
  const [newChord, setNewChord] = useState('');
  const [sheetDraft, setSheetDraft] = useState<AttachmentDraft>({ type: 'keep' });
  const [audioDraft, setAudioDraft] = useState<AttachmentDraft>({ type: 'keep' });
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  if (!song) return null;
  const catalogId = catalogIdOf(song);

  function addChord(raw: string) {
    const v = raw.trim();
    if (!v) return;
    setChords(prev => [...prev, v]);
    setNewChord('');
  }
  const removeAt = (i: number) => setChords(prev => prev.filter((_, idx) => idx !== i));
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= chords.length) return;
    const next = [...chords];
    [next[i], next[j]] = [next[j], next[i]];
    setChords(next);
  }

  async function restoreOriginal() {
    if (catalogId == null || restoring) return;
    setRestoring(true);
    try {
      const orig = await getCatalogSongById(catalogId);
      if (orig) {
        setTitle(orig.title);
        setArtist(orig.artist);
        setChords(orig.chords);
      }
    } finally {
      setRestoring(false);
    }
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || !song || saving) return;
    setSaving(true);
    try {
      const sheet = await resolveAttachment(sheetDraft, song.sheet);
      const audio = await resolveAttachment(audioDraft, song.audio);
      const updated: Song = {
        ...song,
        title: trimmed,
        artist: artist.trim(),
        chords,
        url: url.trim() || undefined,
        notes: notes.trim() || undefined,
        sheet,
        audio,
      };
      updateSong(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    if (!song) return;
    if (!confirm('Delete this song? This removes it from all playlists and deletes any uploaded files.')) return;
    deleteSongEverywhere(song.id);
    onClose();
  }

  const inRep = new Set(chords.map(c => c.toLowerCase()));
  const unusedFromRep = repertoire.filter(c => !inRep.has(c.name.toLowerCase()) && !inRep.has(c.id.toLowerCase()));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="row">
          <h2 style={{ marginTop: 0 }}>Edit {song.title}</h2>
          <div className="spacer" />
          {catalogId != null && (
            <button className="button" onClick={restoreOriginal} disabled={restoring}
              title="Reset title, artist and chords to the catalog's original values">
              {restoring ? 'Restoring…' : '↺ Restore original'}
            </button>
          )}
          <button className="button" onClick={onClose}>Close</button>
        </div>

        <div className="col" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 4 }}>
            Title
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }} />
          </label>
          <label className="col" style={{ gap: 4 }}>
            Artist
            <input type="text" value={artist} onChange={e => setArtist(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }} />
          </label>
          <label className="col" style={{ gap: 4 }}>
            Link (Chordify, YouTube, etc.)
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://chordify.net/..."
              style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8 }} />
          </label>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Chords</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {chords.length === 0 && <span className="muted">No chords yet.</span>}
              {chords.map((ch, i) => (
                <span key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 999,
                  background: 'var(--ink)', color: '#fff', fontWeight: 700, fontSize: 13,
                }}>
                  <button onClick={() => move(i, -1)} disabled={i === 0} title="Move left"
                    style={{ all: 'unset', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.4 : 1 }}>←</button>
                  {ch}
                  <button onClick={() => move(i, 1)} disabled={i === chords.length - 1} title="Move right"
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
                style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, flex: 1 }} />
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
              style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', resize: 'vertical' }} />
          </label>

          <AttachmentField label="Chord sheet (PDF)" accept="application/pdf,.pdf"
            existing={song.sheet} draft={sheetDraft} onChange={setSheetDraft} />
          <AttachmentField label="Audio (mp3)" accept="audio/*,.mp3"
            existing={song.audio} draft={audioDraft} onChange={setAudioDraft} />
        </div>

        <div className="footer-bar">
          <button className="button primary big" onClick={submit} disabled={!title.trim() || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button className="button" onClick={onClose}>Cancel</button>
          <div className="spacer" />
          <button className="button danger" onClick={remove}>Delete</button>
        </div>
      </div>
    </div>
  );
}
