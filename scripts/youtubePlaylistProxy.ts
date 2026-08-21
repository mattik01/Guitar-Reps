// Vite middleware exposing GET /api/youtube/playlist?id=<playlistId> for the
// YouTube playlist-import feature (src/data/youtubeImport.ts).
//
// Uses yt-dlp rather than the YouTube Data API so no API key is needed (the repo
// already shells to yt-dlp in scripts/buildRoadmapVideos.py). --flat-playlist only
// reads the playlist page, so it is one request regardless of playlist length.
//
// Response: { name, items: [{ videoId, title, channel, duration }] }.
// Errors come back as { error } with a matching HTTP status.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const execFileP = promisify(execFile);
const MAX_ITEMS = 2000;

export type YtItem = { videoId: string; title: string; channel: string; duration: number | null };

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function fetchPlaylist(id: string): Promise<{ name: string; items: YtItem[] }> {
  const url = `https://www.youtube.com/playlist?list=${id}`;
  let stdout = '';
  try {
    ({ stdout } = await execFileP(
      'yt-dlp',
      ['--flat-playlist', '--dump-single-json', '--no-warnings', '--ignore-errors',
       '--playlist-end', String(MAX_ITEMS), url],
      { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
    ));
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new HttpError(500, 'yt-dlp is not installed on the dev server (pip install yt-dlp).');
    }
    // yt-dlp exits non-zero when ANY entry fails (a deleted or private video in an
    // otherwise fine playlist) but still writes the full playlist JSON. Keep that
    // output rather than failing the whole import over one dead video.
    stdout = String(err?.stdout ?? '');
    if (!stdout.trim()) {
      const msg = String(err?.stderr || err?.message || err);
      if (/private|unavailable|does not exist|not found/i.test(msg)) {
        throw new HttpError(404, 'Playlist not found — it may be private or deleted.');
      }
      throw new HttpError(502, `yt-dlp failed: ${msg.slice(0, 200)}`);
    }
  }

  let j: any;
  try { j = JSON.parse(stdout); }
  catch { throw new HttpError(502, 'Could not parse the yt-dlp response.'); }
  if (!Array.isArray(j?.entries)) {
    throw new HttpError(404, 'Playlist not found — it may be private or deleted.');
  }

  const items: YtItem[] = [];
  for (const e of j.entries ?? []) {
    if (!e?.id) continue;
    items.push({
      videoId: String(e.id),
      title: String(e.title ?? ''),
      // flat-playlist exposes the uploader under a few different keys
      channel: String(e.channel ?? e.uploader ?? e.playlist_channel ?? ''),
      duration: typeof e.duration === 'number' ? Math.round(e.duration) : null,
    });
  }
  return { name: String(j.title ?? 'YouTube playlist'), items };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!req.url?.startsWith('/api/youtube/playlist')) return next();
  const id = new URL(req.url, 'http://localhost').searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return send(res, 400, { error: 'Invalid playlist id.' });
  try {
    send(res, 200, await fetchPlaylist(id));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    send(res, status, { error: err instanceof Error ? err.message : String(err) });
  }
}

export function youtubePlaylistProxy(): Plugin {
  return {
    name: 'youtube-playlist-proxy',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
