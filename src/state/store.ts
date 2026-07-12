import { useCallback, useEffect, useState } from 'react';
import type { ChordCategoryId } from '../data/chordCategories';
import type { CatalogSong } from '../data/catalogDb';
import { deleteFile } from '../data/fileStore';
// Value import from audio/chroma is safe: chroma.ts only imports TYPES from
// this module, so there is no runtime cycle.
import { CAL_MAX_SAMPLES, type CalSample } from '../audio/chroma';

export type FingerMark = 1 | 2 | 3 | 4 | 'T' | null;

export type ChordShape = {
  frets: (number | 'x')[];
  fingers: FingerMark[];
  baseFret?: number;
  // `label` overrides the text shown on the bar (e.g. "1/3" when either finger works);
  // defaults to the finger at fromIndex.
  barre?: { fromIndex: number; toIndex: number; fret: number; label?: string } | null;
};

// One accepted way to finger a chord. A chord may have several (all sounding the
// same notes); library chords list them most-popular first.
export type Fingering = {
  shape: ChordShape;
  label?: string; // short description, e.g. "2-3-4 (frees index)"
};

export type Chord = {
  id: string;
  name: string;
  shape: ChordShape;
  category?: ChordCategoryId; // which chord category it belongs to
  difficulty?: number;        // 1–10 (higher = harder to fret)
  importance?: number;        // 1–10 (higher = more essential to learn)
  info?: string;              // short description of sound/use (may be empty)
  learnedAt: number;
  perfectReps: number;
};

export type SwapAttempt = { count: number; at: number };

export type SwapRecord = {
  pairKey: string;
  chordA: string;
  chordB: string;
  bestCount: number;
  lastCount: number;
  attempts: number;
  lastAt: number;
  history: SwapAttempt[];
};

export type RoutineKind = 'chord' | 'swap' | 'strum';

export type RoutineLog = {
  at: number;
  kind: RoutineKind;
  chordId?: string;
  pairKey?: string;
  swapCount?: number;
  perfectReps?: number;
  progressionId?: string;
  durationMs?: number;
};

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function read<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return initial;
    return JSON.parse(raw) as T;
  } catch {
    return initial;
  }
}

function writeStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
  listeners.get(key)?.forEach(l => l());
}

function subscribe(key: string, l: Listener) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(l);
  return () => { set!.delete(l); };
}

export function useLocalStore<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => read(key, initial));

  useEffect(() => {
    return subscribe(key, () => setValue(read(key, initial)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      writeStorage(key, next);
      return next;
    });
  }, [key]);

  return [value, set] as const;
}

// A per-song file: either bytes stored in-app (IndexedDB, see src/data/fileStore.ts)
// or an external link the user pasted.
export type Attachment =
  | { kind: 'file'; fileId: string; name: string; mime: string; size: number }
  | { kind: 'link'; url: string; name?: string };

export type Song = {
  id: string;
  title: string;
  artist: string;
  chords: string[];
  url?: string;
  notes?: string;
  addedAt: number;
  // Optional metadata, populated when a song originates from the seeded catalog.
  genre?: string;
  lang?: string;
  popularity?: number;
  spotifyId?: string; // reserved for a future Spotify-linked catalog
  catalogId?: number; // row id in the seed catalog, so the full progression can be fetched back
  tempo?: number;     // BPM (audio feature), used to grade chord-transition speed targets
  source?: 'seed' | 'user';
  // User attachments (found by the user themselves): a chord-sheet PDF and an mp3.
  sheet?: Attachment;
  audio?: Attachment;
};

export type Playlist = {
  id: string;
  name: string;
  songIds: string[]; // references reps.songs ids
  createdAt: number;
};

// The always-present default playlist. A song is considered "added" when it's in at
// least one playlist; new adds land here by default. It's auto-created on first use —
// the user never has to make it.
export const DEFAULT_PLAYLIST_ID = 'default';
export const DEFAULT_PLAYLIST_NAME = 'Songs';

