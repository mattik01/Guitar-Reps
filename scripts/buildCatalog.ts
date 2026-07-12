// Build the seeded song-catalog SQLite. Supports two sources (auto-detected by header):
//
//   • e-chords "Chords and Lyrics" Kaggle CSV  (song_name/artist_name/chords/…)
//   • Chordonomicon  (chords/spotify_song_id/…) — needs a Spotify name cache from
//     `npm run enrich:spotify` (data/raw/spotify-cache.json), since Chordonomicon has
//     no titles/artists, only Spotify ids.
//
// Run: `npm run build:catalog`  (reads the first .csv in data/raw/), or
//      `CATALOG_CSV=path/to/file.csv npm run build:catalog`.
//
// Output: public/catalog.sqlite(.gz) + public/catalog.meta.json (gz is what the app downloads).
// Only chord tokens the shared chordNormalize parser recognises are kept, so junk never leaks in.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, createReadStream } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { parse as parseSync } from 'csv-parse/sync';
import { parse as parseStream } from 'csv-parse';
import Database from 'better-sqlite3';
import { parseChord } from '../src/data/chordNormalize';
import { chordonomiconToStandard, isStructuralTag } from '../src/data/chordonomicon';

const CATALOG_VERSION = 5; // v5: dataset-sourced names + full audio features + metadata.
const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'public');
const SPOTIFY_CACHE = path.join(RAW_DIR, 'spotify-cache.json');
const TRACK_FEATURES = path.join(RAW_DIR, 'track-features.json'); // track_id → {title,artist,album,tempo,key,mode,energy,…}

// ---- locate the source CSV --------------------------------------------------
function findCsv(): string {
  const arg = process.env.CATALOG_CSV;
  if (arg) {
    if (!existsSync(arg)) throw new Error(`CSV not found: ${arg}`);
    return arg;
  }
  if (!existsSync(RAW_DIR)) throw new Error(`No data/raw/ dir. Put the source CSV there, or pass CATALOG_CSV.`);
  // Prefer a Chordonomicon file if present; else the first csv that isn't a cache.
  const csvs = readdirSync(RAW_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
  const chordo = csvs.find(f => f.toLowerCase().includes('chordonomicon'));
  const pick = chordo ?? csvs[0];
  if (!pick) throw new Error(`No .csv in ${RAW_DIR}. Download a dataset there.`);
  return path.join(RAW_DIR, pick);
}

// ---- column detection (e-chords) --------------------------------------------
function pickColumn(headers: string[], candidates: string[], required = false, label = ''): number {
  const norm = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const cand of candidates) {
    const c = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
    const exact = norm.indexOf(c);
    if (exact >= 0) return exact;
  }
  for (const cand of candidates) {
    const c = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
    const partial = norm.findIndex(h => h.includes(c));
    if (partial >= 0) return partial;
  }
  if (required) throw new Error(`Could not detect a column for "${label}". Headers: ${headers.join(', ')}`);
  return -1;
}

// ---- chord extraction -------------------------------------------------------
// e-chords: free-text field → scan for chord-like tokens.
const TOKEN_RE = /[A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M)?[0-9]{0,2}(?:sus[24])?(?:\/[A-G][#b]?)?/g;
function extractChordsEchords(field: string): string[] {
  if (!field) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of field.matchAll(TOKEN_RE)) {
    const tok = m[0];
    const p = parseChord(tok);
    if (!p.ok || seen.has(p.exact)) continue;
    seen.add(p.exact);
    out.push(tok.trim());
    if (out.length >= 24) break;
  }
  return out;
}

// Chordonomicon: space-separated tokens (+ <structural> tags) → convert → validate.
function extractChordsChordonomicon(field: string): string[] {
  if (!field) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of field.split(/\s+/)) {
    if (!raw || isStructuralTag(raw)) continue;
    const std = chordonomiconToStandard(raw);
    const p = parseChord(std);
    if (!p.ok || seen.has(p.exact)) continue;
    seen.add(p.exact);
    out.push(std);
    if (out.length >= 24) break;
  }
  return out;
}

