// Web Worker that owns the seeded song catalog: an SQLite database persisted in
// OPFS via the SAH-pool VFS (no COOP/COEP headers needed). On first run it
// downloads /catalog.sqlite.gz, decompresses it, and imports it into the pool;
// thereafter it opens straight from OPFS — fully offline.
//
// Talks to the main thread (src/data/catalogDb.ts) over a tiny request/response
// RPC, and emits unsolicited {type:'progress'} messages during first-run download.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const BASE = import.meta.env.BASE_URL || '/';
const GZ_URL = BASE + 'catalog.sqlite.gz';
const META_URL = BASE + 'catalog.meta.json';

type Row = Record<string, unknown>;

let db: any = null;
let ready: Promise<void> | null = null;

function post(msg: unknown) { (self as unknown as Worker).postMessage(msg); }
function progress(phase: string, extra: Record<string, unknown> = {}) {
  post({ type: 'progress', phase, ...extra });
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  // Cast: a Uint8Array is a valid BlobPart at runtime; TS 5.7's typed-array
  // generics (Uint8Array<ArrayBufferLike>) don't line up with BlobPart's type.
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Download the catalog and return raw SQLite bytes. Robust to how the file is
// served: if the transport already decompressed it (Content-Encoding: gzip, as
// Vite's dev server does) the bytes arrive as a SQLite file; a plain static host
// hands us the gzip bytes. We sniff the gzip magic and only decompress if needed.
async function downloadDb(url: string): Promise<Uint8Array> {
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error(`Catalog download failed (${resp.status}) at ${url}`);
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    progress('downloading', { bytes: total });
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }

  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  return isGzip ? gunzip(buf) : buf;
}

async function init(): Promise<void> {
  progress('init');
  const sqlite3 = await sqlite3InitModule();
  // The OPFS SAH-pool can be held by only one worker at a time. On a reload the
  // previous worker's handles may linger briefly; retry with backoff (~up to 20s).
  // If it still fails it's almost certainly open in another tab — say so clearly.
  let pool: any = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'guitar-reps-catalog', initialCapacity: 6 });
      break;
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, Math.min(200 + attempt * 120, 900)));
    }
  }
  if (!pool) {
    const m = String((lastErr as any)?.message ?? lastErr);
    if (/Access Handle|SyncAccessHandle|NoModificationAllowed/i.test(m)) {
      throw new Error('TAB_LOCK'); // the UI turns this into a friendly message
    }
    throw lastErr;
  }

  // Version-stamp the OPFS filename so a rebuilt/updated catalog is picked up
  // automatically (a returning user isn't stuck on the old DB).
  let version = 0;
  try { version = (await (await fetch(META_URL)).json()).version ?? 0; } catch { /* default */ }
  const DB_FILE = `/catalog-v${version}.sqlite`;

  const norm = (f: string) => f.replace(/^\/+/, '');
  const names = pool.getFileNames().map(norm);
  if (!names.includes(norm(DB_FILE))) {
    // Reclaim space from any older catalog version before importing the new one.
    if (names.some((n: string) => /^catalog-v\d+\.sqlite$/.test(n))) {
      try { await pool.wipeFiles(); } catch { /* ignore */ }
    }
    progress('downloading', { bytes: 0 });
    const bytes = await downloadDb(GZ_URL);
    progress('importing', { bytes: bytes.length });
    await pool.importDb(DB_FILE, bytes);
  }
  db = new pool.OpfsSAHPoolDb(DB_FILE);

  // Best-effort durability request (must run on main thread too; harmless here).
  try { await (navigator as any).storage?.persist?.(); } catch { /* ignore */ }
  progress('ready');
}

function ensureInit(): Promise<void> {
  if (!ready) ready = init();
  return ready;
}

function rows(sql: string, bind: unknown[] = []): Row[] {
  return db.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' }) as Row[];
}

