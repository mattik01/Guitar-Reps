// Pick-hand patterns — "hold a chord, run the pick across the strings".
//
// Pure and Node-safe (like chroma.ts / pluck.ts) so scripts/checkPicks.ts can
// assert the generated step lists without a browser.
//
// A pattern is not a fixed list of string numbers: it is a RULE applied to
// whichever strings the held shape actually sounds. Am mutes the low E and D
// mutes two, so a hard-coded "6 5 4 3 2 1" would ask you to pick strings that
// aren't there. Every generator below therefore works on the sounding strings.
//
// Direction (down/up) is carried per step for DISPLAY ONLY. It is never scored
// and never will be — it is not recoverable from audio (docs/pick-detection.md),
// and guessing at it would be worse than saying nothing.

import type { ChordShape } from '../state/store';
import { stringPitches } from '../audio/pluck';
import type { LevelId } from './transitionTargets';

export type PickDirection = 'down' | 'up';

// A slot in a pattern. `stringIndex` null is a REST — the beat passes and you
// play nothing. The direction is still carried through a rest on purpose: the
// pick hand keeps its down-up motion across the gap, which is the whole point of
// a directional pattern.
export type PickStep = {
  stringIndex: number | null;   // 0 = low E … 5 = high e, null = rest
  direction: PickDirection;
};

// One note of a rendered exercise. A pattern over a held chord and a fixed riff
// BOTH reduce to this: look the fret up from the shape and a pattern IS a tab.
// That is what lets one component draw either, and why adding riffs needed no
// second renderer.
export type PickNote = {
  stringIndex: number | null;   // null = rest
  fret: number | null;
  direction: PickDirection;
};

/** A riff's own notes — absolute frets, no chord required. */
export type RiffNote = { stringIndex: number; fret: number };

type PickExerciseBase = {
  id: string;               // ALSO the reps.pickRecords key — never rename one
  name: string;
  hint: string;             // one line, shown as a tooltip — never as page prose
  // The roadmap level this belongs to, as a MACHINE id rather than the display
  // string chords use (`ChordCategory.roadmapLevel`, e.g. 'L3–6', which is only
  // ever rendered). These are meant to become roadmap hard targets — "hold this
  // at N bpm" — so roadmapRequirements.ts will need to compute over the level,
  // and that means it has to be the same LevelId the requirement system already
  // speaks.
  level: LevelId;
  difficulty: number;       // orders cards WITHIN a level
};

export type PickExercise =
  | (PickExerciseBase & {
      kind: 'pattern';
      steps: (sounding: number[]) => (number | null)[];
      // Fewest sounding strings a chord needs to run this. Display only — the
      // real test is whether `steps` produced anything (see supportsShape), and
      // check:picks asserts the two agree on every library fingering so the
      // label can't drift away from the behaviour.
      minStrings: number;
    })
  | (PickExerciseBase & { kind: 'riff'; notes: RiffNote[]; chordIds?: string[] });

/** Indices of the strings this shape actually sounds, low → high. */
export function soundingStrings(shape: ChordShape): number[] {
  return stringPitches(shape)
    .map((midi, i) => (midi == null ? -1 : i))
    .filter(i => i >= 0);
}

// Down the strings then back up, `times` picks on each. The video's first
// exercise: repeating each string is deliberate, so you change string rarely and
// practise the crossing itself rather than a scramble.
function run(times: number) {
  return (sounding: number[]): (number | null)[] => {
    const out: number[] = [];
    for (const s of sounding) for (let i = 0; i < times; i++) out.push(s);
    // Back up, without picking the turn-around string twice in a row.
    for (const s of [...sounding].reverse().slice(1)) {
      for (let i = 0; i < times; i++) out.push(s);
    }
    return out;
  };
}

// String SKIPPING: pairs two string-positions apart (6→4, 5→3, 4→2, 3→1), then
// the same coming back. Pairs touching a muted string are dropped rather than
// squeezed together — the point of the exercise is the size of the jump, so
// preserving the gap matters more than keeping every pair.
function skip(times: number) {
  return (sounding: number[]): (number | null)[] => {
    const has = new Set(sounding);
    const out: number[] = [];
    const push = (s: number) => { for (let i = 0; i < times; i++) out.push(s); };
    for (let s = 0; s + 2 <= 5; s++) {
      if (has.has(s) && has.has(s + 2)) { push(s); push(s + 2); }
    }
    for (let s = 5; s - 2 >= 0; s--) {
      if (has.has(s) && has.has(s - 2)) { push(s); push(s - 2); }
    }
    return out;
  };
}

// Directional pattern #1 — written as string numbers "6 · 4 2 · 3 4 3", where · is a rest.
//
// Counted RELATIVE to the chord's lowest sounding string, not as literal string
// numbers: 6 means "the lowest one", 4 means "two up from it", and so on. That
// is what lets it transpose onto a chord that mutes the low E — on G it starts
// on the 6th, on Am it starts on the 5th.
//
// The furthest offset is 4, so the chord must sound five strings up from its
// lowest. Anything narrower returns nothing, which is how the picker knows not
// to offer it.
const PATTERN_1_OFFSETS: (number | null)[] = [0, null, 2, 4, null, 3, 2, 3];
const PATTERN_1_MIN = Math.max(...PATTERN_1_OFFSETS.map(o => o ?? 0)) + 1;

