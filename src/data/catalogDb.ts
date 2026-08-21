// Main-thread client for the seeded song catalog worker (src/data/catalogWorker.ts).
// Owns the Worker, a small promise-based RPC, and a React hook exposing load status
// + query helpers. The heavy SQLite/OPFS work stays off the UI thread.
import { useEffect, useRef, useState, useCallback } from 'react';
import type { MatchLevel } from './chordNormalize';

export type CatalogSong = {
  id: number;
  title: string;
  artist: string;
  genre: string | null;
  popularity: number | null;
  chords: string[];
  tempo: number | null;
  key: number | null;  // 0..11 pitch class, -1/null = undetected
  mode: number | null; // 1 major, 0 minor
  spotifyId: string | null;
  artUrl: string | null;
  youtubeId: string | null;
  youtubeConf: string | null;
  matchKey: string | null;
};

export type SearchOpts = {
  text?: string;
  genre?: string;
  known?: string[];
  level?: MatchLevel;
  onlyPlayable?: boolean;
  excludeChords?: string[];
  tempoMin?: number;
  tempoMax?: number;
  key?: number;
  mode?: number;
  sort?: 'popularity' | 'title' | 'artist';
  limit?: number;
  offset?: number;
};

export type CatalogStatus =
  | { phase: 'idle' }
  | { phase: 'init' }
  | { phase: 'downloading'; bytes: number }
  | { phase: 'importing'; bytes: number }
  | { phase: 'ready'; songs: number; genres: string[] }
  | { phase: 'error'; error: string };

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let reqId = 0;
const pending = new Map<number, Pending>();
const progressListeners = new Set<(s: CatalogStatus) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./catalogWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data || {};
    if (d.type === 'progress') {
      const s = phaseToStatus(d);
      if (s) progressListeners.forEach(l => l(s));
      return;
    }
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d.result);
    else p.reject(new Error(d.error));
  };
  worker.onerror = (e) => {
    const err: CatalogStatus = { phase: 'error', error: e.message || 'Catalog worker crashed' };
    progressListeners.forEach(l => l(err));
  };
  return worker;
}

function phaseToStatus(d: any): CatalogStatus | null {
  switch (d.phase) {
    case 'init': return { phase: 'init' };
    case 'downloading': return { phase: 'downloading', bytes: d.bytes ?? 0 };
    case 'importing': return { phase: 'importing', bytes: d.bytes ?? 0 };
    case 'ready': return null; // final status comes from the init() RPC result
    default: return null;
  }
}

function call<T = any>(type: string, payload?: unknown): Promise<T> {
  const w = getWorker();
  const id = ++reqId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, payload });
  });
}

function toSong(r: any): CatalogSong {
  return {
    id: r.id, title: r.title, artist: r.artist, genre: r.genre ?? null,
    popularity: r.popularity ?? null,
    chords: safeParse(r.chords_json),
    tempo: r.tempo ?? null, key: r.song_key ?? null, mode: r.song_mode ?? null,
    spotifyId: r.spotify_id ?? null, artUrl: r.art_url ?? null,
    youtubeId: r.youtube_id ?? null, youtubeConf: r.youtube_conf ?? null,
    matchKey: r.match_key ?? null,
  };
}
function safeParse(s: unknown): string[] {
  try { const v = JSON.parse(String(s)); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Kick off (or reuse) catalog init; resolves with song count + genres. */
export function initCatalog(): Promise<{ songs: number; genres: string[] }> {
  return call('init');
}

export async function searchCatalog(opts: SearchOpts): Promise<{ songs: CatalogSong[]; hasMore: boolean }> {
  const { rows, hasMore } = await call('search', opts);
  return { songs: (rows as any[]).map(toSong), hasMore };
}

export type ChordCount = { chord: string; n: number };

/** Distinct chords (at opts.level) across the songs the given filters allow,
 *  most common first — powers the Browse chord toggle filter. */
export async function availableChords(opts: SearchOpts): Promise<ChordCount[]> {
  const { rows } = await call<{ rows: any[] }>('chords', opts);
  return rows.map(r => ({ chord: String(r.chord), n: (r.n as number) ?? 0 }));
}

/**
 * Match Spotify playlist tracks against the catalog. `byId` is keyed by
 * spotify_id, `byKey` by lowercased "title|artist" (fallback for tracks whose
 * exact recording id isn't in the catalog).
 */
export async function matchCatalogTracks(
  tracks: { id: string | null; key: string }[],
): Promise<{ byId: Map<string, CatalogSong>; byKey: Map<string, CatalogSong> }> {
  const r = await call<{ byId: any[]; byKey: any[] }>('matchTracks', { tracks });
  const byId = new Map<string, CatalogSong>();
  for (const row of r.byId) if (row.spotify_id && !byId.has(row.spotify_id)) byId.set(row.spotify_id, toSong(row));
  const byKey = new Map<string, CatalogSong>();
  for (const row of r.byKey) if (row.match_key && !byKey.has(row.match_key)) byKey.set(row.match_key, toSong(row));
  return { byId, byKey };
}

/** Look up catalog songs by normalized `matchKey(title, artist)` values. */
export async function matchCatalogKeys(keys: string[]): Promise<Map<string, CatalogSong>> {
  const rows = await call<any[]>('matchKeys', { keys });
  const byKey = new Map<string, CatalogSong>();
  for (const row of rows ?? []) {
    if (row.match_key && !byKey.has(row.match_key)) byKey.set(row.match_key, toSong(row));
  }
  return byKey;
}

/**
 * Resolve YouTube video ids to catalog songs via the precomputed reverse index.
 * Only our canonical id per song hits here; callers fall back to
 * `matchCatalogTracks` on the video title+channel for the rest.
 */
export async function matchCatalogYouTube(
  videoIds: string[],
): Promise<Map<string, CatalogSong>> {
  const rows = await call<any[]>('matchYouTube', { videoIds });
  const byVideo = new Map<string, CatalogSong>();
  for (const row of rows ?? []) {
    if (row.youtube_id && !byVideo.has(row.youtube_id)) byVideo.set(row.youtube_id, toSong(row));
  }
  return byVideo;
}

/** Full raw progression (with section tags) for one catalog song, or null. */
export async function getProgression(id: number): Promise<string | null> {
  return call('progression', { id });
}

/** The seed-catalog row for one song id (for "restore original"), or null. */
export async function getCatalogSongById(id: number): Promise<CatalogSong | null> {
  const r = await call('getSong', { id });
  return r ? toSong(r) : null;
}

/** React hook: drives catalog load and exposes status + a stable search fn. */
export function useCatalog() {
  const [status, setStatus] = useState<CatalogStatus>({ phase: 'idle' });
  const started = useRef(false);

  useEffect(() => {
    const onProgress = (s: CatalogStatus) => setStatus(prev => (prev.phase === 'ready' ? prev : s));
    progressListeners.add(onProgress);
    if (!started.current) {
      started.current = true;
      setStatus({ phase: 'init' });
      // Ask the browser to keep OPFS durable (must be called from a window context).
      (navigator as any).storage?.persist?.().catch(() => {});
      initCatalog()
        .then(({ songs, genres }) => setStatus({ phase: 'ready', songs, genres }))
        .catch(err => setStatus({ phase: 'error', error: err.message }));
    }
    return () => { progressListeners.delete(onProgress); };
  }, []);

  const search = useCallback((opts: SearchOpts) => searchCatalog(opts), []);
  const chords = useCallback((opts: SearchOpts) => availableChords(opts), []);
  return { status, search, chords };
}
