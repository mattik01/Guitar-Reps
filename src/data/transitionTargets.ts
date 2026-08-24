// The chord-change curriculum: which transitions become a target at which roadmap
// level, and how fast you have to be able to play each one there.
//
// A transition here is the SAME identity the rest of the app uses: an undirected
// pair of base triads (see src/data/songTransitions.ts). B7 reduces to "B", Am7 to
// "Am", F (barre) and F (mini) both to "F" — so a target is about the change, not
// about which voicing you happen to own.
//
// --- where the numbers come from ---------------------------------------------
//
// Frequency: `npm run stats:transitions` counts every undirected base pair across
// the 376k catalog songs that have a tempo. `rank` below is that global ranking;
// all 50 most frequent transitions in the catalog are a target at some level.
//
// Speed: the app already defines "fast enough" per song as
// `speedAnchors(tempo).green = min(bpm/2, 120)` — one change every two beats.
// Measured across the catalog, that number is FLAT: every one of the top 120
// transitions lives in songs averaging 119.6–126.4 BPM, i.e. a green of 59.8–63.2
// swaps/min. Real songs do not play C↔G slower than F↔Gm. So the catalog gives a
// single ceiling (SPEED_CEILING = 60/min, "you can play the average song at tempo")
// and the spread between transitions has to come from difficulty and from how far
// into the roadmap you are. Don't go looking for per-pair tempo spread again — it
// isn't there.
//
// --- the rule ----------------------------------------------------------------
//
//   target = clamp(round10(LEVEL_BASE[level] + DIFF_ADJ(difficulty)), 20, 60)
//
// Every rate is a whole 10 per minute — a target is 20, 30, 40, 50 or 60, never a 5
// in between, so "am I there yet" is a number you can hold in your head. That leaves
// four difficulty bands worth of resolution, which is all the granularity the
// evidence supports anyway:
//
//        level   easy(1–2)  medium(3–6)  hard(7–8)  very hard(9–10)
//        l1        30          20           20          20
//        l2        40          30           20          20
//        l3        50          40           30          20
//        l4        60          50           40          30
//        l5        60          60           50          40
//        l6        60          60           60          50
//
// A level is tuned by moving one base, a pair by moving one difficulty.
// scripts/checkRoadmap.ts asserts the level-legality rule that matters most: a level
// may only target transitions whose BOTH chords are legal at that level or earlier —
// L2 never asks for a change that needs an L3 chord, however common it is. It also
// caps a step at MAX_PER_STEP changes: a bullet you can read at a glance. The rest of
// the change surface is the user's to find in the songs they play.
//
// A level has as many bullets as its number — l1 one, l6 six — so the surface widens
// as you get further in rather than dumping everything at the start, and each level's
// NEW chords all appear in at least one of its changes.
//
// A change is asked for at most MAX_APPEARANCES times across the whole roadmap, and a
// repeat must be at least MIN_REVISIT_JUMP faster than the previous ask — so a level
// either brings new changes or brings a real step up in speed, never the same change
// again for ten more per minute. All of it is asserted in scripts/checkRoadmap.ts.
import { CHORD_LIBRARY } from './chordLibrary';
import { normalizeToLevel } from './chordNormalize';
import { stripShape } from './songTransitions';

export type LevelId = 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'l6';

export const CURRICULUM_LEVELS: LevelId[] = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];

/** The base triads a level introduces (not cumulative — see `chordsThrough`). */
export const LEVEL_NEW_CHORDS: Record<LevelId, string[]> = {
  l1: ['C', 'D', 'Dm', 'E', 'Em', 'A', 'Am', 'G'],           // open basics
  l2: ['B'],                                                  // open 7ths — only B7 adds a new base
  l3: ['F', 'Bm'],                                            // first barres
  l4: ['F#', 'F#m', 'C#m', 'G#m'],                            // sharp-key barres
  l5: ['A#', 'D#', 'G#', 'Gm', 'Cm', 'Fm'],                   // flat-key barres
  l6: ['C#', 'A#m', 'D#m'],                                   // the remainder
};

