// The roadmap's HARD requirements: the targets the app verifies itself (data/
// roadmapRequirements.ts). Pure functions over repertoire + calibration + swap
// records + songs, so they are asserted here rather than clicked through.
import { evaluateLevel, requirementsFor, type RequirementContext } from '../src/data/roadmapRequirements';
import {
  CURRICULUM_LEVELS, LEVEL_NEW_CHORDS, LEVEL_TRANSITIONS, MAX_APPEARANCES,
  MAX_PER_STEP, MIN_REVISIT_JUMP, SPEED_CEILING, SPEED_FLOOR, SPEED_STEP,
  allTargets, chordsThrough, levelOfChord, speedTarget, stepsFor, transitionAvailable,
  type LevelId, type TransitionTarget,
} from '../src/data/transitionTargets';
import { TRANSITION_COUNT, transitionFrequency } from '../src/data/transitionFrequency';
import { libraryChordsByCategory } from '../src/data/chordLibrary';
import { CAL_SCORE_TARGET_WEIGHT } from '../src/audio/calibration';
import { pairKey, type CalibrationProfile, type Chord, type ChordShape, type Song, type SwapRecord } from '../src/state/store';

// The 50 most frequent undirected base-chord changes in the catalog, in order, as
// measured by `npm run stats:transitions` (data/raw/transition-stats.csv). Inlined so
// this check runs without the 580 MB catalog present; regenerate both together.
const TOP_50 = [
  'C|G', 'D|G', 'A|D', 'C|F', 'A|E', 'C|D', 'Am|G', 'F|G', 'D|Em', 'A|G',
  'Am|C', 'C|Em', 'Em|G', 'Am|F', 'B|E', 'D|E', 'A|Bm', 'Am|Em', 'A#|F', 'Bm|G',
  'A|B', 'C|Dm', 'Bm|D', 'Am|D', 'Am|Dm', 'Dm|F', 'A#|C', 'E|F#m', 'Am|E', 'Dm|G',
  'A|Em', 'A|F#m', 'B|F#', 'Bm|Em', 'D|F#m', 'A#|D#', 'A|C#m', 'B|C#m', 'Em|F', 'A#|Dm',
  'E|F#', 'C#m|E', 'D#|G#', 'A|C', 'E|G', 'F|Gm', 'B|Em', 'Bm|E', 'C#|F#', 'C#|G#',
];

const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const SHAPE: ChordShape = { frets: [0, 2, 2, 1, 0, 0], fingers: [null, 2, 3, 1, null, null] };
const chord = (id: string): Chord => ({ id, name: id, shape: SHAPE, learnedAt: 0, perfectReps: 0 });

// A profile whose score clears CAL_MIN_SCORE (60) — one sample carrying full weight.
const calibrated = (id: string): CalibrationProfile => ({
  chordId: id,
  samples: [{ chroma: new Array(12).fill(0.2), weight: CAL_SCORE_TARGET_WEIGHT, at: 1 } as any],
  expectedPcs: [],
  updatedAt: 1,
});
const barelyCalibrated = (id: string): CalibrationProfile => ({
  ...calibrated(id),
  samples: [{ chroma: new Array(12).fill(0.2), weight: 0.5, at: 1 } as any], // ~8/100
});

function swap(a: string, b: string, best: number): [string, SwapRecord] {
  return [pairKey(a, b), {
    pairKey: pairKey(a, b), chordA: a, chordB: b,
    bestCount: best, lastCount: 0, attempts: 1, lastAt: 1, history: [],
  }];
}

const song = (id: string): Song =>
  ({ id, title: id, artist: 'x', chords: ['C', 'G'], addedAt: 0 }) as Song;

const OPEN = libraryChordsByCategory('open-basic').map(c => c.id);
// The pairs level 1's core step actually asks for — read from the curriculum rather
// than duplicated here, so retuning the table can't silently invalidate this file.
const L1_CORE = LEVEL_TRANSITIONS.l1[0].targets;

