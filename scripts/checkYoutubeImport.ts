// Offline check of the YouTube-import resolution path: fetches a playlist through the
// same proxy the app uses, then runs the REAL src/data modules (youtubeTitle +
// matchKey) and the exact SQL from catalogWorker's matchYouTube/matchKeys against
// public/catalog.sqlite. Verifies everything except the OPFS/worker plumbing.
//
// Run: npx esbuild scripts/checkYoutubeImport.ts --bundle --platform=node --format=esm \
//        --external:better-sqlite3 | node --input-type=module -- <playlistId> [...]
import Database from 'better-sqlite3';
import { trackCandidates } from '../src/data/youtubeTitle';
import { matchKey } from '../src/data/matchKey';

const SONG_COLS = `s.id, s.title, s.artist, s.youtube_id, s.youtube_conf, s.match_key`;
const db = new Database('public/catalog.sqlite', { readonly: true });

const byVideoStmt = db.prepare(
  `SELECT ${SONG_COLS} FROM songs s WHERE s.youtube_id IN (SELECT value FROM json_each(?))`);
const byKeyStmt = db.prepare(
  `SELECT ${SONG_COLS} FROM songs s WHERE s.match_key IN (SELECT value FROM json_each(?))`);

async function run(id: string) {
  const resp = await fetch(`http://localhost:5173/api/youtube/playlist?id=${id}`);
  const data: any = await resp.json();
  if (!resp.ok) { console.log(`  !! ${data.error}`); return; }
  const items: { videoId: string; title: string; channel: string }[] = data.items ?? [];

  const byVideo = new Map<string, any>();
  for (const r of byVideoStmt.all(JSON.stringify(items.map(i => i.videoId))) as any[]) {
    if (!byVideo.has(r.youtube_id)) byVideo.set(r.youtube_id, r);
  }
  const rest = items.filter(i => !byVideo.has(i.videoId));
  const cands = new Map(rest.map(i => [i.videoId, trackCandidates(i.title, i.channel)]));
  const keys = [...cands.values()].flat().map(c => matchKey(c.title, c.artist));
  const byKey = new Map<string, any>();
  if (keys.length) for (const r of byKeyStmt.all(JSON.stringify(keys)) as any[]) {
    if (!byKey.has(r.match_key)) byKey.set(r.match_key, r);
  }

  let exact = 0, fuzzy = 0;
  const missed: string[] = [];
  for (const i of items) {
    if (byVideo.has(i.videoId)) { exact++; continue; }
    const hit = (cands.get(i.videoId) ?? []).map(c => byKey.get(matchKey(c.title, c.artist))).find(Boolean);
    if (hit) fuzzy++; else missed.push(`${i.title}  [${i.channel}]`);
  }
  const tot = items.length;
  console.log(`  ${data.name}: ${exact + fuzzy}/${tot} matched  (${exact} by video id, ${fuzzy} by title)`);
  for (const m of missed.slice(0, 6)) console.log(`     miss: ${m.slice(0, 74)}`);
  if (missed.length > 6) console.log(`     … +${missed.length - 6} more`);
}

for (const id of process.argv.slice(2)) {
  console.log(`\n=== ${id} ===`);
  await run(id);
}
db.close();
