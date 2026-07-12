// Convert a Chordonomicon chord token into a standard chord symbol that
// src/data/chordNormalize.ts::parseChord understands.
//
// Chordonomicon conventions (observed in chordonomicon_v2.csv):
//   • 's' = sharp   → Cs  = C#,  Fsmin = F#m
//   • 'b' = flat    → Bb  = Bb,  Eb    = Eb
//   • 'min' = minor → Amin = Am
//   • 'no3d' = "no third" (power chord) → treat as '5' (C no3d → C5)
//   • slash bass uses the same spelling → A/Cs → A/C#
//   • structural tags like <verse_1>, <chorus_2> are NOT chords (caller must skip them)
//
// The one ambiguity: a leading 's' after the root is a sharp EXCEPT when it begins
// 'sus' (Csus4 = C-sus4, but Cssus4 = C#-sus4).

function convertPart(p: string): string {
  const m = /^([A-Ga-g])(.*)$/.exec(p);
  if (!m) return p; // e.g. a scale-degree bass like "3" — leave for parseChord to ignore
  const root = m[1].toUpperCase();
  let rest = m[2];
  let acc = '';
  if (/^sus/.test(rest)) {
    // 's' belongs to 'sus', not an accidental
  } else if (rest[0] === 's') {
    acc = '#';
    rest = rest.slice(1);
  } else if (rest[0] === 'b') {
    acc = 'b';
    rest = rest.slice(1);
  }
  rest = rest.replace(/^no3d/, '5'); // power chord (no third)
  rest = rest.replace(/^min/, 'm');  // Amin→Am, Amin7→Am7 (nicer for display; parseChord accepts both)
  return root + acc + rest;
}

export function chordonomiconToStandard(token: string): string {
  return token.split('/').map(convertPart).join('/');
}

/** True for a Chordonomicon structural tag like "<verse_1>" (not a chord). */
export function isStructuralTag(token: string): boolean {
  return token.startsWith('<');
}

export type ProgressionSection = { label: string; chords: string[] };

// Parse a raw Chordonomicon progression ("<intro_1> C G <verse_1> Am F …") into
// labelled sections with chord tokens converted to standard notation.
export function parseProgression(raw: string): ProgressionSection[] {
  const out: ProgressionSection[] = [];
  let cur: ProgressionSection | null = null;
  for (const tok of (raw || '').split(/\s+/)) {
    if (!tok) continue;
    if (isStructuralTag(tok)) {
      const label = tok.replace(/[<>]/g, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      cur = { label, chords: [] };
      out.push(cur);
    } else {
      if (!cur) { cur = { label: '', chords: [] }; out.push(cur); }
      cur.chords.push(chordonomiconToStandard(tok));
    }
  }
  return out;
}
