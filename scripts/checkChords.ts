// Standalone chord-data check. Run with `npm run check:chords`.
// Exits non-zero if any chord fails structure/fingering/harmony validation, so it
// can gate commits or CI. The same validator also runs at app startup (dev throws).
import { CHORD_LIBRARY } from '../src/data/chordLibrary';
import { validateLibrary } from '../src/data/validateChords';

const issues = validateLibrary(CHORD_LIBRARY);
if (issues.length > 0) {
  console.error(`❌ chord validation FAILED (${issues.length} issue${issues.length === 1 ? '' : 's'}):`);
  for (const i of issues) console.error(`  • ${i.chordId}: ${i.message}`);
  process.exit(1);
}
console.log(`✓ all ${CHORD_LIBRARY.length} chords valid (structure + fingering + harmony)`);
