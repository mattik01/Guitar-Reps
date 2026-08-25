// Single-pluck detection checks — the L1 gate for src/audio/pluck.ts.
//
// Same shape as checkProfiles.ts: plain esbuild→node, no test framework,
// numbered sections, process.exit(1) on failure. Everything here is synthetic
// spectra built from pure maths, so the whole decision path is asserted with no
// microphone. It proves WIRING AND MECHANISM, never tuning — tuning is the real
// guitar's job, on /pick-test.

import { CHORD_LIBRARY, libraryPrimaryShape } from '../src/data/chordLibrary';
import {
  PLUCK_AMBIGUOUS_MARGIN, PLUCK_MIN_STRENGTH, PLUCK_SUBOCTAVE_PENALTY, STRING_MIDI,
  combScore, midiName, midiToHz, pluckCandidates, scorePlucks, stringPitches,
} from '../src/audio/pluck';
import { checkPick, type PickSignal } from '../src/audio/signalContract';
import {
  PICK_EXERCISES, PICK_KIND_LABEL, buildSteps, buildTab, pickExerciseById, soundingStrings,
  supportsShape,
} from '../src/data/pickPatterns';
import { ROADMAP } from '../src/data/roadmap';
import { PROGRESSIONS } from '../src/data/progressions';

let failed = false;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`✓ ${name}`);
  else { console.error(`❌ ${name} ${detail}`); failed = true; }
}

const SR = 48000;
const FFT = 4096;
const BINS = FFT / 2;

type Voice = {
  hz: number;
  amp: number;
  harmonics?: number;
  // A real rig loses most of a low string's FUNDAMENTAL — mic response, room,
  // and our own 75 Hz high-pass all sit right on top of E2 (82 Hz) / G2 (98 Hz).
  // That loss is exactly what makes the octave confusion real, so it has to be
  // modelled here or the octave tests pass for the wrong reason.
  fundamentalGain?: number;
};

/** A plucked string: harmonics at h·f0 rolling off as 1/h. */
function synth(voices: Voice[], noise = 0): Float32Array {
  const mag = new Float32Array(BINS);
  const hzPerBin = SR / FFT;
  for (let k = 0; k < BINS; k++) mag[k] = noise;
  for (const v of voices) {
    const H = v.harmonics ?? 10;
    for (let h = 1; h <= H; h++) {
      const f = h * v.hz;
      if (f >= SR / 2) break;
      const k = Math.round(f / hzPerBin);
      if (k >= BINS) break;
      mag[k] += (v.amp / h) * (h === 1 ? (v.fundamentalGain ?? 1) : 1);
    }
  }
  return mag;
}

function inBandTotal(mag: Float32Array): number {
  const kMax = Math.floor(5000 / (SR / FFT));
  let t = 0;
  for (let k = 1; k <= Math.min(kMax, mag.length - 1); k++) t += mag[k];
  return t;
}

function shapeOf(id: string) {
  const lib = CHORD_LIBRARY.find(c => c.id === id);
  if (!lib) throw new Error(`missing library chord ${id}`);
  return libraryPrimaryShape(lib);
}

// ---- 1. string → pitch mapping ---------------------------------------------

check('open strings are E2 A2 D3 G3 B3 E4',
  STRING_MIDI.join(',') === '40,45,50,55,59,64', STRING_MIDI.join(','));

check('G is G2 B2 D3 G3 B3 G4',
  stringPitches(shapeOf('G')).join(',') === '43,47,50,55,59,67',
  stringPitches(shapeOf('G')).join(','));
check('Am mutes the low E and is A2 E3 A3 C4 E4',
  JSON.stringify(stringPitches(shapeOf('Am'))) === JSON.stringify([null, 45, 52, 57, 60, 64]),
  JSON.stringify(stringPitches(shapeOf('Am'))));
check('D mutes two strings and is D3 A3 D4 F#4',
  JSON.stringify(stringPitches(shapeOf('D'))) === JSON.stringify([null, null, 50, 57, 62, 66]),
  JSON.stringify(stringPitches(shapeOf('D'))));
check('C is C3 E3 G3 C4 E4',
  JSON.stringify(stringPitches(shapeOf('C'))) === JSON.stringify([null, 48, 52, 55, 60, 64]),
  JSON.stringify(stringPitches(shapeOf('C'))));