/** Every base triad legal at `level` or before it. */
export function chordsThrough(level: LevelId): Set<string> {
  const out = new Set<string>();
  for (const l of CURRICULUM_LEVELS) {
    for (const c of LEVEL_NEW_CHORDS[l]) out.add(c);
    if (l === level) break;
  }
  return out;
}

/** The level a base triad first becomes legal at, or null if it isn't in the curriculum. */
export function levelOfChord(base: string): LevelId | null {
  for (const l of CURRICULUM_LEVELS) if (LEVEL_NEW_CHORDS[l].includes(base)) return l;
  return null;
}

// --- the speed rule ----------------------------------------------------------

/** Where a level starts. Everything converges on the catalog's green by l6. */
export const LEVEL_BASE: Record<LevelId, number> = { l1: 20, l2: 30, l3: 40, l4: 50, l5: 60, l6: 70 };

/** round10(avg green across the whole catalog) — no target is ever asked above this. */
export const SPEED_CEILING = 60;
/** Below this a "target" isn't a target — it's the rate you already have. */
export const SPEED_FLOOR = 20;
/** Rates are whole tens per minute, so every target is a number you can hold in your head. */
export const SPEED_STEP = 10;
/** How many changes one bullet may hold. Beyond that it stops being readable. */
export const MAX_PER_STEP = 10;
/** How often the same change may be asked for across the whole roadmap. */
export const MAX_APPEARANCES = 3;
/**
 * A change comes back only for a real jump. Re-asking C↔G at 30 after you hit 20 is
 * busywork; asking for 40 is a new thing to train. So a repeat must be at least this
 * much faster than the last time it was asked.
 */
export const MIN_REVISIT_JUMP = 20;

/** Easy changes are asked faster than hard ones at the same level. */
export function diffAdj(difficulty: number): number {
  return difficulty <= 2 ? 10 : difficulty <= 6 ? 0 : difficulty <= 8 ? -10 : -20;
}

const round10 = (n: number) => Math.round(n / SPEED_STEP) * SPEED_STEP;

export function speedTarget(level: LevelId, difficulty: number): number {
  return Math.max(SPEED_FLOOR, Math.min(SPEED_CEILING, round10(LEVEL_BASE[level] + diffAdj(difficulty))));
}

// --- the curriculum ----------------------------------------------------------

export type TransitionTarget = {
  a: string;            // base triads, a <= b (same canonical order as Transition)
  b: string;
  target: number;       // swaps/min asked at THIS level
  difficulty: number;   // 1–10, authored (see the table in the level lists below)
  rank: number;         // global frequency rank in the catalog, 0 = outside the top 120
};

export type TransitionStep = {
  id: string;
  label: string;
  /**
   * Every change the bullet asks for. All of them are hard: the checkbox lights only
   * when the whole list is at target. There is no "shown but doesn't count" tier —
   * if a change is worth putting in front of you, it is worth reaching.
   */
  targets: TransitionTarget[];
};

/** [chordA, chordB, difficulty, frequency rank] — the authored form. */
type Spec = [string, string, number, number];

function build(level: LevelId, specs: Spec[]): TransitionTarget[] {
  return specs.map(([x, y, difficulty, rank]) => {
    const [a, b] = x <= y ? [x, y] : [y, x];
    return { a, b, difficulty, rank, target: speedTarget(level, difficulty) };
  });
}

const step = (level: LevelId, id: string, label: string, ...specs: Spec[][]): TransitionStep =>
  ({ id, label, targets: build(level, specs.flat()) });

// Difficulty scale used throughout:
//   1–2  two open chords sharing ≥2 fingers          (Am↔C, Em↔G, A↔E, Am↔Em)
//   3–4  two open chords, small hand move            (A↔D, D↔Em, C↔Dm)
//   5    two open chords, full hand reshape          (C↔G, G↔D, A↔C)
//   6    open ↔ stretchy open (the B7 shape)         (A↔B, B↔E)
//   7    open ↔ movable minor barre                  (A↔Bm, E↔F#m)
//   8    open ↔ full barre major                     (C↔F, A#↔C)
//   9    barre ↔ barre                               (B↔F#, A#↔F, Cm↔Gm)
//  10    barre ↔ barre in a rare key                 (A#m↔G#, C#↔D#m)

