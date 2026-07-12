// Validate the Chordonomicon token converter against real data.
// Run: `npm run check:chordonomicon`
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { chordonomiconToStandard, isStructuralTag } from '../src/data/chordonomicon';
import { parseChord } from '../src/data/chordNormalize';

// --- unit assertions -------------------------------------------------------
const UNIT: Array<[string, string, string]> = [
  // [chordonomicon token, expected standard, expected parseChord.base]
  // The converter fixes accidentals ('s'→'#'), 'no3d'→'5', and 'min'→'m' (nicer display).
  ['Cs', 'C#', 'C#'],
  ['Amin', 'Am', 'Am'],
  ['Fsmin', 'F#m', 'F#m'],
  ['Bb', 'Bb', 'A#'],
  ['Csmin', 'C#m', 'C#m'],
  ['A/Cs', 'A/C#', 'A'],
  ['Csus4', 'Csus4', 'C'],
  ['Cssus4', 'C#sus4', 'C#'],   // C# sus4 — the ambiguity case
  ['Cno3d', 'C5', 'C'],          // power chord
  ['Amin7', 'Am7', 'Am'],
  ['Dmaj7', 'Dmaj7', 'D'],
  ['Gs', 'G#', 'G#'],
];

const failures: string[] = [];
for (const [tok, std, base] of UNIT) {
  const got = chordonomiconToStandard(tok);
  if (got !== std) failures.push(`convert("${tok}") = "${got}", expected "${std}"`);
  const p = parseChord(got);
  if (!p.ok) failures.push(`parseChord("${got}") failed (from "${tok}")`);
  else if (p.base !== base) failures.push(`base("${tok}"→"${got}") = "${p.base}", expected "${base}"`);
}

// --- real-data parse-rate check -------------------------------------------
const SAMPLE_ROWS = 20000;
const csv = readFileSync('data/raw/chordonomicon_v2.csv', 'utf8');
// Parse just the first SAMPLE_ROWS+1 lines to stay fast.
const head = csv.split('\n').slice(0, SAMPLE_ROWS + 1).join('\n');
const rows: string[][] = parse(head, { relaxQuotes: true, relaxColumnCount: true, skipEmptyLines: true });
const ci = rows[0].indexOf('chords');

let total = 0, ok = 0;
const badTokens = new Map<string, number>();
for (const r of rows.slice(1)) {
  const field = r[ci] ?? '';
  for (const raw of field.split(/\s+/)) {
    if (!raw || isStructuralTag(raw)) continue;
    total++;
    const p = parseChord(chordonomiconToStandard(raw));
    if (p.ok) ok++;
    else badTokens.set(raw, (badTokens.get(raw) ?? 0) + 1);
  }
}
const rate = total ? (100 * ok / total) : 0;
console.log(`Real-data parse rate: ${ok}/${total} = ${rate.toFixed(2)}% over ${SAMPLE_ROWS} songs`);
const worstBad = [...badTokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
if (worstBad.length) console.log('Top unparseable tokens:', worstBad);

if (failures.length) {
  console.error(`\n❌ chordonomicon check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
if (rate < 97) {
  console.error(`\n❌ parse rate ${rate.toFixed(2)}% below 97% threshold`);
  process.exit(1);
}
console.log(`\n✓ ${UNIT.length} unit cases pass; real-data parse rate ${rate.toFixed(2)}% ≥ 97%`);
