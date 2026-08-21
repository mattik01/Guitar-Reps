// Standalone sanity check for the CalibrationProfile math. Run with
// `npm run check:profiles`. No Web Audio — pure functions only.
import {
  profilePrototype, profileScore, profileThresholds, profileTypicalSim,
  profileTypicalSimAgainst, chordTargetFromProfile, evaluateCalibrationGate, shapeKey,
  samplesLeftToMinScore, CAL_SCORE_TARGET_WEIGHT, CAL_MIN_SCORE,
} from '../src/audio/calibration';
import { chromaSpread, computeCleanliness, presence, applyChromaFloor, chordTemplate } from '../src/audio/chroma';
import { cosineSim, l2Normalize } from '../src/audio/chroma';
import {
  bestOfSignal, checkSignal, chordTargetFromShape, SIGNAL_AMBIGUOUS_MARGIN,
  type ChordSignal, type ChordTarget,
} from '../src/audio/signalContract';
import type { CalibrationSample, ChordShape } from '../src/state/store';

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

// ---------------------------------------------------------------------------
// 8. chordTargetFromProfile — degrades to the template, upgrades with a reference
// ---------------------------------------------------------------------------
const C_SHAPE: ChordShape = { frets: ['x', 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null] };

const bare = chordTargetFromProfile('C', C_SHAPE, []);
check('uncalibrated target has no reference', bare.reference == null);
check('uncalibrated target has no thresholds',
  bare.matchThreshold === undefined && bare.unsureThreshold === undefined);
check('uncalibrated target has no typicalSim', bare.typicalSim === undefined);
// THE no-regression proof: uncalibrated behaves exactly like the plain shape target.
const plain = chordTargetFromShape('C', C_SHAPE);
const probe = sig([1, 0, 0, 0, 0.9, 0, 0, 0.95, 0, 0, 0, 0], 80);
check('uncalibrated target scores IDENTICALLY to the plain shape target',
  checkSignal(probe, bare).similarity === checkSignal(probe, plain).similarity &&
  checkSignal(probe, bare).verdict === checkSignal(probe, plain).verdict);

// A rig whose captured chord leans off-template (an extra ringing pitch class).
const rigChroma = [1, 0, 0, 0, 0.9, 0, 0, 0.95, 0, 0.55, 0, 0];
const rigSamples = Array.from({ length: 6 }, () => S(rigChroma, 0.8, 0.8));
const learned = chordTargetFromProfile('C', C_SHAPE, rigSamples);
check('calibrated target has a reference', learned.reference != null);
check('calibrated target has thresholds', learned.matchThreshold !== undefined);
check('calibrated target has a typicalSim', learned.typicalSim !== undefined);
const rigProbe = sig(rigChroma, 80);

// ---------------------------------------------------------------------------
// 8b. THE property that matters: a learned reference must DISCRIMINATE better,
// not merely score higher. Real-guitar finding (2026-08-20): a prototype learned
// from real audio carries the rig's broadband signature on every pitch class, and
// that signature is identical for every chord played on that rig. Scored with
// plain cosine it returned a high similarity for ANY chord — "I can strum
// whatever chord and get a high score, but the template gets angry."
// These assertions fail if that regresses.
// ---------------------------------------------------------------------------
// A rig with real-world broadband bleed on every pitch class.
const RIG = [.30, .22, .28, .20, .32, .24, .26, .30, .22, .28, .20, .26];
const onRig = (pcs: number[]) => RIG.map((r, i) => r + (pcs.includes(i) ? 1 : 0));
const C_PCS = [0, 4, 7], G_PCS = [7, 11, 2], D_PCS = [2, 6, 9];
// Real strums vary a LOT: the user's 21-sample E profile spanned 0.50-0.98 in
// centered similarity. Samples must carry that spread, or every threshold looks
// fine and the recall guard below tests nothing.
const jittered = (k: number) => {
  const v = onRig(C_PCS);
  // deterministic per-sample wobble: bleed drifts, one chord tone rings less
  return v.map((x, i) => x * (1 + 0.45 * Math.sin(k * 2.7 + i * 1.9))
    + (i === C_PCS[(k + 1) % 3] ? -0.45 : 0));
};
const rigSampled = [0, 1, 2, 3, 4, 5, 6, 7].map(k => S(jittered(k), 0.8, 0.8));
const rigLearned = chordTargetFromProfile('C', C_SHAPE, rigSampled);
const rigPlain = chordTargetFromShape('C', C_SHAPE);