// Every library fingering must map to playable pitches on a candidate per
// sounding string — a fret typo that survives the harmonic check would show here.
let mappingOk = true;
const mappingDetail: string[] = [];
for (const lib of CHORD_LIBRARY) {
  for (const f of lib.fingerings) {
    const sounding = f.shape.frets.filter(x => x !== 'x').length;
    const cands = pluckCandidates(f.shape);
    if (cands.length !== sounding) { mappingOk = false; mappingDetail.push(`${lib.id} count`); }
    for (const c of cands) {
      if (c.midi < 40 || c.midi > 88) { mappingOk = false; mappingDetail.push(`${lib.id} ${c.midi}`); }
      if (Math.abs(c.hz - midiToHz(c.midi)) > 1e-6) { mappingOk = false; mappingDetail.push(`${lib.id} hz`); }
    }
  }
}
check('every library fingering yields one candidate per sounding string, in range',
  mappingOk, mappingDetail.slice(0, 5).join(' '));

check('baseFret does not shift pitches (frets are absolute)',
  stringPitches({ frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], baseFret: 1 }).join(',')
  === stringPitches({ frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], baseFret: 5 }).join(','));

// ---- 2. a clean single pluck names its string -------------------------------

function pickOne(chordId: string, stringIndex: number, opts: { fundamentalGain?: number } = {}) {
  const shape = shapeOf(chordId);
  const cands = pluckCandidates(shape);
  const midi = stringPitches(shape)[stringIndex]!;
  const delta = synth([{ hz: midiToHz(midi), amp: 1, ...opts }]);
  return scorePlucks(delta, SR, FFT, cands);
}

for (const id of ['G', 'C', 'Em', 'Am', 'D']) {
  const shape = shapeOf(id);
  const bad: string[] = [];
  stringPitches(shape).forEach((midi, i) => {
    if (midi == null) return;
    const r = pickOne(id, i);
    if (r.best !== i) bad.push(`${midiName(midi)}→${r.best}`);
  });
  check(`${id}: every sounding string is identified from a clean pluck`, bad.length === 0, bad.join(' '));
}

// ---- 3. the octave cases — and the mechanism that solves them ---------------
//
// G holds G2, G3 and G4. Their harmonic combs NEST (G3's partials are a subset
// of G2's), so comb score alone cannot rule the lower octave out once the low
// string's fundamental is attenuated the way a real rig attenuates it. The
// half-integer sub-octave probe is what breaks the tie, so it is asserted from
// BOTH sides: correct WITH the penalty, wrong WITHOUT it. An assertion that only
// checked the outcome would keep passing if the mechanism were deleted.

const gShape = shapeOf('G');
const gCands = pluckCandidates(gShape);
const WEAK = 0.15; // how much of G2's fundamental survives the rig

const g2Delta = synth([{ hz: midiToHz(43), amp: 1, fundamentalGain: WEAK }]);
const g2With = scorePlucks(g2Delta, SR, FFT, gCands);
const g2Without = scorePlucks(g2Delta, SR, FFT, gCands, { subOctavePenalty: 0 });
check('G2 with a rig-weakened fundamental is still string 6', g2With.best === 0,
  `best=${g2With.best} margin=${g2With.margin.toFixed(3)}`);
check('…and WITHOUT the sub-octave penalty it is misheard as the octave up',
  g2Without.best !== 0,
  `penalty=0 still answered ${g2Without.best} — the octave test has stopped testing anything`);

const g3Delta = synth([{ hz: midiToHz(55), amp: 1 }]);
const g3 = scorePlucks(g3Delta, SR, FFT, gCands);
check('G3 is string 4, not the octave below', g3.best === 3,
  `best=${g3.best} margin=${g3.margin.toFixed(3)}`);

const g4Delta = synth([{ hz: midiToHz(67), amp: 1 }]);
const g4 = scorePlucks(g4Delta, SR, FFT, gCands);
check('G4 is string 1, two octaves up from its twin', g4.best === 5,
  `best=${g4.best} margin=${g4.margin.toFixed(3)}`);

// The penalty must not fire where the shape has no octave twin: on a G chord
// 3/2 × G2 = 147 Hz IS D3, a real chord tone, and an unguarded probe would
// punish a perfectly correct D3.
const dOnG = scorePlucks(synth([{ hz: midiToHz(50), amp: 1 }]), SR, FFT, gCands);
check('D3 on a G shape is not penalised by a chord tone on its half-integer probe',
  dOnG.best === 2, `best=${dOnG.best}`);

