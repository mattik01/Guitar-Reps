// Standalone sanity check for the CalibrationProfile math. Run with
// `npm run check:profiles`. No Web Audio — pure functions only.
import {
  profilePrototype, profileScore, profileThresholds, profileTypicalSim,
  samplesLeftToMinScore, CAL_SCORE_TARGET_WEIGHT,
} from '../src/audio/calibration';
import { cosineSim, l2Normalize } from '../src/audio/chroma';
import { checkSignal, type ChordSignal, type ChordTarget } from '../src/audio/signalContract';
import type { CalibrationSample } from '../src/state/store';

let failed = false;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`✓ ${name}`);
  else { console.error(`❌ ${name} ${detail}`); failed = true; }
}

const S = (
  chroma: number[] | undefined, sim: number, weight: number,
  source: CalibrationSample['source'] = 'single',
): CalibrationSample => ({ chroma, sim, weight, source, at: 0 });

// C-major-ish chroma directions (C, E, G bins lit)
const cA = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0];
const cB = [1, 0, 0, 0, 0.8, 0, 0, 1, 0, 0, 0, 0.2];

// 1. prototype = weighted average, re-normalized to unit length
const proto = profilePrototype([S(cA, 0.9, 1), S(cB, 0.8, 1)]);
check('prototype non-null with chroma samples', proto !== null);
if (proto) {
  const norm = Math.sqrt(proto.reduce((s, x) => s + x * x, 0));
  check('prototype is unit norm', Math.abs(norm - 1) < 1e-5, `norm=${norm.toFixed(4)}`);
  const mean = l2Normalize(Float32Array.from(cA.map((v, i) => (v + cB[i]) / 2)));
  check('prototype ≈ mean direction', cosineSim(proto, mean) > 0.999);
}

// 2. heavier-weighted sample dominates the prototype
const pW = profilePrototype([S(cA, 0.9, 5), S(cB, 0.8, 0.1)]);
const dirA = l2Normalize(Float32Array.from(cA));
const dirB = l2Normalize(Float32Array.from(cB));
check('weighted prototype leans to the heavy sample',
  !!pW && cosineSim(pW, dirA) > cosineSim(pW, dirB));

// 3. prototype null when no sample carries chroma
check('prototype null for sim-only samples',
  profilePrototype([S(undefined, 0.9, 1, 'legacy')]) === null);

// 4. score: 0 empty, caps at 100, ~50 at half target weight
check('score 0 when empty', profileScore([]) === 0);
check('score caps at 100', profileScore([S(cA, 0.9, 100)]) === 100);
check('score ≈50 at half target weight',
  Math.abs(profileScore([S(cA, 0.9, CAL_SCORE_TARGET_WEIGHT / 2)]) - 50) <= 1);

// 5. thresholds + typical sim from the sims
const simSamples = [0.80, 0.82, 0.85, 0.83, 0.81].map(s => S(cA, s, 1));
const th = profileThresholds(simSamples);
check('thresholds computed with enough samples', th !== null);
if (th) check('match ≥ unsure', th.match >= th.unsure, `match=${th.match.toFixed(3)} unsure=${th.unsure.toFixed(3)}`);
const typ = profileTypicalSim(simSamples);
check('typical sim in a sane range', typ !== null && typ > 0.7 && typ < 0.9, `typ=${typ}`);

// 6. samplesLeftToMinScore shrinks to 0 as weight accrues
check('needs samples when empty', samplesLeftToMinScore([]) > 0);
check('needs 0 more once fully weighted',
  samplesLeftToMinScore([S(cA, 0.9, CAL_SCORE_TARGET_WEIGHT)]) === 0);

// 7. signal contract — checkSignal at the mic↔calibration boundary
const tpl = l2Normalize(Float32Array.from(cA)); // treat cA direction as the "template"
const target: ChordTarget = { id: 'C', template: tpl, expectedPcs: [0, 4, 7] };
const sig = (chroma: number[], cleanliness: number | null): ChordSignal =>
  ({ at: 0, chroma, cleanliness, sustain: 0.8, activePcCount: 3 });

const onChord = checkSignal(sig(cA, 85), target);
check('clean on-chord signal is a match', onChord.isMatch && onChord.similarity > 0.9);
check('clean on-chord has high quality weight', onChord.quality > 0.7);
check('clean on-chord has no warnings', onChord.warnings.length === 0);

const offChord = checkSignal(sig([0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0], 85), target);
check('off-chord signal → quality 0 (not recorded)', offChord.quality === 0);
check('off-chord signal → off-chord warning', offChord.warnings.includes('off-chord'));

const muddy = checkSignal(sig(cA, 30), target);
check('muddy on-chord still records (quality > 0)', muddy.quality > 0);
check('muddy on-chord → muddy warning', muddy.warnings.includes('muddy'));
check('muddy quality < clean quality', muddy.quality < onChord.quality);

if (failed) { console.error('\nprofile checks FAILED'); process.exit(1); }
console.log('\n✓ all CalibrationProfile + signal-contract checks passed');