const sepOf = (t: ChordTarget) => {
  const right = checkSignal(sig(onRig(C_PCS), 80), t).similarity;
  const worst = Math.max(
    checkSignal(sig(onRig(G_PCS), 80), t).similarity,
    checkSignal(sig(onRig(D_PCS), 80), t).similarity,
  );
  return right - worst;
};
check('a rig-learned reference separates right-vs-wrong AT LEAST as well as the template',
  sepOf(rigLearned) >= sepOf(rigPlain),
  `learned sep=${sepOf(rigLearned).toFixed(3)} template sep=${sepOf(rigPlain).toFixed(3)}`);
check('a WRONG chord does not score as a match against a rig-learned reference',
  !checkSignal(sig(onRig(D_PCS), 80), rigLearned).isMatch,
  `sim=${checkSignal(sig(onRig(D_PCS), 80), rigLearned).similarity.toFixed(3)}`);
check('the RIGHT chord still scores as a match against a rig-learned reference',
  checkSignal(sig(onRig(C_PCS), 80), rigLearned).isMatch,
  `sim=${checkSignal(sig(onRig(C_PCS), 80), rigLearned).similarity.toFixed(3)}`);

// Recall guard (real-guitar regression, 2026-08-20): the threshold derived from a
// chord's own calibration samples must actually ADMIT those samples. The old
// q25 × 0.94 rule, applied to the wider centered-correlation scale, admitted only
// ~76% of them — the user's live strums matched about half the time. Assert both
// sides: most of your own clean strums pass, AND a wrong chord still doesn't.
const rigTypical = rigSampled.map(s => checkSignal(sig(s.chroma!, 80), rigLearned));
const admitted = rigTypical.filter(c => c.isMatch).length / rigTypical.length;
check('a chord\'s own calibration samples pass its own threshold (recall)',
  admitted >= 0.85, `only ${(admitted * 100).toFixed(0)}% admitted`);
check('recall does not come at the cost of admitting a wrong chord',
  !checkSignal(sig(onRig(D_PCS), 80), rigLearned).isMatch);
// There must be real daylight between the two, not a knife-edge threshold.
const rightMin = Math.min(...rigTypical.map(c => c.similarity));
const wrongBest = Math.max(
  checkSignal(sig(onRig(G_PCS), 80), rigLearned).similarity,
  checkSignal(sig(onRig(D_PCS), 80), rigLearned).similarity,
);
check('the match threshold sits in the gap, not on top of the right-chord tail',
  (rigLearned.matchThreshold ?? 0) <= rightMin && (rigLearned.matchThreshold ?? 0) > wrongBest,
  `threshold=${rigLearned.matchThreshold?.toFixed(3)} rightMin=${rightMin.toFixed(3)} wrongBest=${wrongBest.toFixed(3)}`);

// A prototype too flat to identify anything must be refused outright, so it can
// never be the thing that makes every chord match.
const flatSamples = [0, 1, 2, 3, 4, 5].map(() => S(Array(12).fill(1), 0.8, 0.8));
check('a flat prototype is measured as flat', chromaSpread(Float32Array.from(Array(12).fill(1))) < 0.01);
check('a flat prototype is REFUSED as a reference (falls back to the template)',
  chordTargetFromProfile('C', C_SHAPE, flatSamples).reference == null);
check('sim-only samples cannot build a reference → degrades to template',
  chordTargetFromProfile('C', C_SHAPE, [S(undefined, 0.9, 1, 'legacy')]).reference == null);