// Em: E2/E3/E4, the same trap on a different shape.
const emCands = pluckCandidates(shapeOf('Em'));
const e2 = scorePlucks(synth([{ hz: midiToHz(40), amp: 1, fundamentalGain: WEAK }]), SR, FFT, emCands);
check('Em: a rig-weakened E2 is string 6', e2.best === 0, `best=${e2.best}`);
// Em's middle E is on the D string (022000 → D+2 = E3), NOT on the G string.
const e3 = scorePlucks(synth([{ hz: midiToHz(52), amp: 1 }]), SR, FFT, emCands);
check('Em: E3 is the D string, not its octave twin', e3.best === 2, `best=${e3.best}`);

// ---- 4. the previous string is still ringing --------------------------------
//
// The engine hands scorePlucks a POSITIVE delta, so a decaying neighbour mostly
// cancels — but not perfectly. A residue of the previous note must not steal the
// answer.

const ringing = synth([
  { hz: midiToHz(50), amp: 1 },        // the D3 just picked
  { hz: midiToHz(43), amp: 0.25 },     // G2 residue that failed to cancel
]);
const withRing = scorePlucks(ringing, SR, FFT, gCands);
check('a new pluck wins over an uncancelled neighbour residue', withRing.best === 2,
  `best=${withRing.best} margin=${withRing.margin.toFixed(3)}`);

// ---- 5. "unsure" is a real answer -------------------------------------------

const both = synth([
  { hz: midiToHz(50), amp: 1 },   // D3, string 4
  { hz: midiToHz(47), amp: 1 },   // B2, string 5 — equally lit
]);
const ambiguous = scorePlucks(both, SR, FFT, gCands);
check('two equally-lit candidates return unsure, never a guess',
  ambiguous.best === null && ambiguous.ambiguous,
  `best=${ambiguous.best} margin=${ambiguous.margin.toFixed(3)}`);

// A false onset on a still-DECAYING note. The delta is then near-zero
// everywhere and `strength` — a ratio of two tiny numbers — can look
// arbitrarily confident; only the newness gate catches it. Asserted from both
// sides, so deleting the gate fails the test rather than silently passing.
const ringingNote = synth([{ hz: midiToHz(50), amp: 1 }]);
const residue = synth([{ hz: midiToHz(50), amp: 0.02 }]); // 2% leftovers, no new string
const gated = scorePlucks(residue, SR, FFT, gCands, { pre: ringingNote });
const ungated = scorePlucks(residue, SR, FFT, gCands);
check('a false onset on a decaying note is rejected by the newness gate',
  gated.best === null && !gated.isNew,
  `best=${gated.best} newness=${gated.newness.toFixed(3)}`);
// isNew and ambiguous must stay DISTINCT: the engine drops !isNew onsets
// entirely, while an ambiguous-but-real pluck still counts for timing.
check('a real but unnameable pluck is ambiguous, yet still IS a pluck',
  ambiguous.isNew && ambiguous.ambiguous,
  `isNew=${ambiguous.isNew} ambiguous=${ambiguous.ambiguous}`);
check('…and without a pre-spectrum the same delta WOULD have named a string',
  ungated.best !== null,
  'the newness gate has stopped being the thing that catches this');

// You are told to LET THE STRINGS RING. So the newness gate is asked its
// question at the worst possible moment: five strings sounding, one thin new
// one added. It must still count the pick — this is the case that made picks go
// missing in the first real-guitar run, progressively worse the further into a
// run you got, because the gate divided by everything that was ringing.
const gRinging = synth([43, 47, 50, 55, 59].map(m => ({ hz: midiToHz(m), amp: 1 })));
const quietNew = synth([{ hz: midiToHz(67), amp: 0.3 }]);   // high e, picked softly
const onFullChord = scorePlucks(quietNew, SR, FFT, gCands, { pre: gRinging });
check('a quiet new string counts even with five others ringing',
  onFullChord.isNew && onFullChord.best === 5,
  `isNew=${onFullChord.isNew} newness=${onFullChord.newness.toFixed(2)} best=${onFullChord.best}`);
