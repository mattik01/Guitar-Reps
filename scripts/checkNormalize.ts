// Standalone chord-normalizer check. Run with `npm run check:normalize`.
// Exits non-zero on any mismatch so it can gate commits/CI.
import { parseChord, normalizeToLevel, knownSetAtLevel, isKnown } from '../src/data/chordNormalize';

type Case = { in: string; base: string; medium: string; exact: string };

// [token, expected base, expected medium, expected exact]
const CASES: Case[] = [
  { in: 'C',        base: 'C',   medium: 'C',   exact: 'C' },
  { in: 'Am',       base: 'Am',  medium: 'Am',  exact: 'Am' },
  { in: 'Cmaj7',    base: 'C',   medium: 'C7',  exact: 'Cmaj7' },
  { in: 'Am7',      base: 'Am',  medium: 'Am7', exact: 'Am7' },
  { in: 'G/B',      base: 'G',   medium: 'G',   exact: 'G/B' },
  { in: 'D/F#',     base: 'D',   medium: 'D',   exact: 'D/F#' },
  { in: 'Bb',       base: 'A#',  medium: 'A#',  exact: 'A#' },
  { in: 'A#',       base: 'A#',  medium: 'A#',  exact: 'A#' },
  { in: 'F (barre)',base: 'F',   medium: 'F',   exact: 'F' },
  { in: 'F (mini)', base: 'F',   medium: 'F',   exact: 'F' },
  { in: 'C#m7',     base: 'C#m', medium: 'C#m7',exact: 'C#m7' },
  { in: 'Dm',       base: 'Dm',  medium: 'Dm',  exact: 'Dm' },
  { in: 'E7',       base: 'E',   medium: 'E7',  exact: 'E7' },
  { in: 'Csus4',    base: 'C',   medium: 'C',   exact: 'Csus4' },
  { in: 'Gsus2',    base: 'G',   medium: 'G',   exact: 'Gsus2' },
  { in: 'Cadd9',    base: 'C',   medium: 'C7',  exact: 'Cadd9' }, // medium = coarse "has extension" flag
  { in: 'C:min',    base: 'Cm',  medium: 'Cm',  exact: 'Cm' },
  { in: 'C:maj7',   base: 'C',   medium: 'C7',  exact: 'Cmaj7' },
  { in: 'C:min7',   base: 'Cm',  medium: 'Cm7', exact: 'Cm7' },
  { in: 'Bdim',     base: 'Bm',  medium: 'Bm',  exact: 'Bdim' },
  { in: 'F#m',      base: 'F#m', medium: 'F#m', exact: 'F#m' },
  { in: 'Db',       base: 'C#',  medium: 'C#',  exact: 'C#' },
];

const failures: string[] = [];
for (const c of CASES) {
  const p = parseChord(c.in);
  if (!p.ok) { failures.push(`${c.in}: not parsed (ok=false)`); continue; }
  if (p.base !== c.base) failures.push(`${c.in}: base = "${p.base}", expected "${c.base}"`);
  if (p.medium !== c.medium) failures.push(`${c.in}: medium = "${p.medium}", expected "${c.medium}"`);
  if (p.exact !== c.exact) failures.push(`${c.in}: exact = "${p.exact}", expected "${c.exact}"`);
}

// Enharmonic equivalence at base/medium level.
if (normalizeToLevel('Bb', 'base') !== normalizeToLevel('A#', 'base')) failures.push('Bb !≡ A# at base');
if (normalizeToLevel('Db', 'exact') !== normalizeToLevel('C#', 'exact')) failures.push('Db !≡ C# at exact');

// The plan's worked example: repertoire {C,G,Am,F} vs song {C,Cmaj7,G/B,Am,F}.
const rep = ['C', 'G', 'Am', 'F'];
const song = ['C', 'Cmaj7', 'G/B', 'Am', 'F'];
{
  const knownBase = knownSetAtLevel(rep, 'base');
  const playableLenient = song.every(ch => isKnown(ch, knownBase, 'base'));
  if (!playableLenient) failures.push('lenient (base): song should be fully playable');

  const knownExact = knownSetAtLevel(rep, 'exact');
  const strictUnknown = song.filter(ch => !isKnown(ch, knownExact, 'exact'));
  // Strict should flag Cmaj7 and G/B.
  if (!(strictUnknown.includes('Cmaj7') && strictUnknown.includes('G/B') && strictUnknown.length === 2)) {
    failures.push(`strict (exact): expected [Cmaj7, G/B] unknown, got [${strictUnknown.join(', ')}]`);
  }
}

if (failures.length > 0) {
  console.error(`❌ chord-normalize check FAILED (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}
console.log(`✓ all ${CASES.length} normalization cases + enharmonic + match-level checks pass`);
