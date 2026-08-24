// One process-wide cache of "what are this song's chord changes and sections", keyed
// by catalog row id. A progression never changes, and the same song shows up on
// several screens at once (a Browse row, a playlist entry, the playability sort), so
// it is fetched and parsed once.
import { getProgression } from './catalogDb';
import { analyzeSong, type SongAnalysis } from './songTransitions';

export type { SongAnalysis };

export const EMPTY_ANALYSIS: SongAnalysis = { transitions: [], sections: [] };

const cache = new Map<number, SongAnalysis>();
const inflight = new Map<number, Promise<SongAnalysis>>();

/** What's already known, without touching the worker. */
export function cachedAnalysis(id: number): SongAnalysis | null {
  return cache.get(id) ?? null;
}

/**
 * Seed the cache from a progression the caller already has (Browse's playability
 * sort fetches them in bulk), so the cards it renders never re-query for that text.
 */
export function primeAnalysis(id: number, rawProgression: string): SongAnalysis {
  const hit = cache.get(id);
  if (hit) return hit;
  const a = analyzeSong(rawProgression || '');
  cache.set(id, a);
  return a;
}

/** Fetch + parse (or reuse) one song's analysis. Concurrent callers share one query. */
export function loadAnalysis(id: number): Promise<SongAnalysis> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(id);
  if (!p) {
    p = getProgression(id)
      .then(raw => { const a = analyzeSong(raw || ''); cache.set(id, a); inflight.delete(id); return a; })
      .catch(() => { inflight.delete(id); return EMPTY_ANALYSIS; });
    inflight.set(id, p);
  }
  return p;
}
