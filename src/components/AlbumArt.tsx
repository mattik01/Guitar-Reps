import { useEffect, useState } from 'react';
import { IconNote } from './icons';

// Album cover for a catalog song. Prefers the stored art_url (populated by the Spotify
// enrichment backfill); until that exists, lazily resolves Spotify's public oEmbed
// thumbnail by track id (CORS-open, no auth). Results are cached module-wide.
const thumbCache = new Map<string, string | null>();

async function oembedThumb(spotifyId: string): Promise<string | null> {
  if (thumbCache.has(spotifyId)) return thumbCache.get(spotifyId)!;
  try {
    const r = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${spotifyId}`);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const u = (j.thumbnail_url as string) ?? null;
    thumbCache.set(spotifyId, u);
    return u;
  } catch {
    thumbCache.set(spotifyId, null);
    return null;
  }
}

export function AlbumArt({ spotifyId, artUrl, size = 52 }: {
  spotifyId?: string | null;
  artUrl?: string | null;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(artUrl ?? null);
  useEffect(() => {
    if (artUrl) { setSrc(artUrl); return; }
    if (!spotifyId) { setSrc(null); return; }
    let cancelled = false;
    oembedThumb(spotifyId).then(u => { if (!cancelled) setSrc(u); });
    return () => { cancelled = true; };
  }, [spotifyId, artUrl]);

  return (
    <div style={{
      width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 8, overflow: 'hidden',
      background: 'var(--line)', display: 'grid', placeItems: 'center',
    }}>
      {src
        ? <img src={src} alt="" width={size} height={size} loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <IconNote size={size * 0.4} style={{ opacity: 0.3 }} />}
    </div>
  );
}
