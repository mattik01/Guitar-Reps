import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconExternal, IconSheet, SpotifyMark, YouTubeMark } from './icons';
import { setSongOverlay, type Attachment } from '../state/store';
import type { MatchLevel } from '../data/chordNormalize';
import { objectUrl } from '../data/fileStore';
import { resolveAttachment } from './AttachmentField';
import { songMeta, type CardSong } from '../data/songResolve';
import { SongTransitions } from './SongTransitions';
import { ChordChip } from './ChordView';
import { AlbumArt } from './AlbumArt';
import { EditButton } from './EditButton';
import { IconButton } from './IconButton';
import { IconAddToPlaylist, IconPlaylists } from './icons';

const ART_PX = 28 * 2 + 6; // .icon-btn height ×2 + the column's gap

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

// The song's chord list rendered as chips. Tiering (owned / library / unknown) and
// the click-through to the chord view live in ChordChip — this only lays them out.
export function ChordChips({ chords, knownSet, level, leading, empty }: {
  chords: string[];
  knownSet: Set<string>;
  level: MatchLevel;
  /** A control that belongs in front of the chords (the sheet button). */
  leading?: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {leading}
      {chords.length === 0 && (empty ?? <span className="muted">No chords set</span>)}
      {chords.map((ch, i) => <ChordChip key={i} chordId={ch} knownSet={knownSet} level={level} />)}
    </div>
  );
}

// The service links wear the app's icon-button chrome (same square as the edit and
// playlist buttons) with the brand mark inside — a link should look like the other
// controls on the card, while the logo stays recognisably itself.
function ServiceLink({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  return (
    <a className="icon-btn" href={href} target="_blank" rel="noreferrer" title={title} aria-label={title}>
      {children}
    </a>
  );
}

// The chord sheet, in front of the chords: it IS the thing you read while playing
// them. Wears the transition strip's language — dashed and muted when there's
// nothing yet (an invitation, like an untrained change), solid once a sheet exists.
// One click either opens the PDF or picks one; there is no in-between screen.
function SheetButton({ has, onOpen, onPick }: {
  has: boolean; onOpen: () => void; onPick: () => void;
}) {
  return (
    <button
      onClick={has ? onOpen : onPick}
      title={has ? 'Open the chord sheet' : 'Add a chord sheet (PDF)'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
        fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap',
        background: 'transparent',
        color: has ? 'var(--good)' : 'var(--muted)',
        border: has ? '1.5px solid var(--good)' : '1px dashed var(--line)',
      }}>
      <IconSheet size={13} /> Sheet
    </button>
  );
}

/**
 * THE way a song is displayed anywhere in the app. Browse and My songs render this
 * same component from the same `CardSong` shape (see src/data/songResolve.ts), so a
 * song looks and behaves identically on both — the pages only supply the data and
 * the two callbacks. Anything cross-cutting (key, cover art, service links, the
 * transition strip) is written once here and appears on every surface at once.
 *
 * Layout: the edit button in the card corner (it edits the whole song, not the title), then
 *   [art][YouTube · Spotify] · [Title / artist · genre · BPM · key] ······ [Playlists]
 */
export function SongCard({ song, knownSet, level, playlistCount, onEdit, onPlaylists, ensureSaved }: {
  song: CardSong;
  knownSet: Set<string>;
  level: MatchLevel;
  /** How many playlists the song is in. 0 = not in your songs yet → the button invites. */
  playlistCount: number;
  onEdit: () => void;
  onPlaylists: () => void;
  /** Materialize the song into reps.songs if it isn't there yet (Browse), so an
      attachment has something to hang off. Returns its id. */
  ensureSaved: () => string;
}) {
  const sheetUrl = useAttachmentUrl(song.sheet);
  const audioUrl = useAttachmentUrl(song.audio);
  const filePicker = useRef<HTMLInputElement>(null);

  async function attachSheet(file: File) {
    ensureSaved();
    const sheet = await resolveAttachment({ type: 'file', file, name: file.name, mime: file.type }, song.sheet);
    setSongOverlay(song.ref, { sheet });
  }

  // Exact video when the catalog has one (96% of songs), else a YouTube search — so
  // every song is one click from something to play along to.
  const youtubeHref = song.youtubeId
    ? `https://www.youtube.com/watch?v=${song.youtubeId}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.artist} ${song.title}`)}`;
  const inPlaylists = playlistCount > 0;

  return (
    <div className="card" style={{ position: 'relative' }}>
      {/* In the card's own corner rather than beside the title: it edits the whole
          song — chords, sheet, audio, notes — not just its name. */}
      <EditButton onClick={onEdit}
        title="Edit this song — chords, sheet, audio, notes"
        label={`Edit ${song.title}`}
        style={{ position: 'absolute', top: 5, left: 5, zIndex: 1 }} />

      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        {/* Sized to the service-button column beside it (two 28px .icon-btn + the
            6px gap), so art and buttons share the same top and bottom edge. */}
        <AlbumArt spotifyId={song.spotifyId} artUrl={song.artUrl} size={ART_PX} />

        <div className="col" style={{ gap: 6, flex: '0 0 auto' }}>
          <ServiceLink href={youtubeHref}
            title={song.youtubeId ? 'Play on YouTube' : 'Search YouTube for this song'}>
            <YouTubeMark />
          </ServiceLink>
          {song.spotifyId && (
            <ServiceLink href={`https://open.spotify.com/track/${song.spotifyId}`} title="Open on Spotify">
              <SpotifyMark />
            </ServiceLink>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{song.title}</div>
          <div className="muted">{songMeta(song)}</div>
        </div>

        <div className="spacer" />

        {song.url && <a className="button small" href={song.url} target="_blank" rel="noreferrer" title="Your own link for this song">
          <IconExternal size={14} /> Link
        </a>}

        {/* One control for membership everywhere, wearing the same shell as the edit
            button: the count as a badge once the song is in your songs, an accented
            "add to playlist" while it isn't (clicking adds it and opens the picker). */}
        <IconButton onClick={onPlaylists}
          badge={inPlaylists ? playlistCount : undefined}
          tone={inPlaylists ? 'default' : 'accent'}
          label={inPlaylists ? 'Playlists' : 'Add to a playlist'}
          title={inPlaylists
            ? `In ${playlistCount} playlist${playlistCount > 1 ? 's' : ''} — click to change, or to remove the song`
            : 'Add this song to a playlist'}>
          {inPlaylists ? <IconPlaylists /> : <IconAddToPlaylist />}
        </IconButton>
      </div>

      <ChordChips chords={song.chords} knownSet={knownSet} level={level}
        leading={
          <>
            <SheetButton
              has={!!song.sheet && !!sheetUrl}
              onOpen={() => sheetUrl && window.open(sheetUrl, '_blank', 'noopener')}
              onPick={() => filePicker.current?.click()} />
            <input ref={filePicker} type="file" accept="application/pdf,.pdf" hidden
              onChange={e => {
                const f = e.target.files?.[0];
                e.target.value = ''; // so picking the same file twice still fires
                if (f) attachSheet(f).catch(err => console.error('sheet upload failed:', err));
              }} />
          </>
        } />

      <SongTransitions catalogId={song.catalogId} tempo={song.tempo} chords={song.chords}
        knownSet={knownSet} level={level} />

      {song.audio && (
        <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {audioUrl
            ? <audio controls src={audioUrl} style={{ height: 34, maxWidth: '100%' }} />
            : <span className="muted" style={{ fontSize: 13 }}>Loading audio…</span>}
        </div>
      )}

      {song.notes && <p className="muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{song.notes}</p>}
    </div>
  );
}
