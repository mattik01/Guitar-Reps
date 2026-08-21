// Import a YouTube playlist into the app: fetch its items through the dev-server
// proxy (scripts/youtubePlaylistProxy.ts), resolve them to catalog songs, materialize
// the matches into reps.songs, and add them to a local playlist named after the
// YouTube one. Mirrors spotifyImport.ts.
//
// Two resolution passes, because a playlist can hold ANY upload:
//   1. exact — the video id is the catalog's canonical youtube_id (reverse index).
//   2. fallback — parse "Artist - Title" / the channel name out of the video and
//      match on title+artist, which is how covers, lyric videos and live uploads
//      still find their song.
import { matchCatalogYouTube, matchCatalogKeys, type CatalogSong } from './catalogDb';
import { matchKey } from './matchKey';
import { trackCandidates } from './youtubeTitle';
import { saveCatalogSong, addSongsToNamedPlaylist } from '../state/store';

export type YoutubeImportResult = {
  playlistId: string;
  playlistName: string;
  total: number;      // videos in the YouTube playlist
  matched: number;    // videos resolved to a catalog song
  matchedExact: number; // resolved via the youtube_id reverse index
  added: number;      // songs newly added to the app playlist (0 on a re-import)
  unmatched: { title: string; artist: string }[];
};

/** Extract the playlist id from a YouTube link (…list=<id>) or a bare id. */
export function parseYoutubePlaylistId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/[?&]list=([A-Za-z0-9_-]{10,64})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,64}$/.test(s) ? s : null;
}

export { trackCandidates, guessTrack } from './youtubeTitle';

export async function importYoutubePlaylist(
  link: string,
  onStatus?: (s: string) => void,
): Promise<YoutubeImportResult> {
  const id = parseYoutubePlaylistId(link);
  if (!id) throw new Error("That doesn't look like a YouTube playlist link.");

  onStatus?.('Fetching playlist from YouTube…');
  const resp = await fetch(`/api/youtube/playlist?id=${id}`);
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data) throw new Error(data?.error ?? `Import failed (HTTP ${resp.status}).`);

  const items: { videoId: string; title: string; channel: string }[] = data.items ?? [];
  if (items.length === 0) throw new Error('That playlist has no videos.');

  onStatus?.(`Matching ${items.length} videos against the catalog…`);
  const byVideo = await matchCatalogYouTube(items.map(i => i.videoId));

  // Whatever the reverse index missed, try as text — every plausible reading of the
  // upload title, resolved through the shared normalizer.
  const rest = items.filter(i => !byVideo.has(i.videoId));
  const cands = new Map<string, { title: string; artist: string }[]>();
  for (const i of rest) cands.set(i.videoId, trackCandidates(i.title, i.channel));
  const allKeys = [...cands.values()].flat().map(c => matchKey(c.title, c.artist));
  const byKey = allKeys.length ? await matchCatalogKeys(allKeys) : new Map<string, CatalogSong>();

  const songIds: string[] = [];
  const unmatched: { title: string; artist: string }[] = [];
  let matchedExact = 0;
  for (const i of items) {
    const exact = byVideo.get(i.videoId);
    if (exact) { matchedExact++; songIds.push(saveCatalogSong(exact)); continue; }
    const list = cands.get(i.videoId) ?? [];
    let hit: CatalogSong | undefined;
    for (const c of list) {
      hit = byKey.get(matchKey(c.title, c.artist));
      if (hit) break;
    }
    if (hit) songIds.push(saveCatalogSong(hit));
    else unmatched.push(list[0] ?? { title: i.title, artist: i.channel });
  }

  const name = (data.name as string) || 'Imported YouTube playlist';
  const { playlistId, added } = addSongsToNamedPlaylist(name, songIds);
  return {
    playlistId,
    playlistName: name,
    total: items.length,
    matched: new Set(songIds).size,
    matchedExact,
    added,
    unmatched,
  };
}
