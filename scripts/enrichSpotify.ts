// Resolve Chordonomicon's spotify_song_id values to { title, artist, popularity }
// via the Spotify Web API (client-credentials flow — a free app, no user login).
//
// Run: `npm run enrich:spotify`            (full run, ~500k ids, ~1h)
//      `ENRICH_LIMIT=200 npm run enrich:spotify`   (small test run first)
//
// Credentials: set env SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET, or create
//   data/raw/spotify.json  →  { "clientId": "...", "clientSecret": "..." }
//
// Writes a resumable cache to data/raw/spotify-cache.json (id → data | null).
// Re-running skips ids already in the cache, so it can be stopped/restarted freely.
import { createReadStream, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { parse } from 'csv-parse';

const CSV = 'data/raw/chordonomicon_v2.csv';
const CACHE = 'data/raw/spotify-cache.json';
const CREDS_FILE = 'data/raw/spotify.json';

type Named = {
  title: string; artist: string; popularity: number;
  durationMs: number; explicit: boolean;
  isrc: string | null; spotifyUrl: string | null;
  album: string | null; releaseDate: string | null; art: string | null;
};
type Cache = Record<string, Named | null>; // null = looked up, not found on Spotify

function toNamed(t: any): Named {
  const imgs = t.album?.images ?? [];
  return {
    title: t.name,
    artist: t.artists?.[0]?.name ?? '',
    popularity: t.popularity ?? 0,
    durationMs: t.duration_ms ?? 0,
    explicit: !!t.explicit,
    isrc: t.external_ids?.isrc ?? null,
    spotifyUrl: t.external_urls?.spotify ?? null,
    album: t.album?.name ?? null,
    releaseDate: t.album?.release_date ?? null,
    art: imgs[1]?.url ?? imgs[0]?.url ?? null, // ~300px medium if present, else largest
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function creds(): { id: string; secret: string } {
  let id = process.env.SPOTIFY_CLIENT_ID;
  let secret = process.env.SPOTIFY_CLIENT_SECRET;
  if ((!id || !secret) && existsSync(CREDS_FILE)) {
    const j = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
    id = id || j.clientId || j.client_id;
    secret = secret || j.clientSecret || j.client_secret;
  }
  if (!id || !secret) {
    throw new Error('Missing Spotify credentials. Set SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET, '
      + 'or create data/raw/spotify.json with { "clientId": "...", "clientSecret": "..." }');
  }
  return { id, secret };
}

let token = '';
let tokenExp = 0;
async function getToken(c: { id: string; secret: string }): Promise<string> {
  if (token && Date.now() < tokenExp - 60_000) return token;
  const auth = Buffer.from(`${c.id}:${c.secret}`).toString('base64');
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!resp.ok) throw new Error(`Spotify token request failed: ${resp.status} ${await resp.text()}`);
  const j: any = await resp.json();
  token = j.access_token;
  tokenExp = Date.now() + (j.expires_in ?? 3600) * 1000;
  return token;
}

// If Spotify hands back a huge Retry-After (dev-mode penalties can be many hours),
// don't sleep — throw a sentinel so main() saves progress and exits for a later resume.
const MAX_RETRY_WAIT_S = Number(process.env.MAX_RETRY_WAIT_S ?? 180);
class RateLimitStop extends Error { constructor(public waitS: number) { super('rate-limit-stop'); } }

async function fetchBatch(ids: string[], c: { id: string; secret: string }): Promise<any[]> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tok = await getToken(c);
    const resp = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids.join(',')}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (resp.status === 429) {
      const wait = Number(resp.headers.get('retry-after') ?? '2') + 1;
      if (wait > MAX_RETRY_WAIT_S) throw new RateLimitStop(wait);
      console.log(`  rate-limited (429) — waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (resp.status === 401) { token = ''; continue; } // force refresh
    if (!resp.ok) { console.log(`  HTTP ${resp.status} — retrying`); await sleep(2000); continue; }
    const j: any = await resp.json();
    return j.tracks ?? [];
  }
  throw new Error('Spotify batch failed after retries');
}

async function collectIds(): Promise<string[]> {
  const set = new Set<string>();
  const parser = createReadStream(CSV).pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true }));
  for await (const rec of parser as any) {
    const id = String(rec.spotify_song_id ?? '').trim();
    if (id) set.add(id);
  }
  return [...set];
}

function writeCache(cache: Cache) {
  // Unique tmp name: two concurrent runs sharing `${CACHE}.tmp` would race, and the
  // loser's rename() dies with ENOENT after the winner moved the file away.
  const tmp = `${CACHE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache));
  renameSync(tmp, CACHE);
}

async function main() {
  if (!existsSync(CSV)) throw new Error(`${CSV} not found — download the Chordonomicon CSV first.`);
  const c = creds();
  const limit = process.env.ENRICH_LIMIT ? Number(process.env.ENRICH_LIMIT) : Infinity;

  console.log('Collecting Spotify IDs from CSV …');
  const allIds = await collectIds();
  console.log(`${allIds.length.toLocaleString()} unique Spotify IDs.`);

  const cache: Cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  // Fetch ids never seen, AND re-fetch old-schema found entries to backfill the new
  // fields (duration/isrc/art/…). Genuine not-found entries (null) are left alone.
  let todo = allIds.filter(id => {
    const c = cache[id];
    if (c === undefined) return true;
    if (c === null) return false;
    return !('durationMs' in c); // pre-expansion entry → backfill
  });
  const backfill = todo.filter(id => id in cache).length;
  if (limit < todo.length) todo = todo.slice(0, limit);
  console.log(`${Object.keys(cache).length.toLocaleString()} cached; fetching ${todo.length.toLocaleString()} `
    + `(${backfill.toLocaleString()} backfill + new) …`);

  const paceMs = Number(process.env.PACE_MS ?? 120);
  let done = 0, batchNo = 0;
  try {
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const tracks = await fetchBatch(batch, c);
      for (let k = 0; k < batch.length; k++) {
        const t = tracks[k];
        cache[batch[k]] = t ? toNamed(t) : null;
      }
      done += batch.length;
      if (++batchNo % 100 === 0) { // ~every 5000 ids
        writeCache(cache);
        console.log(`  ${done.toLocaleString()}/${todo.length.toLocaleString()}`);
      }
      await sleep(paceMs);
    }
  } catch (e) {
    if (e instanceof RateLimitStop) {
      writeCache(cache);
      const hrs = (e.waitS / 3600).toFixed(1);
      console.log(`\n⏸ Hit a long rate-limit penalty (~${hrs}h). Saved ${done.toLocaleString()} this run. `
        + `Resume later (it skips cached ids); consider a slower pace, e.g. PACE_MS=400.`);
      return;
    }
    throw e;
  }
  writeCache(cache);
  const found = Object.values(cache).filter(Boolean).length;
  console.log(`✓ Done. ${found.toLocaleString()} named / ${Object.keys(cache).length.toLocaleString()} total in cache → ${CACHE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