// ---- query helpers ----------------------------------------------------------
type SearchOpts = {
  text?: string;
  genre?: string;
  known?: string[];              // repertoire chords normalized at `level`
  level?: 'exact' | 'medium' | 'base';
  onlyPlayable?: boolean;
  excludeChords?: string[];      // chords (normalized at `level`) whose songs to hide
  tempoMin?: number;
  tempoMax?: number;
  key?: number;                  // 0..11 pitch class
  mode?: number;                 // 1 major, 0 minor
  sort?: 'popularity' | 'title' | 'artist';
  limit?: number;
  offset?: number;
};

// Which normalized song_chords column a match level compares against.
function chordCol(level?: string): string {
  return level === 'exact' ? 'chord_exact' : level === 'medium' ? 'chord_medium' : 'chord_base';
}

// Build the shared WHERE/bind for every non-chord-toggle filter (text, genre,
// audio features, "only playable"). Used by both searchSongs and availableChords
// so the toggle list stays in sync with the songs the other filters allow.
function baseFilters(o: SearchOpts): { where: string[]; bind: unknown[]; ftsJoin: string } {
  const where: string[] = [];
  const bind: unknown[] = [];
  let ftsJoin = '';
  if (o.text && o.text.trim()) {
    // FTS5 MATCH (fast) instead of a full-table LIKE scan. Sanitize to bare
    // alphanumeric terms and prefix-match the last term for as-you-type search.
    const terms = o.text.trim().toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
    if (terms.length) {
      const q = terms.map((w, i) => (i === terms.length - 1 ? w + '*' : w)).join(' ');
      // FTS5's MATCH column shares the table's name, so reference it unaliased.
      ftsJoin = 'JOIN songs_fts ON songs_fts.rowid = s.id';
      where.push('songs_fts MATCH ?');
      bind.push(q);
    }
  }
  if (o.genre && o.genre.trim()) { where.push('s.genre LIKE ?'); bind.push('%' + o.genre.trim() + '%'); }
  if (typeof o.tempoMin === 'number') { where.push('s.tempo >= ?'); bind.push(o.tempoMin); }
  if (typeof o.tempoMax === 'number') { where.push('s.tempo <= ?'); bind.push(o.tempoMax); }
  if (typeof o.key === 'number') { where.push('s.song_key = ?'); bind.push(o.key); }
  if (typeof o.mode === 'number') { where.push('s.song_mode = ?'); bind.push(o.mode); }

  if (o.onlyPlayable) {
    const col = chordCol(o.level);
    where.push(`NOT EXISTS (
      SELECT 1 FROM song_chords sc
      WHERE sc.song_id = s.id AND sc.${col} NOT IN (SELECT value FROM json_each(?))
    )`);
    bind.push(JSON.stringify(o.known ?? []));
  }
  return { where, bind, ftsJoin };
}

// Distinct chords (at the active level) across every song the non-chord filters
// allow, most common first — the toggle list backing the Browse chord filter.
const CHORD_LIMIT = 120;
function availableChords(o: SearchOpts): { rows: Row[] } {
  const { where, bind, ftsJoin } = baseFilters(o);
  const col = chordCol(o.level);
  const sql = `SELECT xc.${col} AS chord, COUNT(*) AS n
    FROM songs s
    ${ftsJoin}
    JOIN song_chords xc ON xc.song_id = s.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY xc.${col}
    ORDER BY n DESC, chord ASC
    LIMIT ?`;
  bind.push(CHORD_LIMIT);
  return { rows: rows(sql, bind) };
}