// A user's edits to a *catalog* song, keyed by catalog song id (see useSongOverlays).
// Stored separately so the read-only seed catalog is never mutated — re-downloading
// or upgrading the catalog never clobbers these edits.
export type SongOverlay = {
  title?: string;
  artist?: string;
  chords?: string[]; // corrected chord list (e.g. matched to a sheet the user found)
  url?: string;
  notes?: string;
  saved?: boolean;   // user explicitly saved this catalog song into their collection
  updatedAt: number;
};

// One entry in the `reps.roadmap` map. Keyed by roadmap item id (done/note) or by
// level id (playlistUrl) — item ids and level ids never collide.
export type RoadmapEntry = { done?: boolean; note?: string; playlistUrl?: string; updatedAt?: number };

export const useRepertoire = () => useLocalStore<Chord[]>('reps.repertoire', []);
export const useSwapRecords = () => useLocalStore<Record<string, SwapRecord>>('reps.swaps', {});
export const useRoutineLog = () => useLocalStore<RoutineLog[]>('reps.routineLog', []);
export const useSongs = () => useLocalStore<Song[]>('reps.songs', []);
export const usePlaylists = () => useLocalStore<Playlist[]>('reps.playlists', []);
// Per-catalog-song user edits, keyed by catalog song id. Never touches the seed DB.
export const useSongOverlays = () => useLocalStore<Record<string, SongOverlay>>('reps.songOverlays', {});
export const useRoadmapProgress = () => useLocalStore<Record<string, RoadmapEntry>>('reps.roadmap', {});
// Watched state for the JustinGuitar videos linked into the roadmap, keyed by
// YouTube video id (an 11-char id never collides with a roadmap item/level id).
export const useWatchedVideos = () => useLocalStore<Record<string, boolean>>('reps.roadmapVideos', {});
// Microphone-assisted detection (swap counter + quiz auto-reveal). Opt-in.
// `calibrate`: collect per-chord calibration samples during exercises — the
// user promises clean playing and a quiet room while it's on.
export type MicSettings = { enabled: boolean; calibrate?: boolean };
export const useMicSettings = () => useLocalStore<MicSettings>('reps.micSettings', { enabled: false, calibrate: false });
// Per-chord mic auto-calibration: similarities of strums confirmed as correct
// (quiz "✓ Got it" / swap confident classifications), each weighted by how
// clean the strum was. Keyed by chord id; calibratedThresholds() in
// src/audio/chroma.ts turns these into thresholds.
export type MicCalibration = Record<string, { sims: CalSample[]; updatedAt: number }>;
export const useMicCalibration = () => useLocalStore<MicCalibration>('reps.micCalibration', {});
// Append one cleanliness-weighted sample (weight from calSampleWeight — callers
// skip recording entirely when it returns null). writeStorage notifies all
// subscribed components, so hook users stay in sync.
export function recordCalibrationSample(chordId: string, sim: number, weight: number) {
  const cal = read<MicCalibration>('reps.micCalibration', {});
  const prev = cal[chordId]?.sims ?? [];
  writeStorage('reps.micCalibration', {
    ...cal,
    [chordId]: { sims: [...prev, { s: sim, w: weight }].slice(-CAL_MAX_SAMPLES), updatedAt: Date.now() },
  });
}
// A chord's samples describe its SHAPE — drop them when the shape is edited.
export function clearMicCalibration(chordId: string) {
  const cal = read<MicCalibration>('reps.micCalibration', {});
  if (!(chordId in cal)) return;
  const next = { ...cal };
  delete next[chordId];
  writeStorage('reps.micCalibration', next);
}