const oldStyleNewness = inBandTotal(quietNew) / inBandTotal(gRinging);
check('…where the old whole-chord denominator would have discarded it',
  oldStyleNewness < 0.08,
  `old-style newness=${oldStyleNewness.toFixed(3)}`);

// The exercise's core move: the SAME string picked four times in a row. The
// string is already ringing and gets struck again, so a gate that demands
// "energy that was not there before" would throw away three picks in four.
const halfDecayed = synth([{ hz: midiToHz(43), amp: 0.5 }]);
const restruck = synth([{ hz: midiToHz(43), amp: 0.5 }]); // back up to full → delta is the other half
const rePick = scorePlucks(restruck, SR, FFT, gCands, { pre: halfDecayed });
check('re-picking an already-ringing string still counts as a pick',
  rePick.isNew, `newness=${rePick.newness.toFixed(2)}`);

// The strength gate must measure "is there a note here", NOT "how tidy is the
// spectrum". A real room adds broadband energy to every bin; the previous
// definition (winning comb ÷ TOTAL in-band energy) shrank with it and scored
// only 0.17-0.21 even on a noiseless synthetic pluck, which is what made a real
// guitar read as "unsure" almost every time.
const cleanPluck = synth([{ hz: midiToHz(50), amp: 1 }]);
const noisyPluck = synth([{ hz: midiToHz(50), amp: 1 }], 0.03);
const cleanS = scorePlucks(cleanPluck, SR, FFT, gCands);
const noisyS = scorePlucks(noisyPluck, SR, FFT, gCands);
check('a clean pluck passes the strength gate with room to spare',
  cleanS.strength >= PLUCK_MIN_STRENGTH + 0.2, `strength=${cleanS.strength.toFixed(3)}`);
check('the same pluck in a noisy room still passes, and is still named',
  noisyS.strength >= PLUCK_MIN_STRENGTH && noisyS.best === 2,
  `strength=${noisyS.strength.toFixed(3)} best=${noisyS.best}`);
// Pin the REASON, not just the outcome: under the old total-energy definition
// this same signal fell far below any usable bar.
const oldStyleStrength = noisyS.ranked[0].raw / inBandTotal(noisyPluck);
check('…where the old total-energy definition collapses on the very same signal',
  oldStyleStrength < 0.15 && oldStyleStrength < noisyS.strength / 3,
  `old-style=${oldStyleStrength.toFixed(3)} vs new=${noisyS.strength.toFixed(3)}`);

const noiseOnly = scorePlucks(synth([], 0.02), SR, FFT, gCands);
check('broadband noise with no chord tone fails the strength gate',
  noiseOnly.best === null,
  `best=${noiseOnly.best} strength=${noiseOnly.strength.toFixed(3)}`);

const offChord = scorePlucks(synth([{ hz: midiToHz(44), amp: 1 }]), SR, FFT, gCands); // G#2, in no G shape
check('a note that is not in the held shape does not confidently claim a string',
  offChord.best === null || offChord.margin < 0.5,
  `best=${offChord.best} margin=${offChord.margin.toFixed(3)}`);

check('no candidates → empty ranking, not a crash',
  scorePlucks(g3Delta, SR, FFT, []).best === null);
check('empty spectrum → empty ranking',
  scorePlucks(new Float32Array(0), SR, FFT, gCands).best === null);

// ---- 6. the margin boundary, from both sides --------------------------------

// Rather than solving for one exact gap, sweep a two-candidate mix and assert
// the RULE holds at every point on both sides of the constant. A single hand-
// tuned fixture would keep passing if the comparison flipped to >=.
// B2 and D3 — neighbours on the G shape that share almost no partials and are
// not an octave apart, so the mix crosses over cleanly and the sub-octave
// mechanism (asserted in section 3) stays out of the way.
const pair = [
  { stringIndex: 1, midi: 47, hz: midiToHz(47) },
  { stringIndex: 2, midi: 50, hz: midiToHz(50) },
];
let underMargin = 0, overMargin = 0, ruleBroken = '';
for (let amp = 0; amp <= 2.0001; amp += 0.01) {
  const d = synth([{ hz: midiToHz(47), amp: 1 }, { hz: midiToHz(50), amp }]);
  const r = scorePlucks(d, SR, FFT, pair);
  if (r.strength < 0.15) continue;
  if (r.margin <= PLUCK_AMBIGUOUS_MARGIN) {
    underMargin++;
    if (r.best !== null) ruleBroken ||= `named a string at margin ${r.margin.toFixed(3)}`;
  } else {
    overMargin++;
    if (r.best === null) ruleBroken ||= `refused at margin ${r.margin.toFixed(3)}`;
  }
}
check('the ambiguity margin decides, in both directions', ruleBroken === '', ruleBroken);
check('…and the sweep actually visited both sides of it',
  underMargin > 2 && overMargin > 2, `under=${underMargin} over=${overMargin}`);

