import { useCallback, useEffect, useState } from 'react';
import type { ChordCategoryId } from '../data/chordCategories';
import { matchCatalogTracks, type CatalogSong } from '../data/catalogDb';
import { deleteFile } from '../data/fileStore';
// Value import from audio/chroma is safe: chroma.ts only imports TYPES from
// this module, so there is no runtime cycle.
import { CAL_SAMPLE_CAP } from '../audio/chroma';

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

export type SwapAttempt = {
  count: number;         // what the user saved — the truth for scoring
  at: number;
  // What the microphone counted for the same minute, when it was counting
  // (absent for hand-counted rounds and for every attempt logged before
  // 2026-08-21). Recorded ALWAYS, even when it agrees, so the mic's error can
  // be measured over real sessions instead of recalled — `count - micCount` is
  // the detector's signed error for that round. Never used for scoring.
  micCount?: number;
};

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

export type RoutineKind = 'chord' | 'swap' | 'strum' | 'pick';

export type RoutineLog = {
  at: number;
  kind: RoutineKind;
  chordId?: string;
  pairKey?: string;
  swapCount?: number;
  perfectReps?: number;
  progressionId?: string;
  exerciseId?: string;
  bpm?: number;
  clean?: boolean;
  durationMs?: number;
};

// Picking practice. The truth is SELF-REPORTED ("clean at this tempo?"), the way
// the quiz's "got it" is — the mic cannot yet verify individual picks well enough
// to be believed (docs/pick-detection.md), and a wrong automatic verdict is worse
// than no verdict. The number that means something is therefore the fastest tempo
// you have played a pattern cleanly, which is exactly what improves with reps.
export type PickAttempt = {
  at: number;
  bpm: number;
  clean: boolean;
  chordIds: string[];
  passes: number;        // completed passes of the pattern
};

export type PickRecord = {
  patternId: string;
  bestCleanBpm: number;  // 0 until the first clean run
  lastBpm: number;
  attempts: number;
  lastAt: number;
  history: PickAttempt[];
};

// A progression the user built by hand and kept. Named from its own chords, so
// saving takes one click and never opens a naming dialog.
export type SavedProgression = {
  id: string;
  name: string;
  chordIds: string[];
  at: number;
};

export function savePickProgression(chordIds: string[]): void {
  if (chordIds.length < 2) return;
  const all = read<SavedProgression[]>('reps.pickProgressions', []);
  const key = chordIds.join(',');
  if (all.some(p => p.chordIds.join(',') === key)) return;   // already kept
  const at = Date.now();
  all.push({ id: `saved-${at}`, name: progressionName(chordIds), chordIds, at });
  writeStorage('reps.pickProgressions', all);
}

export function deletePickProgression(id: string): void {
  const all = read<SavedProgression[]>('reps.pickProgressions', []);
  writeStorage('reps.pickProgressions', all.filter(p => p.id !== id));
}

/** Chords are the name — six of them, then an ellipsis. */
export function progressionName(chordIds: string[]): string {
  const head = chordIds.slice(0, 6).join(' → ');
  return chordIds.length > 6 ? `${head} …` : head;
}

export const PICK_HISTORY_MAX = 20;

/**
 * Record one picking attempt. A plain function, not a hook setter: like the
 * other mutators here it may be called from a screen that unmounts immediately
 * after (see the writeStorage deferral note below).
 */
export function recordPickAttempt(
  patternId: string,
  attempt: PickAttempt,
): void {
  const all = read<Record<string, PickRecord>>('reps.pickRecords', {});
  const prev = all[patternId];
  const history = [...(prev?.history ?? []), attempt].slice(-PICK_HISTORY_MAX);
  all[patternId] = {
    patternId,
    bestCleanBpm: attempt.clean
      ? Math.max(prev?.bestCleanBpm ?? 0, attempt.bpm)
      : prev?.bestCleanBpm ?? 0,
    lastBpm: attempt.bpm,
    attempts: (prev?.attempts ?? 0) + 1,
    lastAt: attempt.at,
    history,
  };
  writeStorage('reps.pickRecords', all);
}

/**
 * Drop one attempt from an exercise's ledger — the escape hatch for a run the
 * detector mis-scored, which is data you can't practise your way out of.
 *
 * The derived numbers are recomputed rather than blindly decremented, with one
 * subtlety: `history` is capped at PICK_HISTORY_MAX, so the best clean run may
 * no longer be IN it. The best is therefore only recomputed when the deleted
 * attempt is the one that could have set it; otherwise the stored best stands.
 * Deleting the last attempt drops the record entirely, so the exercise reads
 * "Not played yet" again rather than keeping an empty ledger.
 */
