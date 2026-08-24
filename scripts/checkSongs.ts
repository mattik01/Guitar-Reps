// Song-level analysis: the section breakdown behind the chord-changes expander and
// the playability score Browse can sort by. Pure functions over a progression string
// plus the user's swap history — no DOM, no catalog.
import { analyzeSong, computeSongTransitions, playability, repertoireByBase } from '../src/data/songTransitions';
import { pairKey, type Chord, type ChordShape, type SwapRecord } from '../src/state/store';

const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── sections ────────────────────────────────────────────────────────────────
const RAW = '<intro_1> C C G G <verse_1> Amin Amin F F C <chorus_1> F G Cmaj7';

console.log('sections');
const a = analyzeSong(RAW);
check('one section per structural tag', a.sections.length === 3, JSON.stringify(a.sections.map(s => s.label)));
check('tags become readable labels', a.sections[0].label === 'Intro 1' && a.sections[2].label === 'Chorus 1');
check('consecutive repeats collapse', JSON.stringify(a.sections[0].chords) === JSON.stringify(['C', 'G']));
check('…with their bar counts kept', JSON.stringify(a.sections[0].repeats) === JSON.stringify([2, 2]));
check('chordonomicon spelling is converted', a.sections[1].chords[0] === 'Am');
check('untagged progressions still yield a section', analyzeSong('C G Am F').sections.length === 1);
check('an empty progression yields nothing', analyzeSong('').sections.length === 0);

// ── transitions ─────────────────────────────────────────────────────────────
console.log('transitions');
const t = computeSongTransitions(RAW);
const find = (x: string, y: string) => t.find(r => (r.a === x && r.b === y) || (r.a === y && r.b === x));
check('self-repeats are not transitions', !t.some(r => r.a === r.b));
check('counted undirected across the whole song', find('C', 'G')?.count === 2, JSON.stringify(t));
check('reduced to base triads (Cmaj7 → C)', find('C', 'G')!.count === 2 && !t.some(r => r.a.includes('maj')));
check('sorted most frequent first', t.every((r, i) => i === 0 || t[i - 1].count >= r.count));

// ── playability ─────────────────────────────────────────────────────────────
console.log('playability');
const SHAPE: ChordShape = { frets: [0, 2, 2, 1, 0, 0], fingers: [null, 2, 3, 1, null, null] };
const chord = (id: string): Chord => ({ id, name: id, shape: SHAPE, learnedAt: 0, perfectReps: 0 });
const owned = repertoireByBase([chord('C'), chord('G'), chord('Am'), chord('F')]);

function swap(a: string, b: string, perMin: number): Record<string, SwapRecord> {
  return {
    [pairKey(a, b)]: {
      pairKey: pairKey(a, b), chordA: a, chordB: b,
      bestCount: perMin, lastCount: perMin, attempts: 1, lastAt: 1, history: [],
    },
  };
}

const TEMPO = 120; // → green target 60/min, red floor 15/min
const one = [{ a: 'C', b: 'G', count: 10 }];

check('no transitions → no score', playability([], TEMPO, owned, {}) === null);
check('every change at the green target → 100%', playability(one, TEMPO, owned, swap('C', 'G', 60)) === 100);
check('above the target still caps at 100%', playability(one, TEMPO, owned, swap('C', 'G', 200)) === 100);
check('at the red floor → 0%', playability(one, TEMPO, owned, swap('C', 'G', 15)) === 0);
check('halfway → 50%', playability(one, TEMPO, owned, swap('C', 'G', 37.5)) === 50);
check('never trained → 0%', playability(one, TEMPO, owned, {}) === 0);
check('a chord you do not own → 0%', playability([{ a: 'C', b: 'Bb', count: 10 }], TEMPO, owned, {}) === 0);
check('nothing ever goes below 0%',
  [0, 1, 5, 14].every(rate => playability(one, TEMPO, owned, swap('C', 'G', rate)) === 0));

// The score is the fraction of the all-green maximum, so it is weighted by how often
// each change occurs — an untrained change that happens once barely costs anything.
const trainedFast = swap('C', 'G', 60);
const rareGap = playability([{ a: 'C', b: 'G', count: 100 }, { a: 'Am', b: 'F', count: 1 }], TEMPO, owned, trainedFast);
const commonGap = playability([{ a: 'C', b: 'G', count: 100 }, { a: 'Am', b: 'F', count: 100 }], TEMPO, owned, trainedFast);
check('a rare untrained change costs less than a frequent one',
  rareGap != null && commonGap != null && rareGap > commonGap, `${rareGap}% vs ${commonGap}%`);
check('weighted by count, not by distinct pair', rareGap === Math.round(100 / 101 * 100), `${rareGap}%`);
check('half the song trained to target → 50%', commonGap === 50, `${commonGap}%`);

console.log('');
if (failures.length) {
  console.error(`✗ ${failures.length} song-analysis check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('✓ all section, transition and playability checks passed');
