// Import a Spotify playlist into the app: fetch its tracks through the dev-server
// proxy (scripts/spotifyPlaylistProxy.ts), match them against the seeded catalog
// (by spotify id, then by title+artist), materialize the matches into reps.songs,
// and add them to a local playlist named after the Spotify one.
import { matchCatalogTracks } from './catalogDb';
import { saveCatalogSong, addSongsToNamedPlaylist } from '../state/store';

export type ImportResult = {
  playlistId: string;
  playlistName: string;
  total: number;    // playable tracks in the Spotify playlist
  matched: number;  // tracks found in the catalog
  added: number;    // songs newly added to the app playlist (0 on a re-import)
  unmatched: { title: string; artist: string }[];
};

/** Extract the playlist id from an open.spotify.com link or spotify: URI. */
export function parsePlaylistId(input: string): string | null {
  const m = input.trim().match(/(?:open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/|spotify:playlist:)([A-Za-z0-9]{10,40})/);
  return m ? m[1] : null;
}

export async function importSpotifyPlaylist(
  link: string,
  onStatus?: (s: string) => void,
): Promise<ImportResult> {
  const id = parsePlaylistId(link);
  if (!id) throw new Error("That doesn't look like a Spotify playlist link.");

  onStatus?.('Fetching playlist from Spotify…');
  const resp = await fetch(`/api/spotify/playlist?id=${id}`);
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data) throw new Error(data?.error ?? `Import failed (HTTP ${resp.status}).`);

  const tracks: { id: string; title: string; artist: string }[] = data.tracks ?? [];
  if (tracks.length === 0) throw new Error('That playlist has no tracks.');

  onStatus?.(`Matching ${tracks.length} tracks against the catalog…`);
  const keyOf = (t: { title: string; artist: string }) => `${t.title}|${t.artist}`.toLowerCase();
  const { byId, byKey } = await matchCatalogTracks(tracks.map(t => ({ id: t.id, key: keyOf(t) })));

  const songIds: string[] = [];
  const unmatched: { title: string; artist: string }[] = [];
  for (const t of tracks) {
    const cs = byId.get(t.id) ?? byKey.get(keyOf(t));
    if (cs) songIds.push(saveCatalogSong(cs));
    else unmatched.push({ title: t.title, artist: t.artist });
  }

  const name = (data.name as string) || 'Imported playlist';
  const { playlistId, added } = addSongsToNamedPlaylist(name, songIds);
  return {
    playlistId,
    playlistName: name,
    total: tracks.length,
    matched: new Set(songIds).size,
    added,
    unmatched,
  };
}
