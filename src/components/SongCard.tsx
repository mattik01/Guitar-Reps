import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import type { Song, Attachment } from '../state/store';
import { isKnown as isKnownAt, type MatchLevel } from '../data/chordNormalize';
import { objectUrl } from '../data/fileStore';
import { SongTransitions } from './SongTransitions';
import { catalogIdOf } from '../data/songTransitions';

export function chipStyle(known: boolean): CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 999,
    background: known ? 'var(--good)' : 'transparent',
    color: known ? '#fff' : 'var(--muted)',
    border: known ? '1px solid var(--good)' : '1px dashed var(--line)',
    fontWeight: 700,
    fontSize: 13,
  };
}

// Resolve an attachment to a usable URL: links pass through; file attachments get a
// blob object URL from IndexedDB that is revoked on change/unmount.
function useAttachmentUrl(att?: Attachment): string | null {
  const key = att ? (att.kind === 'file' ? 'f:' + att.fileId : 'l:' + att.url) : '';
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!att) { setUrl(null); return; }
    if (att.kind === 'link') { setUrl(att.url); return; }
    let made: string | null = null;
    let cancelled = false;
    objectUrl(att.fileId).then(u => {
      if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
      made = u;
      setUrl(u);
    });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); setUrl(null); };
  }, [key]);
  return url;
}

export function SongCard({ song, knownSet, level, actions }: {
  song: Song;
  knownSet: Set<string>;
  level: MatchLevel;
  actions?: ReactNode; // buttons for the header row (Edit, Playlist, Remove…)
}) {
  const sheetUrl = useAttachmentUrl(song.sheet);
  const audioUrl = useAttachmentUrl(song.audio);

  return (
    <div className="card">
      <div className="row">
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{song.title}</div>
          <div className="muted">{song.artist || '—'}{song.genre ? ` · ${song.genre}` : ''}</div>
        </div>
        <div className="spacer" />
        {song.url && (
          <a className="button" href={song.url} target="_blank" rel="noreferrer">Open link ↗</a>
        )}
        {actions}
      </div>

      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
        {song.chords.length === 0 && <span className="muted">No chords set</span>}
        {song.chords.map((ch, i) => (
          <span key={i} style={chipStyle(isKnownAt(ch, knownSet, level))}>{ch}</span>
        ))}
      </div>

      <SongTransitions catalogId={catalogIdOf(song)} tempo={song.tempo ?? null} />

      {(song.sheet || song.audio) && (
        <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {song.sheet && sheetUrl && (
            <a className="button" href={sheetUrl} target="_blank" rel="noreferrer">📄 View sheet</a>
          )}
          {song.audio && (
            audioUrl
              ? <audio controls src={audioUrl} style={{ height: 34, maxWidth: '100%' }} />
              : <span className="muted" style={{ fontSize: 13 }}>Loading audio…</span>
          )}
        </div>
      )}

      {song.notes && <p className="muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{song.notes}</p>}
    </div>
  );
}
