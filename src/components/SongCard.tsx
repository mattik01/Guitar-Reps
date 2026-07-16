import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Song, Attachment } from '../state/store';
import { isKnown as isKnownAt, type MatchLevel } from '../data/chordNormalize';
import { libraryChordById } from '../data/chordLibrary';
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

// The song's chord list rendered as chips, in three visual tiers: green when the
// chord is in your repertoire; grey/dashed when it's a library chord you haven't
// learned yet; grey/dotted with a "?" when it isn't in the library at all (clicking
// it will have you register the shape yourself). `leading` slots a control before the
// chips (e.g. Browse's expand-sequence toggle); `empty` overrides the placeholder.
// Every chip is clickable → the Chord quiz for that chord.
export function ChordChips({ chords, knownSet, level, leading, empty }: {
  chords: string[];
  knownSet: Set<string>;
  level: MatchLevel;
  leading?: ReactNode;
  empty?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {leading}
      {chords.length === 0 && (empty ?? <span className="muted">No chords set</span>)}
      {chords.map((ch, i) => {
        const known = isKnownAt(ch, knownSet, level);
        const unlibraried = !known && !libraryChordById(ch); // not owned AND not in the library
        const go = () => navigate(`/routine/quiz?chord=${encodeURIComponent(ch)}`);
        const style: CSSProperties = { ...chipStyle(known), cursor: 'pointer' };
        if (unlibraried) style.border = '1px dotted var(--muted)';
        return (
          <span key={i} role="button" tabIndex={0} onClick={go}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}
            title={unlibraried
              ? `${ch} isn't in the chord library — you'll register the shape yourself`
              : `Quiz yourself on ${ch}`}
            style={style}>
            {ch}
            {unlibraried && <sup style={{ marginLeft: 2, fontSize: 10, fontWeight: 800, opacity: 0.85 }}>?</sup>}
          </span>
        );
      })}
    </div>
  );
}

// The shared visual shell for a song card, wherever it appears (a saved song in
// Playlists, a catalog row in Browse). It owns the common skeleton — card frame,
// header row (optional art · title/subtitle · actions), chord-chip row, and the
// transition strip — while every context-specific part is a slot: `art`,
// `subtitle`, `actions`, `chordsLeading`, and `children` (extra body content).
export function SongCardShell({
  art, title, subtitle, actions, chords, knownSet, level, chordsLeading, catalogId, tempo, children,
}: {
  art?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  chords: string[];
  knownSet: Set<string>;
  level: MatchLevel;
  chordsLeading?: ReactNode;
  catalogId: number | null;
  tempo: number | null | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 10 }}>
        {art}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{title}</div>
          {subtitle != null && <div className="muted">{subtitle}</div>}
        </div>
        <div className="spacer" />
        {actions}
      </div>

      <ChordChips chords={chords} knownSet={knownSet} level={level} leading={chordsLeading} />

      <SongTransitions catalogId={catalogId} tempo={tempo} chords={chords} />

      {children}
    </div>
  );
}

// A saved song (reps.songs). Wraps SongCardShell with the Song-specific bits:
// an "Open link" action plus a body of attachments (sheet/audio) and notes.
export function SongCard({ song, knownSet, level, actions }: {
  song: Song;
  knownSet: Set<string>;
  level: MatchLevel;
  actions?: ReactNode; // buttons for the header row (Edit, Playlist, Remove…)
}) {
  const sheetUrl = useAttachmentUrl(song.sheet);
  const audioUrl = useAttachmentUrl(song.audio);

  return (
    <SongCardShell
      title={song.title}
      subtitle={`${song.artist || '—'}${song.genre ? ` · ${song.genre}` : ''}`}
      actions={
        <>
          {song.url && (
            <a className="button" href={song.url} target="_blank" rel="noreferrer">Open link ↗</a>
          )}
          {actions}
        </>
      }
      chords={song.chords}
      knownSet={knownSet}
      level={level}
      catalogId={catalogIdOf(song)}
      tempo={song.tempo ?? null}
    >
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
    </SongCardShell>
  );
}