// Delete a song and every reference to it: removes it from reps.songs, strips its id
// from all playlists, and deletes any uploaded attachment blobs. Keeps stores
// consistent (no orphaned playlist ids or IndexedDB files). Uses writeStorage so all
// subscribed components re-render.
export function deleteSongEverywhere(id: string) {
  const songs = read<Song[]>('reps.songs', []);
  const song = songs.find(s => s.id === id);
  writeStorage('reps.songs', songs.filter(s => s.id !== id));

  const playlists = read<Playlist[]>('reps.playlists', []);
  let changed = false;
  const next = playlists.map(p => {
    if (!p.songIds.includes(id)) return p;
    changed = true;
    return { ...p, songIds: p.songIds.filter(sid => sid !== id) };
  });
  if (changed) writeStorage('reps.playlists', next);

  for (const att of [song?.sheet, song?.audio]) {
    if (att && att.kind === 'file') deleteFile(att.fileId).catch(() => {});
  }
}

// Persist edits to a materialized song. Non-hook (writeStorage notifies subscribers)
// so an editor can update-then-close in the same tick: a component's own useLocalStore
// setter would lose the write if the component unmounts before React flushes it.
export function updateSong(song: Song) {
  const songs = read<Song[]>('reps.songs', []);
  writeStorage('reps.songs', songs.map(s => (s.id === song.id ? song : s)));
}

// Add a song to the default playlist (creating it if needed). Used so every "added"
// song is in at least one playlist.
export function ensureInDefaultPlaylist(songId: string) {
  const list = read<Playlist[]>('reps.playlists', []);
  let next = list.some(p => p.id === DEFAULT_PLAYLIST_ID)
    ? list
    : [{ id: DEFAULT_PLAYLIST_ID, name: DEFAULT_PLAYLIST_NAME, songIds: [], createdAt: Date.now() }, ...list];
  next = next.map(p =>
    p.id === DEFAULT_PLAYLIST_ID && !p.songIds.includes(songId)
      ? { ...p, songIds: [...p.songIds, songId] }
      : p);
  writeStorage('reps.playlists', next);
}
// Materialize a catalog song into reps.songs and return its id. Idempotent: an
// existing entry with the same spotify id or the same title+artist is reused.
// Non-hook so import flows can call it in a loop; writeStorage notifies
// subscribed components.
export function saveCatalogSong(cs: CatalogSong): string {
  const songs = read<Song[]>('reps.songs', []);
  const key = `${cs.title} ${cs.artist}`.toLowerCase();
  const existing = songs.find(s =>
    (cs.spotifyId && s.spotifyId === cs.spotifyId) || `${s.title} ${s.artist}`.toLowerCase() === key);
  if (existing) return existing.id;
  const id = `song-${Date.now().toString(36)}-${cs.id}`;
  writeStorage('reps.songs', [...songs, {
    id,
    title: cs.title,
    artist: cs.artist,
    chords: cs.chords,
    genre: cs.genre ?? undefined,
    popularity: cs.popularity ?? undefined,
    spotifyId: cs.spotifyId ?? undefined,
    catalogId: cs.id,
    tempo: cs.tempo ?? undefined,
    source: 'seed' as const,
    addedAt: Date.now(),
  }]);
  return id;
}

// Add songs to the playlist with this name (case-insensitive), creating it if
// needed. Used by Spotify import; re-importing the same playlist merges into the
// existing one instead of duplicating it.
export function addSongsToNamedPlaylist(name: string, songIds: string[]): { playlistId: string; added: number } {
  const list = read<Playlist[]>('reps.playlists', []);
  const existing = list.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!existing) {
    const id = `pl-${Date.now().toString(36)}`;
    writeStorage('reps.playlists', [...list, { id, name, songIds: [...new Set(songIds)], createdAt: Date.now() }]);
    return { playlistId: id, added: new Set(songIds).size };
  }
  const missing = [...new Set(songIds)].filter(id => !existing.songIds.includes(id));
  if (missing.length) {
    writeStorage('reps.playlists', list.map(p =>
      p.id === existing.id ? { ...p, songIds: [...p.songIds, ...missing] } : p));
  }
  return { playlistId: existing.id, added: missing.length };
}

// Persisted per-chord fingering choice: chord id → index into its fingerings[].
export const useFingeringChoice = () => useLocalStore<Record<string, number>>('reps.fingeringChoice', {});