function ctx(over: Partial<RequirementContext> = {}): RequirementContext {
  return {
    repertoire: [], swaps: {}, profiles: {}, songs: [], playlists: [],
    playabilityOf: () => null,
    ...over,
  };
}
const l1 = (c: RequirementContext) => evaluateLevel('l1', c);
const byId = (c: RequirementContext, id: string) => l1(c).find(r => r.id === id)!;

console.log('shape');
check('levels without targets simply have none', requirementsFor('l7').length === 0);
check('level 1 has a target per chord-change step, plus chords and songs',
  requirementsFor('l1').length === stepsFor('l1').length + 2);
check('every curriculum level has requirements',
  CURRICULUM_LEVELS.every(l => requirementsFor(l).length > 0));
check('every target reports progress out of a total',
  l1(ctx()).every(r => r.total > 0 && r.value >= 0 && r.value <= r.total));
check('nothing is met on an empty profile', l1(ctx()).every(r => !r.met));

console.log('chords owned + calibrated');
const owned = OPEN.map(chord);
const allCal = Object.fromEntries(OPEN.map(id => [id, calibrated(id)]));
check('owning every chord is NOT enough without calibration',
  !byId(ctx({ repertoire: owned }), 'l1-chords').met);
check('owned + calibrated meets it',
  byId(ctx({ repertoire: owned, profiles: allCal }), 'l1-chords').met);
check('a weak profile does not count as calibrated',
  !byId(ctx({ repertoire: owned, profiles: { ...allCal, C: barelyCalibrated('C') } }), 'l1-chords').met);
check('progress counts only chords that are both',
  byId(ctx({ repertoire: owned, profiles: { C: calibrated('C'), G: calibrated('G') } }), 'l1-chords').value === 2);
check('an unowned chord is named in the detail',
  byId(ctx({ repertoire: owned.filter(c => c.id !== 'G'), profiles: allCal }), 'l1-chords').detail.includes('missing G'));
check('an uncalibrated one is named separately',
  byId(ctx({ repertoire: owned, profiles: { ...allCal, D: barelyCalibrated('D') } }), 'l1-chords')
    .detail.includes('not calibrated: D'));

console.log('swap targets');
const rep = [...owned, chord('Em')];
const atTarget = Object.fromEntries(L1_CORE.map(t => swap(t.a, t.b, t.target)));
const core = (c: RequirementContext, level = 'l1', id = LEVEL_TRANSITIONS.l1[0].id) =>
  evaluateLevel(level, c).find(r => r.id === id)!;
check('every core pair at its own target meets the step',
  core(ctx({ repertoire: rep, swaps: atTarget })).met);
check('one pair short does not', (() => {
  const weak = L1_CORE[2];
  const short = { ...atTarget, ...Object.fromEntries([swap(weak.a, weak.b, weak.target - 1)]) };
  const r = core(ctx({ repertoire: rep, swaps: short }));
  return !r.met && r.value === L1_CORE.length - 1;
})());
check('a pair short is named with the rate it still needs', (() => {
  const weak = L1_CORE[2];
  const short = { ...atTarget, ...Object.fromEntries([swap(weak.a, weak.b, weak.target - 1)]) };
  return core(ctx({ repertoire: rep, swaps: short })).detail
    .includes(`${weak.a}\u2194${weak.b} ${weak.target}/min`);
})());
check('measured on your BEST minute, not the last', (() => {
  const t = L1_CORE[0];
  const [k, v] = swap(t.a, t.b, t.target + 5);
  const r = core(ctx({ repertoire: rep, swaps: { [k]: { ...v, lastCount: 2 } } }));
  return r.value === 1;
})());
check('a later level asks the same pairs at a higher rate',
  !core(ctx({ repertoire: rep, swaps: atTarget }), 'l3', 'l3-core-faster').met);
