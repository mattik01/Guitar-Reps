// Chord normalization — the single source of truth for turning an arbitrary chord
// token (from the seeded catalog, from a pasted sheet, or from a repertoire entry)
// into canonical forms we can compare.
//
// Three "match levels" let the UI trade precision for leniency:
//   • base   (lenient) — root triad only: Cmaj7 → C, G/B → G, Bb → A#. If you know
//                        the plain shape you're deemed able to play it.
//   • medium           — root + minor/major + a coarse "has a 7th/extension" flag.
//   • exact  (strict)  — full quality + slash bass preserved: Cmaj7 ≠ C, G/B ≠ G.
//
// Used by BOTH scripts/buildCatalog.ts (to fill song_chords.chord_{exact,medium,base})
// and the runtime repertoire match, so the catalog and hand-entered songs agree.

export type MatchLevel = 'exact' | 'medium' | 'base';

export type ParsedChord = {
  ok: boolean;        // false if we couldn't recognise a root
  raw: string;        // original token (trimmed)
  rootPc: number;     // 0..11 pitch class of the root (null-ish → -1 when !ok)
  minor: boolean;     // minor third present
  seventh: boolean;   // carries a 7th / 6th / 9/11/13 extension
  quality: string;    // normalised quality symbol ('', 'm', 'maj7', '7', 'sus4', 'dim', …)
  bassPc: number;     // pitch class of slash bass, or -1 if none / non-pitch bass
  exact: string;
  medium: string;
  base: string;
};

// Canonical pitch-class spellings (sharps).
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Strip voicing descriptors the app itself adds, e.g. "F (barre)" / "F (mini)",
// and surrounding whitespace. A trailing " (word)" (space before paren) is a
// descriptor, not a chord tension like C(add9) which has no space.
function stripDescriptor(token: string): string {
  return token.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Parse the leading root (letter + accidentals) → pitch class + consumed length.
function parseRoot(s: string): { pc: number; len: number } | null {
  const m = /^([A-Ga-g])([#b♯♭]*)/.exec(s);
  if (!m) return null;
  let pc = LETTER_SEMITONE[m[1].toUpperCase()];
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') pc += 1;
    else if (ch === 'b' || ch === '♭') pc -= 1;
  }
  pc = ((pc % 12) + 12) % 12;
  return { pc, len: m[0].length };
}

// Normalise a raw quality string (already lowercased, ':'/spaces removed) into a
// canonical symbol, and classify minor/seventh. Handles common pop + Harte forms.
function classifyQuality(qRaw: string): { quality: string; minor: boolean; seventh: boolean } {
  let q = qRaw.replace(/^:/, '').replace(/\s+/g, '');

  // Symbol synonyms → words (case-sensitive: preserves the crucial m vs M distinction).
  q = q
    .replace(/^[Δ△]/, 'maj7')
    .replace(/^°/, 'dim')
    .replace(/^ø/, 'm7b5')
    .replace(/^\+/, 'aug')
    .replace(/^-/, 'm');

  // Protect major markers BEFORE lowercasing: "Maj"/"MAJ"/"Major", or a bare
  // uppercase "M" used as a major-seventh marker (M7, M9…). Then it's safe to lower.
  q = q.replace(/^(maj|major)/i, 'maj').replace(/^M(?=6|7|9|11|13|$)/, 'maj');
  q = q.toLowerCase();

  const minor = /^(m|min|dim)/.test(q) && !/^maj/.test(q);
  const seventh = /(6|7|9|11|13)/.test(q);

  // Canonical quality symbol for display in `exact`.
  let quality: string;
  if (q === '' || q === 'maj' || q === 'major') quality = '';
  else if (q === 'm' || q === 'min' || q === 'minor') quality = 'm';
  else if (/^maj/.test(q)) quality = q;                        // maj7, maj9, maj13…
  else if (q === 'm7b5' || /^m(in)?7b5$/.test(q)) quality = 'm7b5';
  else if (/^dim7$/.test(q)) quality = 'dim7';
  else if (/^dim$/.test(q)) quality = 'dim';
  else if (/^aug/.test(q)) quality = 'aug';
  else if (/^sus2/.test(q)) quality = 'sus2';
  else if (/^sus/.test(q)) quality = 'sus4';
  else if (/^(min|m)/.test(q)) quality = 'm' + q.replace(/^(min|m)/, ''); // m7, m9, m6…
  else quality = q;                                            // 7, 9, add9, 11, 13…

  return { quality, minor, seventh };
}

export function parseChord(rawInput: string): ParsedChord {
  const raw = (rawInput ?? '').trim();
  const cleaned = stripDescriptor(raw);
  const miss: ParsedChord = {
    ok: false, raw, rootPc: -1, minor: false, seventh: false,
    quality: '', bassPc: -1, exact: raw, medium: raw, base: raw,
  };
  if (!cleaned || cleaned === 'N.C.' || cleaned.toUpperCase() === 'NC') return miss;

  // Split slash bass (last '/'). Bass may be a note or a scale degree (Harte "/3").
  let head = cleaned;
  let bassPc = -1;
  const slash = cleaned.lastIndexOf('/');
  if (slash > 0) {
    head = cleaned.slice(0, slash);
    const bass = cleaned.slice(slash + 1);
    const br = parseRoot(bass);
    if (br && br.len === bass.length) bassPc = br.pc; // a real note bass, not a "/3" degree
  }

  // Harte colon form: "C:min7" → root "C", quality "min7".
  const colon = head.indexOf(':');
  let rootStr = head;
  let qStr = '';
  if (colon >= 0) {
    rootStr = head.slice(0, colon);
    qStr = head.slice(colon + 1);
  }
  const root = parseRoot(rootStr);
  if (!root) return miss;
  if (colon < 0) qStr = rootStr.slice(root.len); // quality is whatever follows the root

  const { quality, minor, seventh } = classifyQuality(qStr);
  const rootName = PC_NAMES[root.pc];

  const base = rootName + (minor ? 'm' : '');
  const medium = base + (seventh ? '7' : '');
  const bassName = bassPc >= 0 ? '/' + PC_NAMES[bassPc] : '';
  const exact = rootName + quality + bassName;

  return { ok: true, raw, rootPc: root.pc, minor, seventh, quality, bassPc, exact, medium, base };
}

/** Canonical string for a token at a given match level (used for both sides of a compare). */
export function normalizeToLevel(token: string, level: MatchLevel): string {
  const p = parseChord(token);
  if (!p.ok) return token.trim().toLowerCase(); // unknown token: compare literally
  return level === 'exact' ? p.exact : level === 'medium' ? p.medium : p.base;
}

/** Build a Set of a repertoire's chords normalised at `level`, for fast membership tests. */
export function knownSetAtLevel(knownTokens: Iterable<string>, level: MatchLevel): Set<string> {
  const s = new Set<string>();
  for (const t of knownTokens) s.add(normalizeToLevel(t, level));
  return s;
}

/** Is `chordToken` covered by the user's known set, at the given strictness? */
export function isKnown(chordToken: string, knownSet: Set<string>, level: MatchLevel): boolean {
  return knownSet.has(normalizeToLevel(chordToken, level));
}