check('the sub-octave penalty is on by default', PLUCK_SUBOCTAVE_PENALTY > 0);
check('combScore of an empty spectrum is 0', combScore(new Float32Array(BINS), SR, FFT, 196) === 0);

// ---- 7. the contract: checkPick ---------------------------------------------

function sig(stringIndex: number | null): PickSignal {
  return {
    at: 0, stringIndex, midi: stringIndex == null ? null : 55,
    ranked: [], margin: 0.4, strength: 0.5, newness: 1, attackRatio: 3, isPick: true,
    ambiguous: stringIndex == null, level: 0.1,
  };
}
check('checkPick: the expected string is correct', checkPick(sig(3), 3).verdict === 'correct');
check('checkPick: another string is wrong', checkPick(sig(2), 3).verdict === 'wrong');
// The product decision, pinned: an unnameable pick is 'unsure', never 'wrong'.
// Being told you played it wrong when we simply could not tell is useless — the
// same recall-over-precision call the chord thresholds were retuned for.
check('checkPick: an unnameable pick is unsure, not wrong', checkPick(sig(null), 3).verdict === 'unsure');

// ---- 8. the exercise's patterns ---------------------------------------------
//
// A pattern is a RULE over the strings a shape actually sounds, not a fixed list
// of string numbers — Am mutes the low E and D mutes two, so a hard-coded
// "6 5 4 3 2 1" would ask for strings that are not there.

const gShapeP = shapeOf('G');
const amShape = shapeOf('Am');
const dShape = shapeOf('D');

check('sounding strings follow the shape',
  soundingStrings(gShapeP).join(',') === '0,1,2,3,4,5'
  && soundingStrings(amShape).join(',') === '1,2,3,4,5'
  && soundingStrings(dShape).join(',') === '2,3,4,5',
  `${soundingStrings(amShape)} / ${soundingStrings(dShape)}`);

const run4 = pickExerciseById('run4')! as Extract<typeof PICK_EXERCISES[number], { kind: 'pattern' }>;
const gRun4 = buildSteps(run4, gShapeP);
check('run4 on G is 4 per string down and back, no doubled turn-around',
  gRun4.length === 44 && gRun4.slice(0, 4).every(s => s.stringIndex === 0)
  && gRun4.slice(20, 24).every(s => s.stringIndex === 5)
  && gRun4.slice(24, 28).every(s => s.stringIndex === 4),
  `len=${gRun4.length}`);

// A muted string must never be asked for — the single most important property
// here, since asking for a string that is not sounding makes the drill wrong.
let mutedAsked = '';
for (const lib of CHORD_LIBRARY) {
  for (const f of lib.fingerings) {
    const sounding = new Set(soundingStrings(f.shape));
    for (const pat of PICK_EXERCISES) {
      if (pat.kind !== 'pattern') continue;
      for (const step of buildSteps(pat, f.shape)) {
        if (step.stringIndex == null) continue;   // a rest asks for nothing
        if (!sounding.has(step.stringIndex)) mutedAsked ||= `${lib.id}/${pat.id}/${step.stringIndex}`;
      }
    }
  }
}
check('no pattern ever asks for a muted string, on any library fingering',
  mutedAsked === '', mutedAsked);

const skip2 = pickExerciseById('skip2')! as Extract<typeof PICK_EXERCISES[number], { kind: 'pattern' }>;
const gSkip = buildSteps(skip2, gShapeP).map(s => s.stringIndex);
check('skip2 on G jumps two strings at a time',
  gSkip.slice(0, 4).join(',') === '0,0,2,2', gSkip.slice(0, 8).join(','));
