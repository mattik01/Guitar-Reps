// Standalone chroma-template sanity check. Run with `npm run check:chroma`.
//
// 1. FAILS if any library chord's primary fingering sounds fewer than 3 distinct
//    pitch classes — such a template can't be verified by the mic (and would be
//    filtered as a "knock" at runtime).
// 2. WARNS (never fails) on chord pairs whose templates are nearly parallel
//    (cosine > 0.9). These are the pairs the swap classifier will call "unsure"
//    — absorbed by design via the alternation fallback, but worth knowing.
import { CHORD_LIBRARY, libraryPrimaryShape } from '../src/data/chordLibrary';
import { chordTemplate, cosineSim } from '../src/audio/chroma';
import { soundingPitchClasses } from '../src/data/validateChords';

const HARD_PAIR_SIMILARITY = 0.9;

let failed = false;
const templates: { id: string; name: string; tpl: Float32Array }[] = [];

for (const chord of CHORD_LIBRARY) {
  const shape = libraryPrimaryShape(chord);
  const distinct = new Set(soundingPitchClasses(shape));
  if (distinct.size < 3) {
    console.error(`❌ ${chord.id}: only ${distinct.size} distinct pitch classes — undetectable as a chord`);
    failed = true;
    continue;
  }
  templates.push({ id: chord.id, name: chord.name, tpl: chordTemplate(shape) });
}

const hardPairs: string[] = [];
for (let i = 0; i < templates.length; i++) {
  for (let j = i + 1; j < templates.length; j++) {
    const sim = cosineSim(templates[i].tpl, templates[j].tpl);
    if (sim > HARD_PAIR_SIMILARITY) {
      hardPairs.push(`${templates[i].name} ↔ ${templates[j].name} (${sim.toFixed(3)})`);
    }
  }
}

if (hardPairs.length > 0) {
  console.warn(`⚠ ${hardPairs.length} chord pair${hardPairs.length === 1 ? '' : 's'} hard to tell apart by ear-machine (template cosine > ${HARD_PAIR_SIMILARITY}):`);
  for (const p of hardPairs) console.warn(`  • ${p}`);
  console.warn('  (expected — the swap counter falls back to assuming alternation for these)');
}

if (failed) process.exit(1);
console.log(`✓ ${templates.length} chord templates sane (≥3 distinct pitch classes each)`);