check('a change whose chords are not in the library yet is excluded, not failed', (() => {
  const r = evaluateLevel('l4', ctx({ repertoire: rep })).find(x => x.id === 'l4-sharp-minors')!;
  const live = LEVEL_TRANSITIONS.l4.find(s => s.id === 'l4-sharp-minors')!.targets
    .filter(t => transitionAvailable(t.a, t.b));
  return r.total === live.length && r.detail.includes('not in the library yet');
})());

console.log('curriculum: level legality');
const allSteps = CURRICULUM_LEVELS.flatMap(l => stepsFor(l).map(s => ({ level: l, step: s })));
const everyTarget = (fn: (t: TransitionTarget, level: LevelId, stepId: string) => boolean) =>
  allSteps.every(({ level, step }) => allTargets(step).every(t => fn(t, level, step.id)));

check('no level targets a change needing a later level\'s chord', (() => {
  const bad: string[] = [];
  for (const { level, step } of allSteps) {
    const legal = chordsThrough(level);
    for (const t of allTargets(step)) {
      if (!legal.has(t.a) || !legal.has(t.b)) bad.push(`${level}/${step.id}: ${t.a}\u2194${t.b}`);
    }
  }
  if (bad.length) console.log('    ' + bad.join('; '));
  return bad.length === 0;
})());
check('every chord in the curriculum belongs to exactly one level', (() => {
  const seen = new Set<string>();
  for (const l of CURRICULUM_LEVELS) for (const c of LEVEL_NEW_CHORDS[l]) {
    if (seen.has(c)) return false;
    seen.add(c);
  }
  return everyTarget(t => levelOfChord(t.a) !== null && levelOfChord(t.b) !== null);
})());
check('every level from l2 on introduces work with its own new chords', (() => {
  return CURRICULUM_LEVELS.slice(1).every(level => {
    const fresh = new Set(LEVEL_NEW_CHORDS[level]);
    return stepsFor(level).some(s => s.targets.some(t => fresh.has(t.a) || fresh.has(t.b)));
  });
})());
check('every new chord of a level appears in one of that level\'s changes', (() => {
  const orphans: string[] = [];
  for (const level of CURRICULUM_LEVELS) {
    const used = new Set(stepsFor(level).flatMap(s => allTargets(s).flatMap(t => [t.a, t.b])));
    for (const c of LEVEL_NEW_CHORDS[level]) if (!used.has(c)) orphans.push(`${level}: ${c}`);
  }
  if (orphans.length) console.log('    ' + orphans.join('; '));
  return orphans.length === 0;
})());

console.log('curriculum: shape');
check('a level has as many bullets as its number', (() => {
  const wrong = CURRICULUM_LEVELS
    .map((l, i) => ({ l, want: i + 1, got: stepsFor(l).length }))
    .filter(x => x.want !== x.got);
  if (wrong.length) console.log('    ' + wrong.map(x => `${x.l}: ${x.got} not ${x.want}`).join('; '));
  return wrong.length === 0;
})());
check('every bullet asks for at least one change', allSteps.every(({ step }) => step.targets.length > 0));

console.log('curriculum: speeds');
check('every target follows the difficulty rule',
  everyTarget((t, level) => t.target === speedTarget(level, t.difficulty)));
check('no target exceeds the catalog-wide green, none is below the floor',
  everyTarget(t => t.target <= SPEED_CEILING && t.target >= SPEED_FLOOR));
check(`every target is a whole ${SPEED_STEP}/min`, everyTarget(t => t.target % SPEED_STEP === 0));
// One pass over the whole roadmap, recording where each change is asked and at what.
const history = new Map<string, number[]>();
for (const level of CURRICULUM_LEVELS) {
  // Within one level a change appears at most once (asserted below), so collect per
  // level rather than per bullet.
  for (const step of stepsFor(level)) for (const t of allTargets(step)) {
    const k = `${t.a}|${t.b}`;
    const list = history.get(k);
    if (list) list.push(t.target); else history.set(k, [t.target]);
  }
}
check('a pair never gets slower as the levels go up',
  [...history.values()].every(rates => rates.every((r, i) => i === 0 || r >= rates[i - 1])));
