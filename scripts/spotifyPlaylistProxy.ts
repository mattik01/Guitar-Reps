// Vite middleware exposing GET /api/spotify/playlist?id=<playlistId> for the
// playlist-import feature (src/data/spotifyImport.ts). Runs server-side so the
// Spotify client secret never reaches the browser; uses the same credentials as
// the enrichment script (env SPOTIFY_CLIENT_ID/SECRET or data/raw/spotify.json).
//
// Response: { name, tracks: [{ id, title, artist }] } — episodes/local files are
// dropped. Errors come back as { error } with a matching HTTP status. Note that
// client-credentials can only read playlists visible to everyone: private and
// Spotify-editorial playlists 404.
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const CREDS_FILE = 'data/raw/spotify.json';
const MAX_TRACKS = 2000;

type Track = { id: string; title: string; artist: string };

function creds(): { id: string; secret: string } | null {
  let id = process.env.SPOTIFY_CLIENT_ID;
  let secret = process.env.SPOTIFY_CLIENT_SECRET;
  if ((!id || !secret) && existsSync(CREDS_FILE)) {
    const j = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
    id = id || j.clientId || j.client_id;
    secret = secret || j.clientSecret || j.client_secret;
  }
  return id && secret ? { id, secret } : null;
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
  if (!resp.ok) throw new HttpError(502, `Spotify token request failed (${resp.status}) — check the credentials in ${CREDS_FILE}.`);
  const j: any = await resp.json();
  token = j.access_token;
  tokenExp = Date.now() + (j.expires_in ?? 3600) * 1000;
  return token;
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function api(path: string, c: { id: string; secret: string }): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${await getToken(c)}` },
    });
    if (resp.status === 401) { token = ''; continue; } // stale token → refresh
    if (resp.status === 429) {
      const wait = Math.min(Number(resp.headers.get('retry-after') ?? '2') + 1, 10);
      await new Promise(r => setTimeout(r, wait * 1000));
      continue;
    }
    if (resp.status === 404) {
      throw new HttpError(404, 'Playlist not found. It may be private or a Spotify-made editorial playlist — those aren\'t readable by apps.');
    }
    if (!resp.ok) throw new HttpError(502, `Spotify request failed (${resp.status}).`);
    return resp.json();
  }
  throw new HttpError(502, 'Spotify kept rate-limiting the request — try again in a minute.');
}

async function fetchPlaylist(id: string): Promise<{ name: string; tracks: Track[] }> {
  const c = creds();
  if (!c) {
    throw new HttpError(500, `No Spotify credentials. Set SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET or create ${CREDS_FILE}.`);
  }
  const meta = await api(`/playlists/${id}?fields=name`, c);
  const tracks: Track[] = [];
  for (let offset = 0; offset < MAX_TRACKS; offset += 100) {
    const page = await api(
      `/playlists/${id}/tracks?limit=100&offset=${offset}&fields=total,items(track(id,name,type,artists(name)))`, c);
    for (const it of page.items ?? []) {
      const t = it?.track;
      if (t && t.type === 'track' && t.id) {
        tracks.push({ id: t.id, title: t.name ?? '', artist: t.artists?.[0]?.name ?? '' });
      }
    }
    if (offset + 100 >= (page.total ?? 0)) break;
  }
  return { name: meta.name ?? '', tracks };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!req.url?.startsWith('/api/spotify/playlist')) return next();
  const id = new URL(req.url, 'http://localhost').searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return send(res, 400, { error: 'Invalid playlist id.' });
  try {
    send(res, 200, await fetchPlaylist(id));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    send(res, status, { error: err instanceof Error ? err.message : String(err) });
  }
}

export function spotifyPlaylistProxy(): Plugin {
  return {
    name: 'spotify-playlist-proxy',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