// ---------------------------------------------------------------------------
// 9. similarity SCALE consistency (thresholds measured on the scale we score on)
// ---------------------------------------------------------------------------
const refOnly = chordTargetFromShape('C', C_SHAPE, { reference: learned.reference });
const typTemplateScale = profileTypicalSim(rigSamples);           // stored template-scale sims
const typRefScale = profileTypicalSimAgainst(rigSamples, refOnly); // re-measured
check('reference-scale typicalSim exceeds the stored template-scale one',
  typRefScale != null && typTemplateScale != null && typRefScale > typTemplateScale,
  `ref=${typRefScale?.toFixed(3)} tpl=${typTemplateScale?.toFixed(3)}`);
const ratio = checkSignal(rigProbe, learned).similarity / (learned.typicalSim ?? 1);
check('a rig-typical strum lands near the reference-scale typicalSim (ratio ~1)',
  ratio > 0.9 && ratio < 1.1, `ratio=${ratio.toFixed(3)}`);

// ---------------------------------------------------------------------------
// 10. bestOfSignal — must mirror the engine classifier exactly
// ---------------------------------------------------------------------------
const tA: ChordTarget = { id: 'A', template: l2Normalize(Float32Array.from(cA)), expectedPcs: [0, 4, 7] };
const dChroma = [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0];
const tB: ChordTarget = { id: 'B', template: l2Normalize(Float32Array.from(dChroma)), expectedPcs: [2, 6, 9] };

const pickA = bestOfSignal(sig(cA, 85), [tA, tB]);
check('bestOfSignal picks the matching target', pickA.best === 'A' && pickA.ranked[0].id === 'A');
check('bestOfSignal is not ambiguous for a clear winner', pickA.ambiguous === false);

const twin: ChordTarget = { ...tA, id: 'A2' };
const tie = bestOfSignal(sig(cA, 85), [tA, twin]);
check('identical targets → ambiguous, best null', tie.best === null && tie.ambiguous === true);
check('identical targets → margin 0', Math.abs(tie.margin) < 1e-9);

const solo = bestOfSignal(sig(dChroma, 85), [tA]);
check('a single target is ALWAYS confident (even on a poor match)',
  solo.best === 'A' && solo.ambiguous === false && solo.margin === 0);

// The margin comparison is STRICTLY greater-than, matching the engine. An exactly-
// equal gap isn't constructible in floating point, so pin both sides of the
// boundary instead — that's what actually guards against an off-by-one here.
// (An operator slip is what would turn "suppress a confident repeat" into
// double-counting in the swap routine.)
const simA = checkSignal(sig(cA, 85), tA).similarity;
const twinOf = (gap: number): ChordTarget => ({
  ...tA, id: 'TWIN', typicalSim: simA / (simA - gap),   // scores exactly `gap` below tA
});
const justUnder = bestOfSignal(sig(cA, 85), [tA, twinOf(SIGNAL_AMBIGUOUS_MARGIN * 0.9)]);
check('a gap just UNDER the margin is ambiguous',
  justUnder.best === null && justUnder.ambiguous === true, `margin=${justUnder.margin}`);
const justOver = bestOfSignal(sig(cA, 85), [tA, twinOf(SIGNAL_AMBIGUOUS_MARGIN * 1.1)]);
check('a gap just OVER the margin is decisive',
  justOver.best === 'A' && justOver.ambiguous === false, `margin=${justOver.margin}`);

// typicalSim normalization flips a winner that raw cosine would lose.
const flatB: ChordTarget = {
  id: 'FLAT', template: l2Normalize(Float32Array.from([1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1])),
  expectedPcs: [0, 4, 7, 9, 11],
};
const flatSig = sig([1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1], 85);
const rawWin = bestOfSignal(flatSig, [tA, flatB]);
const normWin = bestOfSignal(flatSig, [tA, { ...flatB, typicalSim: 0.6 }]);
check('typicalSim normalization can change the ranking',
  rawWin.ranked[0].check.similarity <= 1 && normWin.ranked[0].id === 'FLAT');
