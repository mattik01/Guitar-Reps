// Parsing YouTube upload titles into candidate (title, artist) readings.
// Pure string work, no app/browser deps — same split as chordNormalize.ts, so the
// dev-server, the app and offline test scripts can all share it.

// Upload titles carry a lot of noise: "(Official Video)", "[HD]", "| Lyrics",
// "(Acoustic Cover by …)", trailing "Live Session", channel promos after a pipe.
const PAREN_NOISE =
  /\((?:[^)]*\b(?:official|video|audio|lyric|lyrics|hd|hq|4k|mv|visualizer|remaster(?:ed)?|live|cover|acoustic|session|sessions|unplugged|performance|explicit|clean|full album|prod\.?)\b[^)]*)\)/gi;

// Promo tails uploaders bolt on outside any brackets.
const PROMO =
  /\s+(?:on\s+(?:spotify|apple\s*music|itunes)\b.*$|high\s+quality\s+audio\b.*$|full\s+hd\b.*$|out\s+now\b.*$|official\b\s*$)/gi;

function clean(s: string): string {
  return s
    .replace(PAREN_NOISE, ' ')
    .replace(/\[[^\]]*\]/g, ' ')       // [HD], [Live in Paris]
    .replace(/[‘’“”'"`]/g, '')         // quoted song names
    .replace(PROMO, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Candidate (title, artist) readings of a YouTube upload. Upload titles use BOTH
 * "Artist - Title" and "Title - Artist" (and the channel is sometimes the artist,
 * sometimes a label or a covering act), so rather than guessing one reading we return
 * every plausible one and let the catalog decide which is real.
 */
export function trackCandidates(videoTitle: string, channel: string): { title: string; artist: string }[] {
  const chan = clean(channel.replace(/\s*-\s*Topic\s*$/i, ''));
  const t = clean(videoTitle);
  const out: { title: string; artist: string }[] = [];
  const push = (title: string, artist: string) => {
    title = clean(title); artist = clean(artist);
    if (title && artist) out.push({ title, artist });
  };
  const parts = t.split('|').map(x => clean(x)).filter(Boolean);
  if (parts.length >= 2) {
    push(parts[1], parts[0]);   // "Artist | Title | …"
    push(parts[0], parts[1]);   // "Title | Artist | …"
    if (chan) { push(parts[0], chan); push(parts[1], chan); }
  }
  const t1 = parts[0] ?? t;     // everything before the first pipe
  const sep = t1.match(/^(.*?)\s*[-–—:]\s+(.*)$/);
  if (sep) {
    push(sep[2], sep[1]);   // "Artist - Title"  (most common)
    push(sep[1], sep[2]);   // "Title - Artist"
    if (chan) { push(sep[1], chan); push(sep[2], chan); }
  }
  if (chan) { push(t1, chan); push(t, chan); }  // whole title, channel as artist

  // Catalogs disagree about who "owns" a collaboration: YouTube says
  // "Pierce The Veil - King for a Day ft. Kellin Quinn", the catalog files it under
  // Kellin Quinn. So offer the featured act as an artist reading too.
  const feat = t1.match(/\b(?:feat|ft|featuring|with)\.?\s+(.+)$/i);
  if (feat) {
    const featured = clean(feat[1].replace(/[)\]].*$/, ''));
    const bare = clean(t1.replace(/\s*\b(?:feat|ft|featuring|with)\.?\s+.*$/i, ''));
    const inner = bare.match(/^(.*?)\s*[-–—:]\s+(.*)$/);
    if (featured) {
      if (inner) { push(inner[2], featured); push(inner[1], featured); }
      else push(bare, featured);
    }
  }
  return out;
}

/** Kept for callers that want a single best-guess reading. */
export function guessTrack(videoTitle: string, channel: string): { title: string; artist: string } {
  return trackCandidates(videoTitle, channel)[0] ?? { title: clean(videoTitle), artist: clean(channel) };
}

