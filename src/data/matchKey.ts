// One normalizer for matching a (title, artist) pair against the catalog, shared by
// the catalog build (which stores `songs.match_key`) and by playlist import.
//
// Before this existed the app had three separate dialects — the DuckDB macros in the
// offline Spotify→YouTube pipeline, buildCatalog's `normArtistTitle`, and
// spotifyImport's bare `${title}|${artist}`.toLowerCase() — so an import only matched
// when the strings were byte-identical. "Black Hole Sun" never found
// "Black Hole Sun - Recorded Live At Red Robinson Show Theatre, Vancouver".
//
// Kept deliberately in step with data/raw/spotify-youtube/match.py's nt2/na_full.

const TAIL =
  'remaster|remastered|live|version|edit|mix|mono|stereo|deluxe|acoustic|radio|remix|demo|' +
  'instrumental|single|album|bonus track|bonus|soundtrack|original|re-?recorded|rerecorded|' +
  'anniversary|session|sessions|take|clean|explicit|extended|karaoke|theme|edition|cut|' +
  'recorded live|unplugged';

function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[‘’“”'"`]/g, ''); // quotes, incl. smart ones
}

export function normTitle(input: string): string {
  let s = fold(String(input ?? ''));
  s = s.replace(/\(.*?\)|\[.*?\]/g, ' ');          // (Official Video), [HD]
  s = s.replace(/\s[-–—]\s+from\s.*$/g, ' ');       // - From "Despicable Me 2"
  s = s.replace(new RegExp(`\\s[-–—]\\s+.*(${TAIL}).*$`, 'g'), ' ');
  s = s.replace(/\bfeat\.?\b.*|\bft\.?\b.*|\bfeaturing\b.*/g, ' ');
  s = s.replace(/\bpt\.?\b/g, 'part');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normArtist(input: string): string {
  let s = fold(String(input ?? ''));
  s = s.replace(/^the\s+/, ' ');
  s = s.replace(/\s+\b(feat\.?|ft\.?|featuring|with)\b.*$/g, ' ');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The value stored in `songs.match_key` and looked up on import. */
export function matchKey(title: string, artist: string): string {
  return `${normTitle(title)}|${normArtist(artist)}`;
}