export const LEVEL_TRANSITIONS: Record<LevelId, TransitionStep[]> = {
  // One bullet at l1, two at l2, and so on. A bullet is one of three kinds:
  //   • NEW      — the changes a chord this level introduces makes possible
  //   • MORE     — more of a group you already started (more open changes, more F)
  //   • FASTER   — changes you have already reached, asked at a real step up
  // A FASTER bullet may mix families freely (core + blues + barres) or stay in one,
  // whichever reads better at that level. Within every bullet the picking rule is the
  // same: most frequent first, easiest first, and every chord the level introduces
  // gets at least one change. Everything listed is required — nothing here is decoration.
  l1: [
    step('l1', 'l1-first-changes', 'Learn your first chord changes',
      [['Am', 'C', 1, 11], ['Em', 'G', 2, 13], ['A', 'E', 2, 5], ['Am', 'Em', 2, 18],
       ['C', 'G', 5, 1], ['D', 'G', 5, 2], ['A', 'D', 3, 3], ['D', 'Em', 3, 9]],
      [['Am', 'G', 4, 7], ['C', 'Dm', 4, 22]]),
  ],
  l2: [
    step('l2', 'l2-blues-changes', 'Learn the 12-bar blues changes (7ths)',
      [['A', 'B', 6, 21], ['B', 'E', 6, 15], ['B', 'Em', 6, 47]],
      [['B', 'C', 7, 59], ['B', 'D', 6, 71], ['B', 'G', 7, 73], ['Am', 'B', 6, 107]]),
    step('l2', 'l2-more-open', 'Add more open changes',
      [['C', 'D', 4, 6], ['A', 'G', 5, 10], ['C', 'Em', 3, 12], ['D', 'E', 3, 16]],
      [['Am', 'D', 3, 24], ['Am', 'Dm', 3, 25], ['Am', 'E', 2, 29], ['Dm', 'G', 4, 30],
       ['A', 'Em', 3, 31], ['A', 'C', 5, 44]]),
  ],
  l3: [
    step('l3', 'l3-f-changes', 'Learn your first F changes',
      [['C', 'F', 8, 4], ['F', 'G', 8, 8], ['Am', 'F', 8, 14]],
      [['Dm', 'F', 8, 26], ['Em', 'F', 8, 39], ['E', 'F', 8, 53], ['D', 'F', 8, 57],
       ['A', 'F', 8, 82]]),
    step('l3', 'l3-bm-changes', 'Learn your first Bm changes',
      [['A', 'Bm', 7, 17], ['Bm', 'G', 7, 20], ['Bm', 'D', 7, 23]],
      [['Bm', 'Em', 7, 34], ['Bm', 'C', 7, 51], ['Bm', 'E', 7, 48], ['Am', 'Bm', 7, 75]]),
    step('l3', 'l3-core-faster', 'Speed up the core changes',
      [['C', 'G', 5, 1], ['D', 'G', 5, 2], ['A', 'D', 3, 3], ['D', 'Em', 3, 9]],
      [['Am', 'G', 4, 7], ['C', 'Dm', 4, 22], ['E', 'G', 4, 45]]),
  ],
  l4: [
    step('l4', 'l4-sharp-minors', 'Learn the sharp-key minor barres',
      [['E', 'F#m', 7, 28], ['A', 'F#m', 7, 32], ['D', 'F#m', 7, 35],
       ['A', 'C#m', 7, 37], ['B', 'C#m', 7, 38], ['C#m', 'E', 7, 42]],
      [['Bm', 'F#m', 9, 52], ['F#m', 'G', 7, 66], ['B', 'F#m', 7, 67],
       ['C#m', 'F#m', 9, 68]]),
    step('l4', 'l4-barre-majors', 'Learn the full barre majors',
      [['B', 'F#', 8, 33], ['E', 'F#', 8, 41], ['E', 'G#m', 7, 60], ['F#', 'G#m', 9, 65]],
      [['F#', 'G', 8, 76], ['Bm', 'F#', 9, 80], ['A', 'F#', 8, 85], ['A', 'G#m', 7, 94],
       ['D', 'F#', 8, 109], ['C#m', 'F#', 9, 111]]),
    step('l4', 'l4-open-tempo', 'Speed up the open changes',
      [['C', 'D', 4, 6], ['A', 'G', 5, 10], ['C', 'Em', 3, 12], ['D', 'E', 3, 16]],
      [['Am', 'D', 3, 24], ['Am', 'Dm', 3, 25], ['Am', 'E', 2, 29], ['Dm', 'G', 4, 30],
       ['A', 'Em', 3, 31], ['A', 'C', 5, 44]]),
    step('l4', 'l4-blues-speed', 'Speed up the blues changes',
      [['A', 'B', 6, 21], ['B', 'E', 6, 15], ['B', 'Em', 6, 47]],
      [['B', 'C', 7, 59], ['B', 'D', 6, 71], ['B', 'G', 7, 73], ['Am', 'B', 6, 107]]),
  ],
  l5: [
    step('l5', 'l5-flat-majors', 'Learn the flat-key majors',
      [['A#', 'C', 8, 27], ['A#', 'Dm', 8, 40], ['A#', 'F', 9, 19],
       ['A#', 'D#', 9, 36], ['D#', 'G#', 9, 43]],
      [['D#', 'F', 9, 58], ['A#', 'G#', 9, 62], ['A#', 'G', 8, 84], ['A', 'A#', 8, 88],
       ['A#', 'Am', 8, 90]]),
    step('l5', 'l5-flat-minors', 'Learn the flat-key minors',
      [['C', 'Gm', 8, 64], ['Dm', 'Gm', 8, 63], ['F', 'Gm', 9, 46],
       ['A#', 'Gm', 9, 55], ['Cm', 'Gm', 9, 77], ['Fm', 'G#', 9, 95]],
      [['A#', 'Cm', 9, 61], ['D#', 'Gm', 9, 70], ['Cm', 'D#', 9, 78], ['Cm', 'G#', 9, 79]]),
    step('l5', 'l5-barres-tempo', 'Take your first barres to song tempo',
      [['C', 'F', 8, 4], ['F', 'G', 8, 8], ['Am', 'F', 8, 14],
       ['A', 'Bm', 7, 17], ['Bm', 'G', 7, 20], ['Bm', 'D', 7, 23]],
      [['Dm', 'F', 8, 26], ['Em', 'F', 8, 39], ['Bm', 'Em', 7, 34], ['Bm', 'E', 7, 48]]),
    step('l5', 'l5-open-tempo', 'Take the open changes to song tempo',
      [['C', 'G', 5, 1], ['D', 'G', 5, 2], ['A', 'D', 3, 3], ['D', 'Em', 3, 9],
       ['Am', 'C', 1, 11], ['A', 'E', 2, 5], ['Em', 'G', 2, 13], ['Am', 'Em', 2, 18]],
      [['Am', 'G', 4, 7], ['E', 'G', 4, 45]]),
    step('l5', 'l5-rest-open', 'Add the rest of the open changes',
      [['A', 'Dm', 4, 54], ['C', 'E', 4, 56], ['Dm', 'Em', 3, 81], ['Dm', 'E', 3, 100]],
      [['A', 'Am', 3, 99], ['D', 'Dm', 3, 114]]),
  ],
  l6: [
    step('l6', 'l6-sharp-keys', 'Learn the remaining sharp keys',
      [['C#', 'F#', 9, 49], ['C#', 'G#', 9, 50], ['B', 'C#', 8, 69],
       ['C#', 'D#', 9, 86], ['C#m', 'G#m', 9, 87]],
      [['C#', 'D', 8, 115]]),
    step('l6', 'l6-rare-minors', 'Learn the rare minor barres',
      [['A#m', 'G#', 10, 93], ['A#m', 'C#', 10, 106], ['D#m', 'F#', 10, 105],
       ['B', 'D#m', 8, 101], ['C#', 'D#m', 10, 96]],
      [['A#m', 'F#', 10, 103], ['C#', 'Fm', 10, 108]]),
    step('l6', 'l6-flats-further', 'Add the rest of the flat keys',
      [['D', 'Gm', 8, 83], ['Cm', 'F', 8, 97], ['C', 'Fm', 8, 102], ['Cm', 'G', 8, 89]],
      [['D#', 'Fm', 9, 92], ['Cm', 'Fm', 9, 98], ['A#', 'Fm', 9, 118], ['Am', 'Gm', 8, 119],
       ['A', 'G#', 8, 110], ['G', 'G#', 8, 112]]),
    step('l6', 'l6-sharp-minors-tempo', 'Take the sharp-key minor barres to song tempo',
      [['E', 'F#m', 7, 28], ['A', 'F#m', 7, 32], ['D', 'F#m', 7, 35],
       ['A', 'C#m', 7, 37], ['B', 'C#m', 7, 38], ['C#m', 'E', 7, 42]],
      [['Bm', 'F#m', 9, 52], ['F#m', 'G', 7, 66], ['B', 'F#m', 7, 67],
       ['C#m', 'F#m', 9, 68]]),
    step('l6', 'l6-barre-majors-tempo', 'Take the full barre majors to song tempo',
      [['B', 'F#', 8, 33], ['E', 'F#', 8, 41], ['E', 'G#m', 7, 60], ['F#', 'G#m', 9, 65]],
      [['F#', 'G', 8, 76], ['Bm', 'F#', 9, 80], ['A', 'F#', 8, 85], ['A', 'G#m', 7, 94],
       ['D', 'F#', 8, 109], ['C#m', 'F#', 9, 111]]),
    // The l5 flat-key changes are NOT re-asked here: at this difficulty l6 is only
    // 10/min above l5, which is not a jump worth a bullet. They stay where they are.
    step('l6', 'l6-more-barre-changes', 'Add more barre-chord changes',
      [['B', 'G#m', 7, 72], ['C#m', 'D', 7, 91], ['Em', 'F#m', 7, 104], ['A#', 'D', 8, 116]],
      [['Bm', 'C#m', 9, 113], ['F#m', 'G#m', 9, 120], ['D', 'D#', 8, 117]]),
  ],
};

