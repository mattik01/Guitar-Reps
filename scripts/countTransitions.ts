// Count chord transitions across every Chordonomicon song that has a Spotify ID
// (i.e. the songs that will eventually land in the catalog DB).
//
// Run: esbuild scripts/countTransitions.ts --bundle --platform=node --format=esm | node --input-type=module
//
// Output:
//   • data/raw/transitions.csv       — from,to,count  (every directed pair, sorted desc)
//   • data/raw/transitions-base.csv  — same, but chords reduced to their base triad (E7→E, Am7→Am)
//   • prints the top 40 to stdout
import fs from 'node:fs';
import { parse } from 'csv-parse';
import { chordonomiconToStandard, isStructuralTag } from '../src/data/chordonomicon';
import { parseChord } from '../src/data/chordNormalize';

const CSV = 'data/raw/chordonomicon_v2.csv';

// base = root (+ accidental) + minor flag only, dropping 7ths/sus/add/slash-bass.
function baseChord(std: string): string | null {
  const pc = parseChord(std);
  return pc.ok ? pc.base : null;
}

const full = new Map<string, number>();
const base = new Map<string, number>();
let songs = 0;
let withId = 0;

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

const parser = fs.createReadStream(CSV).pipe(
  parse({ columns: true, skip_empty_lines: true, relax_quotes: true }),
);

for await (const row of parser) {
  songs++;
  if (!row.spotify_song_id) continue;
  withId++;

  const fullSeq: string[] = [];
  const baseSeq: (string | null)[] = [];
  for (const tok of String(row.chords || '').split(/\s+/)) {
    if (!tok || isStructuralTag(tok)) continue;
    const std = chordonomiconToStandard(tok);
    fullSeq.push(std);
    baseSeq.push(baseChord(std));
  }

  for (let i = 1; i < fullSeq.length; i++) {
    const a = fullSeq[i - 1], b = fullSeq[i];
    if (a !== b) bump(full, `${a}\t${b}`);
    const ba = baseSeq[i - 1], bb = baseSeq[i];
    if (ba && bb && ba !== bb) bump(base, `${ba}\t${bb}`);
  }
}

function dump(m: Map<string, number>, path: string) {
  const rows = [...m.entries()].sort((x, y) => y[1] - x[1]);
  const out = 'from,to,count\n' + rows.map(([k, c]) => `${k.replace('\t', ',')},${c}`).join('\n') + '\n';
  fs.writeFileSync(path, out);
  return rows;
}

const fullRows = dump(full, 'data/raw/transitions.csv');
dump(base, 'data/raw/transitions-base.csv');

const totalTransitions = [...full.values()].reduce((a, b) => a + b, 0);
console.log(`Scanned ${songs.toLocaleString()} songs; ${withId.toLocaleString()} had a Spotify ID.`);
console.log(`${totalTransitions.toLocaleString()} total transitions, ${full.size.toLocaleString()} distinct directed pairs.\n`);
console.log('Top 40 transitions (full chord form):');
for (const [k, c] of fullRows.slice(0, 40)) {
  const [a, b] = k.split('\t');
  console.log(`  ${a.padEnd(6)} → ${b.padEnd(6)}  ${c.toLocaleString()}`);
}