function pattern1(sounding: number[]): (number | null)[] {
  const lowest = sounding[0];
  if (lowest == null) return [];
  const has = new Set(sounding);
  const needed = PATTERN_1_OFFSETS.filter((o): o is number => o != null);
  if (!needed.every(o => has.has(lowest + o))) return [];
  return PATTERN_1_OFFSETS.map(o => (o == null ? null : lowest + o));
}

// THE picking ladder. Ordered by level, then by difficulty within a level.
//
// Deliberately curated, not the cartesian product of the generators above: the
// ×1/×2 runs and the ×4/×1 skips exist as factories but are NOT cards, because
// getting harder here means raising the BPM on the same exercise. The riffs are
// the real progression.
export const PICK_EXERCISES: PickExercise[] = [
  {
    id: 'peter-gunn', kind: 'riff', name: 'Peter Gunn', level: 'l1', difficulty: 1,
    hint: 'One string, eight notes. No crossing at all — this is pure pick control.',
    // Low E only. The open string is the drone the riff walks away from and
    // back to, which is what makes it sound like Peter Gunn.
    notes: [0, 0, 2, 0, 3, 0, 5, 4].map(fret => ({ stringIndex: 0, fret })),
  },
  {
    id: 'run4', kind: 'pattern', name: 'Each string ×4', level: 'l1', difficulty: 2,
    minStrings: 1,
    hint: 'Four picks per string, down to the high e and back. Change string rarely — the crossing is the exercise.',
    steps: run(4),
  },
  {
    id: 'skip2', kind: 'pattern', name: 'Skip a string ×2', level: 'l1', difficulty: 3,
    minStrings: 3,
    hint: 'Jump over one string: 6→4, 5→3, 4→2, 3→1, then back. Two picks each.',
    steps: skip(2),
  },
  {
    // The id is the reps.pickRecords key and stays 'directional' forever; only
    // what it is CALLED changed.
    id: 'directional', kind: 'pattern', name: 'Directional pattern #1', level: 'l2', difficulty: 1,
    minStrings: PATTERN_1_MIN,
    hint: 'Lowest string, rest, then weaving up — with the pick still moving through the rests.',
    steps: pattern1,
  },
];

// What KIND of exercise a card is, as the user meets it. A 'pattern' is called
// "Chords" on screen because that is what you actually choose to run it on —
// the internal name describes the mechanism (a rule over the sounding strings),
// which is the wrong thing to put on a card.
export const PICK_KIND_LABEL: Record<PickExercise['kind'], string> = {
  pattern: 'Chords',
  riff: 'Riff',
};

export function pickExerciseById(id: string): PickExercise | undefined {
  return PICK_EXERCISES.find(p => p.id === id);
}

/**
 * Can this chord run this exercise? THE single source of truth for the picker.
 *
 * A pattern is playable exactly when its generator produced something — which
 * is why every generator returns [] rather than a degraded version when the
 * shape is too narrow. A riff needs no chord at all.
 */
export function supportsShape(exercise: PickExercise, shape: ChordShape): boolean {
  if (exercise.kind === 'riff') return true;
  return buildSteps(exercise, shape).length > 0;
}

/**
 * The full step list for one pass of a pattern over `shape`, with a display-only
 * down/up alternation. Empty when the shape sounds too few strings for the
 * pattern (e.g. skipping needs two strings two apart).
 */
export function buildSteps(
  pattern: { steps: (sounding: number[]) => (number | null)[] },
  shape: ChordShape,
): PickStep[] {
  const strings = pattern.steps(soundingStrings(shape));
  return strings.map((stringIndex, i) => ({
    stringIndex,
    direction: (i % 2 === 0 ? 'down' : 'up') as PickDirection,
  }));
}

/**
 * One pass of `exercise` per held shape, as fretted notes.
 *
 * For a PATTERN the fret is read off the shape, which doubles as a correctness
 * check: a generator that returned a muted string would surface an 'x' here
 * instead of silently asking for a string that makes no sound. For a RIFF the
 * frets are its own and the shapes are ignored — hence a single pass.
 */
export function buildTab(exercise: PickExercise, shapes: ChordShape[]): PickNote[][] {
  if (exercise.kind === 'riff') {
    return [exercise.notes.map((n, i) => ({
      ...n,
      direction: (i % 2 === 0 ? 'down' : 'up') as PickDirection,
    }))];
  }
  return shapes.map(shape => buildSteps(exercise, shape).flatMap((step): PickNote[] => {
    if (step.stringIndex == null) {
      return [{ stringIndex: null, fret: null, direction: step.direction }];
    }
    const fret = shape.frets[step.stringIndex];
    if (fret === 'x') return [];  // unreachable via soundingStrings; belt and braces
    return [{ stringIndex: step.stringIndex, fret, direction: step.direction }];
  }));
}