// The gap is the whole point of the exercise, so a pair touching a muted string
// is DROPPED rather than closed up into a smaller jump.
const dSkip = buildSteps(skip2, dShape).map(s => s.stringIndex);
// skip2 emits each string of a pair twice, so a pair spans four steps.
let gapOk = dSkip.length > 0 && dSkip.length % 4 === 0;
for (let i = 0; i + 3 < dSkip.length; i += 4) {
  if (Math.abs(dSkip[i + 2] - dSkip[i]) !== 2) gapOk = false;
  if (dSkip[i + 1] !== dSkip[i] || dSkip[i + 3] !== dSkip[i + 2]) gapOk = false;
}
check('skipping keeps the two-string gap on a shape with muted strings',
  gapOk, dSkip.join(','));

// Directional pattern #1 — "6 · 4 2 · 3 4 3", counted from the chord's LOWEST sounding
// string rather than as literal string numbers.
const p1 = pickExerciseById('directional')! as Extract<typeof PICK_EXERCISES[number], { kind: 'pattern' }>;
check('Directional pattern #1 is still called \'directional\' in storage',
  p1.id === 'directional' && p1.name === 'Directional pattern #1',
  `${p1.id} / ${p1.name}`);

const p1g = buildSteps(p1, gShapeP).map(s => s.stringIndex);
check('Directional pattern #1 on G runs 6 · 4 2 · 3 4 3 with two rests',
  JSON.stringify(p1g) === JSON.stringify([0, null, 2, 4, null, 3, 2, 3]),
  JSON.stringify(p1g));
// Am's lowest sounding string is the A, so the whole figure shifts up one.
const p1am = buildSteps(p1, amShape).map(s => s.stringIndex);
check('Directional pattern #1 transposes onto a chord that mutes the low E',
  JSON.stringify(p1am) === JSON.stringify([1, null, 3, 5, null, 4, 3, 4]),
  JSON.stringify(p1am));
check('Directional pattern #1 refuses a chord that is too narrow (D sounds four strings)',
  buildSteps(p1, dShape).length === 0 && !supportsShape(p1, dShape));
// The pick hand keeps moving through a rest — that is the point of the pattern,
// so the alternation must not restart after one.
const p1dirs = buildSteps(p1, gShapeP).map(s => s.direction).join(',');
check('the down/up alternation continues through the rests',
  p1dirs === 'down,up,down,up,down,up,down,up', p1dirs);

// A rest must survive into the tab as a rest, not vanish — otherwise the beats
// would close up and the pattern would be a different rhythm.
const p1tab = buildTab(p1, [gShapeP])[0];
check('rests reach the tab as rests, keeping the eight slots',
  p1tab.length === 8 && p1tab[1].stringIndex === null && p1tab[1].fret === null
  && p1tab[4].stringIndex === null,
  p1tab.map(n => n.fret ?? '·').join(','));
// G is 320003, so the offsets land on 3 · 0 0 · 0 0 0 — the B string is open.
check('Directional pattern #1 over G frets as 3 · 0 0 · 0 0 0',
  p1tab.map(n => (n.fret == null ? '·' : n.fret)).join(',') === '3,·,0,0,·,0,0,0',
  p1tab.map(n => (n.fret == null ? '·' : n.fret)).join(','));

// minStrings is DISPLAY (the picker's "5+ strings only" label) while
// supportsShape is BEHAVIOUR. They must agree on every fingering the app ships,
// or the label lies about which chords are listed.
let labelOk = true;
const labelBad: string[] = [];
for (const lib of CHORD_LIBRARY) {
  for (const f of lib.fingerings) {
    for (const e of PICK_EXERCISES) {
      if (e.kind !== 'pattern') continue;
      const wide = soundingStrings(f.shape).length >= e.minStrings;
      if (supportsShape(e, f.shape) !== wide) {
        labelOk = false;
        labelBad.push(`${lib.id}/${e.id}`);
      }
    }
  }
}
check('minStrings (the label) agrees with supportsShape (the behaviour) everywhere',
  labelOk, labelBad.slice(0, 5).join(' '));

// Direction is display-only and must stay that way — it is not recoverable from
// audio, so nothing may ever score it.
check('steps alternate down/up for display',
  gRun4[0].direction === 'down' && gRun4[1].direction === 'up');

// ---- 9. the catalog, levels and tabs ----------------------------------------

const LEVEL_IDS = new Set(ROADMAP.flatMap(p => p.levels).map(l => l.id));
check('every exercise id is unique',
  new Set(PICK_EXERCISES.map(e => e.id)).size === PICK_EXERCISES.length);