check(`no change is asked more than ${MAX_APPEARANCES} times in the whole roadmap`, (() => {
  const over = [...history.entries()].filter(([, r]) => r.length > MAX_APPEARANCES)
    .map(([k, r]) => `${k} × ${r.length}`);
  if (over.length) console.log('    ' + over.join('; '));
  return over.length === 0;
})());
check(`a repeat is at least ${MIN_REVISIT_JUMP}/min faster than the last ask`, (() => {
  const small = [...history.entries()]
    .filter(([, r]) => r.some((x, i) => i > 0 && x - r[i - 1] < MIN_REVISIT_JUMP))
    .map(([k, r]) => `${k}: ${r.join('→')}`);
  if (small.length) console.log('    ' + small.join('; '));
  return small.length === 0;
})());
check('pair keys are canonical and no pair is asked twice in one level', (() => {
  for (const level of CURRICULUM_LEVELS) {
    const seen = new Set<string>();
    for (const step of stepsFor(level)) for (const t of allTargets(step)) {
      if (t.a > t.b) return false;
      const k = `${t.a}|${t.b}`;
      if (seen.has(k)) return false;
      seen.add(k);
    }
  }
  return true;
})());
check('difficulty is on the 1-10 scale', everyTarget(t => t.difficulty >= 1 && t.difficulty <= 10));
check(`no bullet holds more than ${MAX_PER_STEP} changes`, (() => {
  const over = allSteps
    .filter(({ step }) => allTargets(step).length > MAX_PER_STEP)
    .map(({ level, step }) => `${level}/${step.id}: ${allTargets(step).length}`);
  if (over.length) console.log('    ' + over.join('; '));
  return over.length === 0;
})());

console.log('curriculum: coverage');
check('the 50 most frequent changes in the catalog are all a target somewhere', (() => {
  const covered = new Set(
    allSteps.flatMap(({ step }) => allTargets(step).map(t => `${t.a}|${t.b}`)),
  );
  const missing = TOP_50.filter(k => !covered.has(k));
  if (missing.length) console.log('    missing: ' + missing.join(', '));
  return missing.length === 0;
})());
check('every target carries its real catalog rank', (() => {
  const wrong = allSteps.flatMap(({ step }) => allTargets(step))
    .filter(t => transitionFrequency(t.a, t.b)?.rank !== t.rank)
    .map(t => `${t.a}\u2194${t.b}: says ${t.rank}, is ${transitionFrequency(t.a, t.b)?.rank ?? 'unranked'}`);
  if (wrong.length) console.log('    ' + wrong.join('; '));
  return wrong.length === 0;
})());
check(`the generated frequency table covers the whole catalog (${TRANSITION_COUNT} changes)`,
  TRANSITION_COUNT > 200 && transitionFrequency('G', 'C')?.rank === 1);

console.log('songs');
check('three saved songs meet the level 1 target',
  byId(ctx({ songs: [song('a'), song('b'), song('c')] }), 'l1-songs').met);
check('two do not', !byId(ctx({ songs: [song('a'), song('b')] }), 'l1-songs').met);

const three = [song('a'), song('b'), song('c')];
const l2Songs = (c: RequirementContext) => evaluateLevel('l2', c).find(r => r.id === 'l2-songs')!;
check('level 2 needs them at 100% playability',
  !l2Songs(ctx({ songs: three, playabilityOf: () => 90 })).met);
check('…and is met at 100%', l2Songs(ctx({ songs: three, playabilityOf: () => 100 })).met);
check('an unscored song never counts as 0-and-done',
  !l2Songs(ctx({ songs: three, playabilityOf: () => null })).met);

console.log('');
if (failures.length) {
  console.error(`✗ ${failures.length} roadmap requirement check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('✓ all roadmap requirement checks passed');