check('bestOfSignal on no targets is empty and not ambiguous', (() => {
  const r = bestOfSignal(sig(cA, 85), []);
  return r.ranked.length === 0 && r.best === null && r.ambiguous === false && r.margin === 0;
})());

// ---------------------------------------------------------------------------
// 11. the calibration gate
// ---------------------------------------------------------------------------
const good = Array.from({ length: 6 }, () => S(cA, 0.85, 0.8)); // score 100
const gAll = evaluateCalibrationGate({ C: { samples: good }, G: { samples: good } }, ['C', 'G']);
check('gate open when every chord is calibrated',
  gAll.ready && gAll.blocking.length === 0 && gAll.needs.size === 0);

const gLow = evaluateCalibrationGate({ C: { samples: good }, G: { samples: [S(cA, 0.8, 0.3)] } }, ['C', 'G']);
check('gate closed by a low-score chord', !gLow.ready);
check('gate names the blocking chord', gLow.blocking[0].chordId === 'G' && gLow.needs.has('G'));
check('blocking chord reports low-score', gLow.blocking[0].reason === 'low-score');
check('blocking chord reports samples still needed', gLow.blocking[0].samplesLeft > 0);

const gMissing = evaluateCalibrationGate({}, ['Bm']);
check('an unknown chord is uncalibrated and blocking',
  !gMissing.ready && gMissing.blocking[0].reason === 'uncalibrated' && gMissing.blocking[0].score === 0);

// THE anti-migration regression test: sim-only samples can reach score 100 but
// build no prototype, so they must NEVER open the gate.
const simOnly = [S(undefined, 0.9, 100, 'legacy')];
const gSimOnly = evaluateCalibrationGate({ C: { samples: simOnly } }, ['C']);
check('sim-only samples score 100 but do NOT open the gate',
  profileScore(simOnly) === 100 && !gSimOnly.ready && gSimOnly.blocking[0].reason === 'low-score');

const gShape = evaluateCalibrationGate(
  { C: { samples: good, shapeKey: 'old' } }, ['C'], { C: 'new' });
check('a changed shape closes the gate', !gShape.ready && gShape.blocking[0].reason === 'shape-changed');
const gNoKey = evaluateCalibrationGate({ C: { samples: good } }, ['C'], { C: 'new' });
check('a profile with no recorded shapeKey still counts as matching', gNoKey.ready);
check('an empty chord list leaves the gate open', evaluateCalibrationGate({}, []).ready);
check('gate score threshold is CAL_MIN_SCORE', CAL_MIN_SCORE === 60);

// shapeKey: reacts to the sound, ignores the fingering annotation
const base: ChordShape = { frets: ['x', 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null] };
check('shapeKey ignores `fingers`',
  shapeKey(base) === shapeKey({ ...base, fingers: [null, 2, 1, null, 4, null] }));
check('shapeKey reacts to `frets`',
  shapeKey(base) !== shapeKey({ ...base, frets: ['x', 3, 2, 0, 1, 3] }));
check('shapeKey reacts to `baseFret`', shapeKey(base) !== shapeKey({ ...base, baseFret: 5 }));
check('shapeKey reacts to `barre`',
  shapeKey(base) !== shapeKey({ ...base, barre: { fromIndex: 0, toIndex: 5, fret: 1 } }));

// ---------------------------------------------------------------------------
// 9. cleanliness completeness — comparable across chords (see the OPEN issue in
//    docs/mic-calibration.md). The fixtures below are the MEASURED median tone
//    ratios from real profiles on Matteo's rig, expressed vs the loudest tone.
// ---------------------------------------------------------------------------

// presence() ramp shape
check('presence: a dead tone scores 0', presence(0) === 0);
check('presence: a balanced tone scores 1', presence(1) === 1);
check('presence: the ramp is monotonic',
  presence(0.15) < presence(0.3) && presence(0.3) < presence(0.5));