/** Where a change is asked for across the whole roadmap, earliest level first. */
export function roadmapAppearances(a: string, b: string): { level: LevelId; target: number }[] {
  const [x, y] = a <= b ? [a, b] : [b, a];
  const out: { level: LevelId; target: number }[] = [];
  for (const level of CURRICULUM_LEVELS) {
    for (const step of LEVEL_TRANSITIONS[level]) {
      const hit = step.targets.find(t => t.a === x && t.b === y);
      if (hit) {
        out.push({ level, target: hit.target });
        break; // a change appears at most once per level
      }
    }
  }
  return out;
}

export function stepsFor(level: string): TransitionStep[] {
  return LEVEL_TRANSITIONS[level as LevelId] ?? [];
}

/** Every target of a step — this is what the grid renders and what the bullet scores. */
export function allTargets(s: TransitionStep): TransitionTarget[] {
  return s.targets;
}

// --- what is actually trainable today ----------------------------------------

/** Base triads the chord library can currently produce (F (barre) and F (mini) → "F"). */
export const LIBRARY_BASES: Set<string> = new Set(
  CHORD_LIBRARY.map(c => normalizeToLevel(stripShape(c.name) || c.id, 'base')),
);

/**
 * True when both chords of a transition exist in the library. Everything else is
 * still defined and placed — it just renders greyed and never gates a level, so a
 * level stays completable while the library grows.
 */
export function transitionAvailable(a: string, b: string): boolean {
  return LIBRARY_BASES.has(a) && LIBRARY_BASES.has(b);
}
