// The one place that normalizes the app's two song representations — a saved
// `reps.songs` entry (⊕ its user overlay) and a raw catalog row — into the single
// shape SongCard renders. The song counterpart of chordResolve's cardFrom* adapters,
// and the reason a song looks and behaves identically in Browse and in My songs:
// the pages differ in where the data comes from, never in what the card does with it.
import { songRefOf, type Attachment, type Song } from '../state/store';
import type { CatalogSong } from './catalogDb';
import { catalogIdOf } from './songTransitions';

export type CardSong = {
  /** reps.songs id when the song is saved; null for a catalog row you haven't added. */
  savedId: string | null;
  /** Stable identity (songRefOf) — the key user edits are stored under. */
  ref: string;
  title: string;
  artist: string;
  genre: string | null;
  chords: string[];
  catalogId: number | null;
  tempo: number | null;
  key: number | null;   // 0..11 pitch class, -1/null = undetected
  mode: number | null;  // 1 major, 0 minor
  spotifyId: string | null;
  artUrl: string | null;
  youtubeId: string | null;
  url?: string;         // the user's own link, from the overlay
  notes?: string;
  sheet?: Attachment;
  audio?: Attachment;
};

/** Pitch-class names, index = the catalog's `key` column (also the Browse key filter). */
export const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** "B♭ major", or null when the catalog has no key for this song. */
export function keyLabel(key: number | null | undefined, mode: number | null | undefined): string | null {
  if (key == null || key < 0) return null;
  return `${KEY_NAMES[key]}${mode == null ? '' : mode === 0 ? ' minor' : ' major'}`;
}

/** The card's one muted line: "Ed Sheeran · pop · 79 BPM · C major". */
export function songMeta(s: CardSong): string {
  const parts = [s.artist || '—'];
  if (s.genre) parts.push(s.genre);
  if (s.tempo) parts.push(`${Math.round(s.tempo)} BPM`);
  const k = keyLabel(s.key, s.mode);
  if (k) parts.push(k);
  return parts.join(' · ');
}

/** A saved song — pass it through mergeSong(cache, overlay) first. */
export function cardFromSong(s: Song): CardSong {
  return {
    savedId: s.id,
    ref: s.ref ?? songRefOf(s),
    title: s.title,
    artist: s.artist,
    genre: s.genre ?? null,
    chords: s.chords,
    catalogId: catalogIdOf(s),
    tempo: s.tempo ?? null,
    key: s.key ?? null,
    mode: s.mode ?? null,
    spotifyId: s.spotifyId ?? null,
    artUrl: s.artUrl ?? null,
    youtubeId: s.youtubeId ?? null,
    url: s.url,
    notes: s.notes,
    sheet: s.sheet,
    audio: s.audio,
  };
}

/** A catalog row the user hasn't saved (no attachments, notes or link of their own). */
export function cardFromCatalog(cs: CatalogSong): CardSong {
  return {
    savedId: null,
    ref: songRefOf(cs),
    title: cs.title,
    artist: cs.artist,
    genre: cs.genre,
    chords: cs.chords,
    catalogId: cs.id,
    tempo: cs.tempo,
    key: cs.key,
    mode: cs.mode,
    spotifyId: cs.spotifyId,
    artUrl: cs.artUrl,
    youtubeId: cs.youtubeId,
  };
}