function searchSongs(o: SearchOpts): { rows: Row[]; hasMore: boolean } {
  const { where, bind, ftsJoin } = baseFilters(o);

  if (o.excludeChords && o.excludeChords.length) {
    // Hide any song that uses one of the toggled-off chords.
    const col = chordCol(o.level);
    where.push(`NOT EXISTS (
      SELECT 1 FROM song_chords sc
      WHERE sc.song_id = s.id AND sc.${col} IN (SELECT value FROM json_each(?))
    )`);
    bind.push(JSON.stringify(o.excludeChords));
  }

  const order = o.sort === 'title' ? 's.title COLLATE NOCASE ASC'
    : o.sort === 'artist' ? 's.artist COLLATE NOCASE ASC'
    : 's.popularity DESC';
  const limit = Math.max(1, Math.min(o.limit ?? 50, 200));
  const offset = Math.max(0, o.offset ?? 0);

  const sql = `SELECT s.id, s.title, s.artist, s.genre, s.popularity, s.chords_json,
      s.tempo, s.song_key, s.song_mode, s.spotify_id, s.art_url
    FROM songs s
    ${ftsJoin}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${order}
    LIMIT ? OFFSET ?`;
  bind.push(limit + 1, offset); // fetch one extra to detect "hasMore"

  const r = rows(sql, bind);
  const hasMore = r.length > limit;
  return { rows: hasMore ? r.slice(0, limit) : r, hasMore };
}

const SONG_COLS = `s.id, s.title, s.artist, s.genre, s.popularity, s.chords_json,
  s.tempo, s.song_key, s.song_mode, s.spotify_id, s.art_url`;

// Match imported Spotify tracks against the catalog: primarily by spotify_id,
// then by exact lowercased "title|artist" for tracks whose id didn't hit (the
// same song often exists under a different recording's id, e.g. remasters).
function matchTracks(p: { tracks: { id: string | null; key: string }[] }): { byId: Row[]; byKey: Row[] } {
  const ids = [...new Set(p.tracks.map(t => t.id).filter(Boolean))];
  const byId = ids.length
    ? rows(`SELECT ${SONG_COLS} FROM songs s
        WHERE s.spotify_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)])
    : [];
  const hit = new Set(byId.map(r => r.spotify_id as string));
  const keys = [...new Set(p.tracks.filter(t => !(t.id && hit.has(t.id))).map(t => t.key))];
  const byKey = keys.length
    ? rows(`SELECT ${SONG_COLS}, lower(s.title) || '|' || lower(s.artist) AS match_key FROM songs s
        WHERE lower(s.title) || '|' || lower(s.artist) IN (SELECT value FROM json_each(?))`, [JSON.stringify(keys)])
    : [];
  return { byId, byKey };
}

function getProgression(id: number): string | null {
  const r = rows('SELECT progression FROM songs WHERE id = ?', [id]);
  return (r[0]?.progression as string) ?? null;
}

function getSongById(id: number): Row | null {
  const r = rows(`SELECT ${SONG_COLS} FROM songs s WHERE s.id = ?`, [id]);
  return r[0] ?? null;
}

function meta(): Row {
  const [c] = rows('SELECT COUNT(*) AS n FROM songs');
  const genres = rows(
    `SELECT genre, COUNT(*) n FROM songs WHERE genre IS NOT NULL AND genre <> ''
     GROUP BY genre ORDER BY n DESC LIMIT 40`
  );
  return { songs: (c?.n as number) ?? 0, genres: genres.map(g => g.genre) };
}

// ---- RPC dispatch -----------------------------------------------------------
self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data || {};
  try {
    await ensureInit();
    let result: unknown;
    switch (type) {
      case 'init': result = meta(); break;
      case 'search': result = searchSongs(payload as SearchOpts); break;
      case 'chords': result = availableChords(payload as SearchOpts); break;
      case 'progression': result = getProgression((payload as { id: number }).id); break;
      case 'getSong': result = getSongById((payload as { id: number }).id); break;
      case 'matchTracks': result = matchTracks(payload as { tracks: { id: string | null; key: string }[] }); break;
      case 'meta': result = meta(); break;
      default: throw new Error(`Unknown request: ${type}`);
    }
    post({ id, ok: true, result });
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