function normArtistTitle(artist: string, title: string): string {
  return `${artist} ${title}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---- DB ---------------------------------------------------------------------
function openDb() {
  mkdirSync(OUT_DIR, { recursive: true });
  const dbPath = path.join(OUT_DIR, 'catalog.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.exec(`
    DROP TABLE IF EXISTS songs_fts;
    DROP TABLE IF EXISTS songs;
    DROP TABLE IF EXISTS song_chords;
    CREATE TABLE songs (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      genre TEXT,
      lang TEXT,
      popularity REAL,
      spotify_id TEXT,
      decade INTEGER,
      chords_json TEXT NOT NULL,
      -- full raw Chordonomicon progression with <verse_1>/<chorus_1>… section tags
      -- (lossless; convert tokens on demand via src/data/chordonomicon.ts)
      progression TEXT,
      release_date TEXT,
      genres TEXT,
      rock_genre TEXT,
      artist_id TEXT,
      spotify_artist_id TEXT,
      -- Spotify /tracks extras
      duration_ms INTEGER,
      explicit INTEGER,
      isrc TEXT,
      spotify_url TEXT,
      album TEXT,
      album_release_date TEXT,
      art_url TEXT,
      -- audio features (from the static 56M-track dataset join; Spotify's estimates)
      tempo REAL,
      song_key INTEGER,   -- 0..11 pitch class (-1 = undetected)
      song_mode INTEGER,  -- 1 = major, 0 = minor
      danceability REAL, energy REAL, valence REAL, acousticness REAL,
      instrumentalness REAL, liveness REAL, speechiness REAL, loudness REAL,
      artist_popularity REAL, artist_followers INTEGER
    );
    CREATE TABLE song_chords (
      song_id INTEGER NOT NULL,
      chord_exact TEXT NOT NULL,
      chord_medium TEXT NOT NULL,
      chord_base TEXT NOT NULL
    );
  `);
  return { db, dbPath };
}

type SongRec = {
  title: string; artist: string; genre: string | null; lang: string | null;
  popularity: number | null; spotifyId: string | null; decade: number | null;
  chordTokens: string[]; // standard chord symbols (distinct set)
  // extra Chordonomicon fields (null for e-chords)
  progression?: string | null; releaseDate?: string | null; genres?: string | null;
  rockGenre?: string | null; artistId?: string | null; spotifyArtistId?: string | null;
  // Spotify /tracks extras
  durationMs?: number | null; explicit?: boolean | null; isrc?: string | null;
  spotifyUrl?: string | null; album?: string | null; albumReleaseDate?: string | null; artUrl?: string | null;
  // audio features
  tempo?: number | null; songKey?: number | null; songMode?: number | null;
  danceability?: number | null; energy?: number | null; valence?: number | null; acousticness?: number | null;
  instrumentalness?: number | null; liveness?: number | null; speechiness?: number | null; loudness?: number | null;
  artistPopularity?: number | null; artistFollowers?: number | null;
};

function makeInserter(db: Database.Database) {
  const insSong = db.prepare(
    `INSERT INTO songs (id,title,artist,genre,lang,popularity,spotify_id,decade,chords_json,
       progression,release_date,genres,rock_genre,artist_id,spotify_artist_id,
       duration_ms,explicit,isrc,spotify_url,album,album_release_date,art_url,
       tempo,song_key,song_mode,
       danceability,energy,valence,acousticness,instrumentalness,liveness,speechiness,loudness,
       artist_popularity,artist_followers)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insChord = db.prepare(
    `INSERT INTO song_chords (song_id,chord_exact,chord_medium,chord_base) VALUES (?,?,?,?)`);
  let id = 0;
  const seen = new Set<string>();
  function add(r: SongRec): boolean {
    if (!r.title || r.chordTokens.length === 0) return false;
    const key = normArtistTitle(r.artist, r.title);
    if (seen.has(key)) return false;
    seen.add(key);
    id++;
    insSong.run(id, r.title, r.artist, r.genre, r.lang, r.popularity, r.spotifyId, r.decade,
      JSON.stringify(r.chordTokens),
      r.progression ?? null, r.releaseDate ?? null, r.genres ?? null,
      r.rockGenre ?? null, r.artistId ?? null, r.spotifyArtistId ?? null,
      r.durationMs ?? null, r.explicit == null ? null : (r.explicit ? 1 : 0), r.isrc ?? null,
      r.spotifyUrl ?? null, r.album ?? null, r.albumReleaseDate ?? null, r.artUrl ?? null,
      r.tempo ?? null, r.songKey ?? null, r.songMode ?? null,
      r.danceability ?? null, r.energy ?? null, r.valence ?? null, r.acousticness ?? null,
      r.instrumentalness ?? null, r.liveness ?? null, r.speechiness ?? null, r.loudness ?? null,
      r.artistPopularity ?? null, r.artistFollowers ?? null);
    const seenLvl = new Set<string>();
    for (const tok of r.chordTokens) {
      const p = parseChord(tok);
      const k = p.exact + '|' + p.base;
      if (seenLvl.has(k)) continue;
      seenLvl.add(k);
      insChord.run(id, p.exact, p.medium, p.base);
    }
    return true;
  }
  return { add, count: () => id };
}

function finish(db: Database.Database, dbPath: string, songs: number) {
  console.log('Building indexes …');
  db.exec(`
    CREATE INDEX idx_songs_pop ON songs(popularity DESC);
    CREATE INDEX idx_songs_title ON songs(title COLLATE NOCASE);
    CREATE INDEX idx_songs_artist ON songs(artist COLLATE NOCASE);
    CREATE INDEX idx_sc_song ON song_chords(song_id);
    CREATE INDEX idx_sc_exact ON song_chords(chord_exact);
    CREATE INDEX idx_sc_base ON song_chords(chord_base);
  `);
  // FTS5 index for fast title/artist search — a LIKE '%x%' scan over the full table
  // is far too slow when the DB is read from OPFS in the browser.
  console.log('Building FTS5 search index …');
  db.exec(`
    CREATE VIRTUAL TABLE songs_fts USING fts5(title, artist, content='songs', content_rowid='id');
    INSERT INTO songs_fts(rowid, title, artist) SELECT id, title, artist FROM songs;
  `);
  db.exec('VACUUM;');
  db.close();

  console.log('Gzipping …');
  const bytes = readFileSync(dbPath);
  const gz = gzipSync(bytes, { level: 9 });
  writeFileSync(path.join(OUT_DIR, 'catalog.sqlite.gz'), gz);
  writeFileSync(path.join(OUT_DIR, 'catalog.meta.json'), JSON.stringify(
    { version: CATALOG_VERSION, songs, bytes: bytes.length, gzBytes: gz.length }, null, 2));
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';
  console.log(`✓ catalog.sqlite ${mb(bytes.length)} → catalog.sqlite.gz ${mb(gz.length)} (v${CATALOG_VERSION}, ${songs} songs)`);
}

// ---- e-chords build (sync parse) --------------------------------------------
function buildEchords(csvPath: string) {
  console.log(`Source: e-chords. Reading ${csvPath} …`);
  const records: string[][] = parseSync(readFileSync(csvPath), { relaxQuotes: true, relaxColumnCount: true, skipEmptyLines: true });
  const headers = records[0];
  const col = {
    title: pickColumn(headers, ['song_name', 'song', 'title', 'track'], true, 'title'),
    artist: pickColumn(headers, ['artist_name', 'artist', 'band'], true, 'artist'),
    chords: pickColumn(headers, ['chords', 'chord', 'chords_only', 'chordsandlyrics'], true, 'chords'),
    popularity: pickColumn(headers, ['popularity', 'views', 'rank', 'hits']),
    genres: pickColumn(headers, ['genres', 'genre']),
    lang: pickColumn(headers, ['lang', 'language']),
  };
  console.log('Detected columns:', Object.fromEntries(Object.entries(col).map(([k, i]) => [k, i >= 0 ? headers[i] : '(none)'])));

  const { db, dbPath } = openDb();
  const ins = makeInserter(db);
  let skipped = 0;
  db.exec('BEGIN');
  for (const r of records.slice(1)) {
    const ok = ins.add({
      title: (r[col.title] ?? '').trim(),
      artist: (r[col.artist] ?? '').trim(),
      genre: col.genres >= 0 ? (r[col.genres] || null) : null,
      lang: col.lang >= 0 ? (r[col.lang] || null) : null,
      popularity: col.popularity >= 0 ? (Number(r[col.popularity]) || null) : null,
      spotifyId: null,
      decade: null,
      chordTokens: extractChordsEchords(r[col.chords] ?? ''),
    });
    if (!ok) skipped++;
  }
  db.exec('COMMIT');
  console.log(`Inserted ${ins.count()} songs (${skipped} skipped: no chords / dup).`);
  finish(db, dbPath, ins.count());
}

// ---- Chordonomicon build (streaming) ----------------------------------------
async function buildChordonomicon(csvPath: string) {
  console.log(`Source: Chordonomicon. Reading ${csvPath} …`);
  // Rich per-track data from the 56M-track dataset join (names + metadata + audio features).
  type Feat = {
    title?: string; artist?: string; album?: string | null; release_date?: string | null;
    duration_ms?: number; explicit?: boolean; popularity?: number;
    artist_popularity?: number; artist_followers?: number;
    tempo?: number; key?: number; mode?: number;
    danceability?: number; energy?: number; loudness?: number; speechiness?: number;
    acousticness?: number; instrumentalness?: number; liveness?: number; valence?: number;
  };
  const feats: Record<string, Feat> = existsSync(TRACK_FEATURES)
    ? JSON.parse(readFileSync(TRACK_FEATURES, 'utf8')) : {};
  console.log(`Track features (dataset): ${Object.keys(feats).length.toLocaleString()} tracks.`);

  // Spotify API cache — optional now; only source of album art / ISRC / spotify url, and a
  // fallback name source for tracks the dataset doesn't cover.
  type CacheVal = {
    title: string; artist: string; popularity: number;
    durationMs?: number; explicit?: boolean; isrc?: string | null; spotifyUrl?: string | null;
    album?: string | null; releaseDate?: string | null; art?: string | null;
  } | null;
  const cache: Record<string, CacheVal> = existsSync(SPOTIFY_CACHE)
    ? JSON.parse(readFileSync(SPOTIFY_CACHE, 'utf8')) : {};
  console.log(`Spotify cache: ${Object.values(cache).filter(Boolean).length.toLocaleString()} named ids.`);

  if (!Object.keys(feats).length && !Object.keys(cache).length) {
    throw new Error(`Need names: run \`python3.10 scripts/joinAudioFeatures.py\` (→ ${TRACK_FEATURES}) and/or \`npm run enrich:spotify\`.`);
  }

  const { db, dbPath } = openDb();
  const ins = makeInserter(db);
  let rows = 0, noName = 0, noChords = 0, dup = 0;

  db.exec('BEGIN');
  const parser = createReadStream(csvPath).pipe(parseStream({ columns: true, relaxQuotes: true, relaxColumnCount: true }));
  for await (const rec of parser as any) {
    rows++;
    const sid = String(rec.spotify_song_id ?? '').trim();
    const f = sid ? feats[sid] : undefined;
    const sp = sid ? cache[sid] : undefined;
    const title = (f?.title || sp?.title || '').trim();
    const artist = (f?.artist || sp?.artist || '').trim();
    if (!title) { noName++; continue; }
    const chordTokens = extractChordsChordonomicon(rec.chords ?? '');
    if (chordTokens.length === 0) { noChords++; continue; }
    const decadeNum = parseInt(String(rec.decade ?? ''), 10);
    const ok = ins.add({
      title,
      artist,
      genre: (rec.main_genre || rec.genres || null) as string | null,
      lang: null,
      popularity: f?.popularity ?? sp?.popularity ?? null,
      spotifyId: sid,
      decade: Number.isFinite(decadeNum) ? decadeNum : null,
      chordTokens,
      // import everything else Chordonomicon offers (lossless, for future features)
      progression: (rec.chords ?? '').trim() || null,
      releaseDate: (rec.release_date ?? '').trim() || null,
      genres: (rec.genres ?? '').trim() || null,
      rockGenre: (rec.rock_genre ?? '').trim() || null,
      artistId: (rec.artist_id ?? '').trim() || null,
      spotifyArtistId: (rec.spotify_artist_id ?? '').trim() || null,
      // metadata: prefer dataset, fall back to Spotify cache
      durationMs: f?.duration_ms ?? sp?.durationMs ?? null,
      explicit: f?.explicit ?? sp?.explicit ?? null,
      album: f?.album ?? sp?.album ?? null,
      albumReleaseDate: f?.release_date ?? sp?.releaseDate ?? null,
      // only available from the Spotify API enrichment
      isrc: sp?.isrc ?? null,
      spotifyUrl: sp?.spotifyUrl ?? null,
      artUrl: sp?.art ?? null,
      // audio features (from the dataset)
      tempo: f?.tempo ?? null, songKey: f?.key ?? null, songMode: f?.mode ?? null,
      danceability: f?.danceability ?? null, energy: f?.energy ?? null, valence: f?.valence ?? null,
      acousticness: f?.acousticness ?? null, instrumentalness: f?.instrumentalness ?? null,
      liveness: f?.liveness ?? null, speechiness: f?.speechiness ?? null, loudness: f?.loudness ?? null,
      artistPopularity: f?.artist_popularity ?? null, artistFollowers: f?.artist_followers ?? null,
    });
    if (!ok) dup++;
    if (rows % 100000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); console.log(`  …${rows.toLocaleString()} rows, ${ins.count().toLocaleString()} kept`); }
  }
  db.exec('COMMIT');
  console.log(`Rows: ${rows.toLocaleString()} | kept ${ins.count().toLocaleString()} | no-name ${noName.toLocaleString()} | no-chords ${noChords.toLocaleString()} | dup ${dup.toLocaleString()}`);
  finish(db, dbPath, ins.count());
}

// ---- entry ------------------------------------------------------------------
async function main() {
  const csvPath = findCsv();
  // Peek the header to pick the source.
  const firstLine = readFileSync(csvPath, 'utf8').slice(0, 2048).split('\n')[0].toLowerCase();
  const isChordonomicon = firstLine.includes('spotify_song_id') && !firstLine.includes('song_name');
  if (isChordonomicon) await buildChordonomicon(csvPath);
  else buildEchords(csvPath);
}

main().catch(e => { console.error(e); process.exit(1); });