check('presence: a doubled dominant root saturates', presence(2.5) === 1);

// A chord's completeness, given its expected tones' relative magnitudes.
const completenessOf = (tones: Record<number, number>, pcs: number[]) => {
  const ch = new Float32Array(12);
  for (const [pc, v] of Object.entries(tones)) ch[Number(pc)] = v;
  const tpl = l2Normalize(Float32Array.from(ch));
  return computeCleanliness(l2Normalize(ch), pcs, tpl, 0.8, 0.7).completeness;
};

// Em = E B G, B loudest (all six strings ring, well balanced)
const emComp = completenessOf({ 4: 0.56, 11: 1.0, 7: 0.49 }, [4, 11, 7]);
// E  = E B G#, B loudest
const eComp = completenessOf({ 4: 0.75, 11: 1.0, 8: 0.39 }, [4, 11, 8]);
// Am = A C E, A doubled + open so it dominates; C is genuinely choked
const amComp = completenessOf({ 9: 1.0, 0: 0.06, 4: 0.16 }, [9, 0, 4]);

check('balanced chords still score full completeness (Em)', emComp > 0.99, `Em=${emComp.toFixed(3)}`);
check('balanced chords still score full completeness (E)', eComp > 0.99, `E=${eComp.toFixed(3)}`);
// Pre-fix this was 1/3 — two tones fell off the max-relative cliff at once.
check('a dominant doubled root no longer buries its neighbours (Am)',
  amComp > 0.6, `Am=${amComp.toFixed(3)}`);
// ...but a genuinely choked string must STILL cost points, or we would be
// hiding the real fretting fault instead of the scoring artifact.
check('a genuinely choked string still costs completeness (Am)',
  amComp < 0.8, `Am=${amComp.toFixed(3)}`);
check('a truly missing note is still scored as missing',
  completenessOf({ 9: 1.0, 0: 0, 4: 0 }, [9, 0, 4]) < 0.4);

// ---------------------------------------------------------------------------
// 10. ambient chroma floor — measured on Matteo's real rig (2026-08-21).
//     Laptop fan rumble, a broad 60–200 Hz hump, folds into the F#–A# bins.
//     The pitch class MOVES with fan RPM (G idle, F# under CPU load), which is
//     why this is tracked live instead of calibrated once.
// ---------------------------------------------------------------------------
const ROOM_NOISE = Float32Array.from([
  //  C     C#     D     D#     E      F     F#     G     G#     A     A#     B
  0.485, 0.573, 0.505, 0.373, 0.460, 0.501, 0.845, 0.974, 0.810, 1.000, 0.901, 0.656,
]);
const scaled = (v: Float32Array, k: number) => Float32Array.from(v, x => x * k);
const add = (a: Float32Array, b: Float32Array) => Float32Array.from(a, (x, i) => x + b[i]);
const cos = (a: Float32Array, b: Float32Array) => cosineSim(l2Normalize(a.slice()), l2Normalize(b.slice()));

const AM_SHAPE: ChordShape = { frets: ['x', 0, 2, 2, 1, 0], fingers: [null, null, 3, 2, 1, null] };
const amClean = chordTemplate(AM_SHAPE);

// Converge a floor on silence-plus-noise, the way the engine does between strums.
const settle = (noise: Float32Array, frames = 400) => {
  const floor = noise.slice();
  for (let i = 0; i < frames; i++) applyChromaFloor(noise, floor, true);
  return floor;
};

const noise = scaled(ROOM_NOISE, 0.25);
const floor = settle(noise);
check('floor converges onto steady noise',
  Array.from(floor).every((v, i) => Math.abs(v - noise[i]) < 1e-3),
  `floor=${Array.from(floor).map(x => x.toFixed(3)).join(',')}`);