export function deletePickAttempt(patternId: string, at: number): void {
  const all = read<Record<string, PickRecord>>('reps.pickRecords', {});
  const prev = all[patternId];
  if (!prev) return;
  const gone = prev.history.find(h => h.at === at);
  if (!gone) return;
  const history = prev.history.filter(h => h.at !== at);
  if (history.length === 0) {
    delete all[patternId];
    writeStorage('reps.pickRecords', all);
    return;
  }
  const heldTheBest = gone.clean && gone.bpm >= prev.bestCleanBpm;
  const last = history[history.length - 1];
  all[patternId] = {
    ...prev,
    bestCleanBpm: heldTheBest
      ? Math.max(0, ...history.filter(h => h.clean).map(h => h.bpm))
      : prev.bestCleanBpm,
    lastBpm: last.bpm,
    lastAt: last.at,
    attempts: Math.max(history.length, prev.attempts - 1),
    history,
  };
  writeStorage('reps.pickRecords', all);
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function read<T>(key: string, initial: T): T {
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
      // Persist + notify OTHER subscribers AFTER this render commits, not inside
      // the updater: calling writeStorage here fans out setState to sibling
      // components mid-render (React warns "cannot update a component while
      // rendering a different component"). The local update stays synchronous.
      Promise.resolve().then(() => writeStorage(key, next));
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

// A `reps.songs` entry is NOT the source of truth for a song's content — the catalog
// is (shared with Browse). This is the membership record + a cache of the last-resolved
// catalog fields, kept fresh by resolveAndRefreshSongs() so `catalogId`/`tempo`/`chords`
// survive catalog rebuilds (whose row ids are NOT stable). All *user* edits live in a
// separate overlay (reps.songOverlays), keyed by `ref`, and are merged on top at display
// time via mergeSong() — so a catalog refresh can never clobber them.
export type Song = {
  id: string;
  // Stable identity across catalog rebuilds: "sp:<spotifyId>" when known, else
  // "ti:<title>|<artist>". The overlay key and the catalog-resolution key.
  ref?: string;
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
  spotifyId?: string;
  // Canonical YouTube video for this song, from the catalog's spotify->youtube map.
  // Cached (not user data) — a user's own link lives in the overlay's `url` and wins.
  youtubeId?: string;
  artUrl?: string;    // album cover from the Spotify enrichment (AlbumArt falls back to oEmbed)
  key?: number;       // 0..11 pitch class, -1/undefined = undetected
  mode?: number;      // 1 major, 0 minor
  catalogId?: number; // CURRENT-build row id; refreshed live, never trusted long-term
  tempo?: number;     // BPM (audio feature), used to grade chord-transition speed targets
  source?: 'seed' | 'user';
  // Legacy inline attachments — migrated into the overlay by migrateSongsToRefs().
  sheet?: Attachment;
  audio?: Attachment;
};

// Build a song's stable ref. Prefer the immutable Spotify id; fall back to a
// normalized title|artist so hand-typed / non-Spotify songs still get a stable key.
export function songRefOf(x: { spotifyId?: string | null; title: string; artist: string }): string {
  if (x.spotifyId) return `sp:${x.spotifyId}`;
  return `ti:${x.title.trim().toLowerCase()}|${x.artist.trim().toLowerCase()}`;
}

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

// A user's edits to a song, keyed by its stable `ref` (see songRefOf). Held apart from
// the catalog cache so a catalog refresh never clobbers them; merged over the catalog
// data at display time by mergeSong(). Any field left undefined falls through to the
// catalog value.
export type SongOverlay = {
  title?: string;
  artist?: string;
  chords?: string[]; // corrected chord list (e.g. matched to a sheet the user found)
  url?: string;
  notes?: string;
  sheet?: Attachment; // user-attached chord-sheet PDF
  audio?: Attachment; // user-attached mp3
  saved?: boolean;   // reserved: user explicitly saved this catalog song into their collection
  updatedAt: number;
};

// One entry in the `reps.roadmap` map. Keyed by roadmap item id (done/note) or by
// level id (playlistUrl) — item ids and level ids never collide.
export type RoadmapEntry = { done?: boolean; note?: string; playlistUrl?: string; updatedAt?: number };

export const useRepertoire = () => useLocalStore<Chord[]>('reps.repertoire', []);

// Move an owned chord onto a different shape (picking another fingering, saving
// an edit). Everything downstream — exercises, the calibration gate's shapeKey
// check — reads chord.shape, so this is the one write that matters.
export function useSetChordShape(): (id: string, shape: ChordShape) => void {
  const [, setRepertoire] = useRepertoire();
  return (id, shape) =>
    setRepertoire(prev => prev.map(c => (c.id === id ? { ...c, shape } : c)));
}
export const useSwapRecords = () => useLocalStore<Record<string, SwapRecord>>('reps.swaps', {});
export const useRoutineLog = () => useLocalStore<RoutineLog[]>('reps.routineLog', []);
export const usePickRecords = () => useLocalStore<Record<string, PickRecord>>('reps.pickRecords', {});
export const usePickProgressions = () => useLocalStore<SavedProgression[]>('reps.pickProgressions', []);
export const useSongs = () => useLocalStore<Song[]>('reps.songs', []);
export const usePlaylists = () => useLocalStore<Playlist[]>('reps.playlists', []);
// Per-song user edits, keyed by the song's stable `ref` (songRefOf). Never touches the seed DB.
export const useSongOverlays = () => useLocalStore<Record<string, SongOverlay>>('reps.songOverlays', {});
export const useRoadmapProgress = () => useLocalStore<Record<string, RoadmapEntry>>('reps.roadmap', {});
// Watched state for the JustinGuitar videos linked into the roadmap, keyed by
// YouTube video id (an 11-char id never collides with a roadmap item/level id).
export const useWatchedVideos = () => useLocalStore<Record<string, boolean>>('reps.roadmapVideos', {});
// Microphone-assisted detection (swap counter + quiz auto-reveal). Opt-in.
// (There is no `calibrate` flag: calibration is deliberate, per-chord, and lives
// in the Calibration Studio — see retirePassiveCalibration below.)
// `debug`: surface the /mic-test diagnostics (live chroma, per-chord threshold
// table, raw event log) inline in the exercises. Purely informational.
// `activationThreshold`: Discord-style input-sensitivity gate on the same 0..1
// log scale as ChordListener.getLevel(). A strum/knock quieter than this never
// registers as an event. Default 0 = off (relies on the adaptive gate alone),
// so the real-guitar-validated detection is unchanged until the user raises it.
// `filters`: enable the Tier-1 DSP front-end (high-pass + low-pass) in the
// ChordListener graph — kills rumble/handling/hiss, preserves pitched content.
// Default off so the real-guitar-validated path is unchanged until opted in.
// `filterHpHz` / `filterLpHz`: tunable cutoffs for the filter chain, so the
// high-pass/low-pass can be dialed to the room + guitar (defaults 75 Hz / 7 kHz).
export type MicSettings = { enabled: boolean; debug?: boolean; activationThreshold?: number; filters?: boolean; filterHpHz?: number; filterLpHz?: number };
export const useMicSettings = () => useLocalStore<MicSettings>('reps.micSettings', { enabled: false, debug: false, activationThreshold: 0, filters: false, filterHpHz: 75, filterLpHz: 7000 });
// One-time cleanup: passive auto-calibration is retired. Its `reps.micCalibration`
// samples were sim-only (no chroma), so they cannot produce a learned prototype —
// carrying them into chordProfiles would let a chord pass the calibration gate
// with nothing actually learned, which is exactly what the gate exists to prevent.
// So the key is dropped rather than migrated, along with the dead `calibrate` flag.
// Idempotent; call once at startup OUTSIDE React (never during render).
export function retirePassiveCalibration() {
  if (localStorage.getItem('reps.micCalibration') != null) {
    localStorage.removeItem('reps.micCalibration');
  }
  const mic = read<MicSettings & { calibrate?: boolean }>('reps.micSettings', { enabled: false });
  if ('calibrate' in mic) {
    const { calibrate: _dropped, ...rest } = mic;
    writeStorage('reps.micSettings', rest);
  }
}

// --- Deliberate per-chord calibration (Calibration Studio) ---
// Replaces passive auto-calibration: samples are collected in a focused Studio
// where you play the chord as cleanly as possible. Keyed by chord id (library +
// repertoire share ONE id space, so a library chord calibrated here carries over
// when added to the repertoire). The math (prototype chroma / thresholds / score)
// lives in src/audio/calibration.ts. Coexists with the old micCalibration for now.
export type CalibrationSample = {
  chroma?: number[];   // 12-vec (unit norm) of the strum; absent for sim-only samples
  sim: number;         // cosine similarity to the theoretical template at capture
  weight: number;      // cleanliness quality weight, 0..1
  source: 'single' | 'strum' | 'continuous' | 'legacy';
  at: number;
};
export type CalibrationProfile = {
  chordId: string;
  samples: CalibrationSample[];
  expectedPcs: number[]; // sounding pitch classes from the shape (future note-validator info)
  // Fingerprint of the SHAPE these samples describe (see shapeKey in
  // audio/calibration.ts). The calibration gate refuses a profile whose shape has
  // since changed, which also covers the user switching fingering. Absent on
  // profiles recorded before this existed — treated as matching.
  shapeKey?: string;
  updatedAt: number;
};
export const useChordProfiles = () => useLocalStore<Record<string, CalibrationProfile>>('reps.chordProfiles', {});

// Append one Studio-collected sample (already quality-gated by the caller).
// `shapeKey` stamps which shape the sample describes so the gate can spot a later
// shape/fingering change; it's preserved from the existing profile when omitted.
export function recordChordSample(
  chordId: string, expectedPcs: number[], sample: CalibrationSample, shapeKey?: string,
) {
  const all = read<Record<string, CalibrationProfile>>('reps.chordProfiles', {});
  const prev = all[chordId];
  const samples = [...(prev?.samples ?? []), sample].slice(-CAL_SAMPLE_CAP);
  writeStorage('reps.chordProfiles', {
    ...all,
    [chordId]: { chordId, samples, expectedPcs, shapeKey: shapeKey ?? prev?.shapeKey, updatedAt: Date.now() },
  });
}
// Drop a chord's whole profile (shape edited, or user reset in the Studio).
export function clearChordProfile(chordId: string) {
  const all = read<Record<string, CalibrationProfile>>('reps.chordProfiles', {});
  if (!(chordId in all)) return;
  const next = { ...all };
  delete next[chordId];
  writeStorage('reps.chordProfiles', next);
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

  // Drop the overlay and revoke any attachment blobs it (or the legacy song) held.
  const ref = song?.ref;
  const overlays = read<Record<string, SongOverlay>>('reps.songOverlays', {});
  const ov = ref ? overlays[ref] : undefined;
  for (const att of [song?.sheet, song?.audio, ov?.sheet, ov?.audio]) {
    if (att && att.kind === 'file') deleteFile(att.fileId).catch(() => {});
  }
  if (ref && overlays[ref]) {
    const nextOv = { ...overlays };
    delete nextOv[ref];
    writeStorage('reps.songOverlays', nextOv);
  }
}

// Merge a song's overlay (user edits) over its catalog cache for display. Any overlay
// field left undefined falls through to the cached catalog value.
export function mergeSong(cache: Song, overlay?: SongOverlay): Song {
  if (!overlay) return cache;
  return {
    ...cache,
    title: overlay.title ?? cache.title,
    artist: overlay.artist ?? cache.artist,
    chords: overlay.chords ?? cache.chords,
    url: overlay.url ?? cache.url,
    notes: overlay.notes ?? cache.notes,
    sheet: overlay.sheet ?? cache.sheet,
    audio: overlay.audio ?? cache.audio,
  };
}

// Write (merge) an overlay patch for a song ref. Non-hook so an editor can save-then-close
// in one tick without the write being lost to an unmount.
export function setSongOverlay(ref: string, patch: Partial<SongOverlay>) {
  const all = read<Record<string, SongOverlay>>('reps.songOverlays', {});
  writeStorage('reps.songOverlays', { ...all, [ref]: { ...(all[ref] ?? {}), ...patch, updatedAt: Date.now() } });
}

export function clearSongOverlay(ref: string) {
  const all = read<Record<string, SongOverlay>>('reps.songOverlays', {});
  if (!(ref in all)) return;
  const next = { ...all };
  delete next[ref];
  writeStorage('reps.songOverlays', next);
}

// Overwrite the catalog-derived cache fields of saved songs from freshly-resolved
// catalog rows (keyed by ref). This is what makes the Songs page share Browse's source
// of truth: after a catalog rebuild the row ids move, so the stored catalogId/tempo go
// stale — resolving live by the stable ref and refreshing here repairs them. User edits
// live in the overlay and are untouched. No-op (no write) when nothing changed.
export function refreshSongCache(byRef: Map<string, CatalogSong>) {
  const songs = read<Song[]>('reps.songs', []);
  let changed = false;
  const next = songs.map(s => {
    const cs = s.ref ? byRef.get(s.ref) : undefined;
    if (!cs) return s;
    const patched: Song = {
      ...s,
      title: cs.title,
      artist: cs.artist,
      chords: cs.chords,
      genre: cs.genre ?? undefined,
      popularity: cs.popularity ?? undefined,
      spotifyId: cs.spotifyId ?? undefined,
      youtubeId: cs.youtubeId ?? undefined,
      artUrl: cs.artUrl ?? undefined,
      catalogId: cs.id,
      tempo: cs.tempo ?? undefined,
      key: cs.key ?? undefined,
      mode: cs.mode ?? undefined,
    };
    if (JSON.stringify(patched) !== JSON.stringify(s)) changed = true;
    return patched;
  });
  if (changed) writeStorage('reps.songs', next);
}

// Resolve saved songs against the live catalog by their stable ref (spotify id, else
// title|artist) and refresh the cache. Reads reps.songs itself (so it picks up refs
// just stamped by migrateSongsToRefs). Call once the catalog worker is ready.
export async function resolveAndRefreshSongs(): Promise<void> {
  const withRef = read<Song[]>('reps.songs', []).filter(s => s.ref);
  if (withRef.length === 0) return;
  const keyOf = (s: Song) => `${s.title}|${s.artist}`.toLowerCase();
  const { byId, byKey } = await matchCatalogTracks(
    withRef.map(s => ({ id: s.spotifyId ?? null, key: keyOf(s) })),
  );
  const byRef = new Map<string, CatalogSong>();
  for (const s of withRef) {
    const cs = (s.spotifyId && byId.get(s.spotifyId)) || byKey.get(keyOf(s));
    if (cs && s.ref) byRef.set(s.ref, cs);
  }
  refreshSongCache(byRef);
}

// One-time migration to the ref + overlay model: stamp each saved song with its stable
// ref and move inline user data (link, notes, attachments) into the overlay so future
// catalog refreshes never overwrite it. Idempotent via a stored flag.
export function migrateSongsToRefs() {
  if (read<boolean>('reps.songsRefMigrated', false)) return;
  const songs = read<Song[]>('reps.songs', []);
  const overlays = read<Record<string, SongOverlay>>('reps.songOverlays', {});
  const nextOv: Record<string, SongOverlay> = { ...overlays };
  const nextSongs = songs.map(s => {
    const ref = s.ref ?? songRefOf(s);
    const cur = nextOv[ref] ?? { updatedAt: Date.now() };
    let touched = false;
    // Only seed fields the overlay doesn't already define.
    if (s.url && cur.url == null) { cur.url = s.url; touched = true; }
    if (s.notes && cur.notes == null) { cur.notes = s.notes; touched = true; }
    if (s.sheet && cur.sheet == null) { cur.sheet = s.sheet; touched = true; }
    if (s.audio && cur.audio == null) { cur.audio = s.audio; touched = true; }
    if (touched) nextOv[ref] = cur;
    return { ...s, ref, url: undefined, notes: undefined, sheet: undefined, audio: undefined };
  });
  writeStorage('reps.songOverlays', nextOv);
  writeStorage('reps.songs', nextSongs);
  writeStorage('reps.songsRefMigrated', true);
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
// Set exactly which playlists a song belongs to, creating any playlist named in
// `newNames`. Non-hook (writeStorage notifies subscribers) so the picker can
// commit-then-close in the same tick: a component's own useLocalStore setter defers
// its write to a microtask and would lose it when the picker unmounts.
export function setSongPlaylists(songId: string, playlistIds: string[], newNames: string[] = []) {
  const want = new Set(playlistIds);
  const list = read<Playlist[]>('reps.playlists', []);
  const now = Date.now();
  const created = newNames.map((name, i) => ({
    id: `pl-${now.toString(36)}-${i}`,
    name,
    songIds: [songId],
    createdAt: now + i,
  }));
  writeStorage('reps.playlists', [
    ...list.map(p => {
      const has = p.songIds.includes(songId);
      if (has === want.has(p.id)) return p;
      return { ...p, songIds: has ? p.songIds.filter(i => i !== songId) : [...p.songIds, songId] };
    }),
    ...created,
  ]);
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
    ref: songRefOf(cs),
    title: cs.title,
    artist: cs.artist,
    chords: cs.chords,
    genre: cs.genre ?? undefined,
    popularity: cs.popularity ?? undefined,
    spotifyId: cs.spotifyId ?? undefined,
    youtubeId: cs.youtubeId ?? undefined,
    artUrl: cs.artUrl ?? undefined,
    catalogId: cs.id,
    tempo: cs.tempo ?? undefined,
    key: cs.key ?? undefined,
    mode: cs.mode ?? undefined,
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