check('every exercise has a hint (it is the card tooltip — the UI carries no prose)',
  PICK_EXERCISES.every(e => e.hint.trim().length > 0));
check('every kind has a card label, and a pattern reads as "Chords"',
  PICK_KIND_LABEL.pattern === 'Chords' && PICK_KIND_LABEL.riff === 'Riff'
  && PICK_EXERCISES.every(e => !!PICK_KIND_LABEL[e.kind]));
check('every exercise sits on a real roadmap level',
  PICK_EXERCISES.every(e => LEVEL_IDS.has(e.level)),
  PICK_EXERCISES.map(e => `${e.id}:${e.level}`).join(' '));
// Ordering is per level, so two exercises on DIFFERENT levels may share a rank.
let orderOk = true;
for (const lvl of LEVEL_IDS) {
  const inLvl = PICK_EXERCISES.filter(e => e.level === lvl);
  if (new Set(inLvl.map(e => e.difficulty)).size !== inLvl.length) orderOk = false;
}
check('difficulties are distinct within a level, so card order is deterministic', orderOk);

// buildTab reads the fret off the SHAPE for a pattern — that is what makes one
// renderer serve both kinds, and it doubles as a check that a generator never
// returns a string the shape mutes.
const gTab = buildTab(run4, [shapeOf('G')])[0];
check('run4 over G takes its frets from the shape',
  gTab.slice(0, 12).map(n => n.fret).join(',') === '3,3,3,3,2,2,2,2,0,0,0,0',
  gTab.slice(0, 12).map(n => n.fret).join(','));
const amTab = buildTab(run4, [shapeOf('Am')])[0];
check('a muted string never reaches the tab',
  amTab.every(n => n.stringIndex !== 0), 'low E appeared in an Am tab');
check('one pass per chord',
  buildTab(run4, [shapeOf('G'), shapeOf('Am')]).length === 2);

// The riff is user-supplied and unverifiable by code, so pin it: a later edit
// must not be able to quietly change what it teaches.
const peterGunn = pickExerciseById('peter-gunn')!;
const pgTab = buildTab(peterGunn, [])[0];
check('Peter Gunn is the low E only',
  pgTab.every(n => n.stringIndex === 0), pgTab.map(n => n.stringIndex).join(','));
check('Peter Gunn is 0,0,2,0,3,0,5,4',
  pgTab.map(n => n.fret).join(',') === '0,0,2,0,3,0,5,4',
  pgTab.map(n => n.fret).join(','));
check('a riff is runnable on any chord; a pattern that is too wide is not',
  supportsShape(peterGunn, dShape) && !supportsShape(p1, dShape));
check('a riff ignores the chords it is handed and returns one pass',
  buildTab(peterGunn, [shapeOf('G'), shapeOf('Am')]).length === 1);

let riffOk = true;
for (const e of PICK_EXERCISES) {
  if (e.kind !== 'riff') continue;
  for (const n of e.notes) {
    if (n.stringIndex < 0 || n.stringIndex > 5 || n.fret < 0 || n.fret > 24) riffOk = false;
  }
}
check('every riff note is playable', riffOk);

// A pattern note and a riff note must be the SAME shape, or PickTab would need
// to branch on kind — the whole point of the unification.
const shapeKeys = (n: object) => Object.keys(n).sort().join(',');
check('pattern notes and riff notes are structurally identical',
  shapeKeys(gTab[0]) === shapeKeys(pgTab[0]),
  `${shapeKeys(gTab[0])} vs ${shapeKeys(pgTab[0])}`);

// Progressions spell repeats out literally; a pass per chord already repeats the
// pattern, so consecutive duplicates are padding.
const collapse = (ids: string[]) => ids.filter((c, i) => c !== ids[i - 1]);
const blues = PROGRESSIONS.find(p => p.id === 'blues-E');
check('loading a progression collapses consecutive duplicates',
  !blues || collapse(blues.chordIds).join(',') === 'E,A,E,B7,A,E',
  blues ? collapse(blues.chordIds).join(',') : 'no blues-E');
check('…without collapsing a chord that genuinely returns later',
  collapse(['G', 'C', 'G', 'D']).join(',') === 'G,C,G,D');

if (failed) { console.error('\npick checks FAILED'); process.exit(1); }
console.log('\n✓ all single-pluck detection + pick-contract checks passed');