check('subtracting a converged floor leaves ~nothing of pure noise',
  Array.from(applyChromaFloor(noise, floor.slice(), true)).reduce((a, b) => a + b, 0) < 0.2 * noise.reduce((a, b) => a + b, 0));
check('the floor never yields a negative bin',
  Array.from(applyChromaFloor(scaled(ROOM_NOISE, 0.01), floor.slice(), true)).every(v => v >= 0));
check('an all-zero frame is safe',
  Array.from(applyChromaFloor(new Float32Array(12), floor.slice(), true)).every(v => v === 0));

// THE claim: a chord heard through this room comes out closer to the real chord.
for (const snr of [2, 1, 0.5]) {
  const heard = add(scaled(amClean, snr), noise);
  const cleaned = applyChromaFloor(heard, settle(noise), false);
  const before = cos(heard, amClean);
  const after = cos(cleaned, amClean);
  check(`floor subtraction improves the chord at SNR ${snr} (${before.toFixed(3)} → ${after.toFixed(3)})`,
    after > before, `got ${after.toFixed(4)} vs ${before.toFixed(4)}`);
}

// The guard that matters most: drilling ONE chord (what the quiz and new-chord
// routines ask for) must not slowly teach the floor to erase that chord. The
// engine gates learning on silence, so a sounding frame passes learn=false.
const ringingFloor = settle(noise);
const ringing = add(scaled(amClean, 1), noise);
let last = new Float32Array(12);
for (let i = 0; i < 600; i++) last = applyChromaFloor(ringing, ringingFloor, false);
check('a drilled chord is not subtracted away by its own floor',
  cos(last, amClean) > 0.9, `cos=${cos(last, amClean).toFixed(3)}`);
check('a drilled chord keeps its energy',
  Array.from(last).reduce((a, b) => a + b, 0) > 0.3 * Array.from(ringing).reduce((a, b) => a + b, 0));
// ...and the gate is what saves it: learning through a sustained chord DOES
// erode it, which is precisely why `learn` exists.
const ungatedFloor = settle(noise);
let ungated = new Float32Array(12);
for (let i = 0; i < 600; i++) ungated = applyChromaFloor(ringing, ungatedFloor, true);
check('learning through a sustained chord would erode it (the gate is load-bearing)',
  Array.from(ungated).reduce((a, b) => a + b, 0)
    < Array.from(last).reduce((a, b) => a + b, 0),
  'ungated kept as much energy as gated — the silence gate is doing nothing');

// Noise that MOVES (fans spinning up) must be re-learned, not remembered.
const movedNoise = scaled(Float32Array.from(ROOM_NOISE, (_, i) => ROOM_NOISE[(i + 1) % 12]), 0.25);
const staleFloor = settle(noise);
const driftBefore = Array.from(staleFloor).reduce((m, v, i) => m + Math.abs(v - movedNoise[i]), 0);
for (let i = 0; i < 400; i++) applyChromaFloor(movedNoise, staleFloor, true);
const driftMid = Array.from(staleFloor).reduce((m, v, i) => m + Math.abs(v - movedNoise[i]), 0);
check('the floor starts chasing noise that moved to another pitch class',
  driftMid < 0.5 * driftBefore, `${driftBefore.toFixed(3)} → ${driftMid.toFixed(3)}`);
// It converges DOWN fast and UP slowly by design (rise alpha 0.002 ≈ a 500-frame
// time constant), so a fan spinning up leaks a little noise for a few seconds
// before the floor catches it. That asymmetry is the price of not eating chords.
for (let i = 0; i < 4000; i++) applyChromaFloor(movedNoise, staleFloor, true);
check('the floor fully re-learns moved noise given time',
  Array.from(staleFloor).every((v, i) => Math.abs(v - movedNoise[i]) < 5e-3),
  `floor=${Array.from(staleFloor).map(x => x.toFixed(3)).join(',')}`);

if (failed) { console.error('\nprofile checks FAILED'); process.exit(1); }
console.log('\n✓ all CalibrationProfile + signal-contract + gate checks passed');
