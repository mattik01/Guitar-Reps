// Hard requirements per roadmap level: the things the APP can verify, as opposed to
// the steps you tick off yourself. They are never manually toggleable — each one is
// computed from your repertoire, your swap records and your songs.
//
// These are deliberately easy to edit: the whole definition of a level's targets is
// the table below. Matteo tunes them as he gets better and as new exercise types
// (fingerpicking, strumming) start producing measurements worth requiring.
import { libraryChordsByCategory } from './chordLibrary';
import { repertoireByBase, recordForPair } from './songTransitions';
import {
  CURRICULUM_LEVELS, stepsFor, transitionAvailable,
  type TransitionTarget,
} from './transitionTargets';
import { CAL_MIN_SCORE, profileScore } from '../audio/calibration';
import type { CalibrationProfile, Chord, Playlist, Song, SwapRecord } from '../state/store';

/** Everything a requirement is allowed to look at. */
export type RequirementContext = {
  repertoire: Chord[];
  swaps: Record<string, SwapRecord>;
  /** Per-chord mic calibration — owning a chord isn't the same as the app knowing it. */
  profiles: Record<string, CalibrationProfile>;
  /** Saved songs (catalog cache ⊕ overlay), already merged for display. */
  songs: Song[];
  playlists: Playlist[];
  /**
   * A song's playability 0..100, or null when it can't be scored yet (its
   * progression hasn't been loaded). Null counts as "not met", never as 0.
   */
  playabilityOf: (song: Song) => number | null;
};

export type RequirementResult = {
  id: string;
  label: string;
  met: boolean;
  /** Progress towards the requirement, for the "3 / 8" readout. */
  value: number;
  total: number;
  /** What is still missing, or what was achieved. Shown muted next to the label. */
  detail: string;
};

export type RoadmapRequirement = {
  id: string;
  label: string;
  /**
   * True when the check calls `playabilityOf` — the catalog gate keys off this.
   * A flag rather than a sniff at the label, because labels are wording and wording
   * changes ("add 3 songs to a playlist" contains "play" without needing a score).
   */
  needsScore?: boolean;
  check: (ctx: RequirementContext) => Omit<RequirementResult, 'id' | 'label'>;
};

// --- the building blocks -----------------------------------------------------

/**
 * Every chord of a library category is in the repertoire AND calibrated for the
 * user's mic. Owning a chord is a claim; a calibration profile is the app being able
 * to hear it — a level shouldn't count as done on the claim alone.
 */
function ownsCategory(id: string, label: string, category: Parameters<typeof libraryChordsByCategory>[0]): RoadmapRequirement {
  return {
    id,
    label,
    check: ({ repertoire, profiles }) => {
      const want = libraryChordsByCategory(category).map(c => c.id);
      const owned = new Set(repertoire.map(c => c.id));
      const missing = want.filter(c => !owned.has(c));
      const uncalibrated = want.filter(
        c => owned.has(c) && profileScore(profiles[c]?.samples ?? []) < CAL_MIN_SCORE,
      );
      const done = want.filter(c => owned.has(c) && !uncalibrated.includes(c));
      const parts: string[] = [];
      if (missing.length) parts.push(`missing ${missing.join(', ')}`);
      if (uncalibrated.length) parts.push(`not calibrated: ${uncalibrated.join(', ')}`);
      return {
        value: done.length,
        total: want.length,
        met: done.length === want.length,
        detail: parts.length ? parts.join(' · ') : `${want.length} chords, all calibrated`,
      };
    },
  };
}

/**
 * Named chord changes, each trained to at least ITS OWN target in swaps per minute
 * (see src/data/transitionTargets.ts — the target follows the change's difficulty,
 * not a flat per-level number). Measured on your BEST minute for the pair: the
 * requirement is "you have reached this", not "you are holding it today".
 *
 * A change whose chords aren't in the library yet counts neither towards nor
 * against you — it is named in the detail and left out of the tally, so a level
 * stays completable while the library grows.
 */
function swapTargets(id: string, label: string, targets: TransitionTarget[]): RoadmapRequirement {
  return {
    id,
    label,
    check: ({ repertoire, swaps }) => {
      const byBase = repertoireByBase(repertoire);
      const live = targets.filter(t => transitionAvailable(t.a, t.b));
      const pending = targets.filter(t => !transitionAvailable(t.a, t.b));
      const hit = live.filter(t => (recordForPair(t.a, t.b, byBase, swaps)?.bestCount ?? 0) >= t.target);
      const short = live.filter(t => !hit.includes(t)).map(t => `${t.a}\u2194${t.b} ${t.target}/min`);
      const parts: string[] = [];
      if (short.length) parts.push(`still to reach: ${short.join(', ')}`);
      else if (live.length) parts.push(`all ${live.length} at target`);
      if (pending.length) parts.push(`not in the library yet: ${pending.map(t => `${t.a}\u2194${t.b}`).join(', ')}`);
      return {
        value: hit.length,
        total: live.length,
        met: live.length > 0 && hit.length === live.length,
        detail: parts.join(' \u00b7 '),
      };
    },
  };
}

/**
 * N songs in your collection, optionally each at or above a playability score.
 * "In a playlist" IS the definition of a saved song (see PlaylistPicker), so being
 * in reps.songs is enough.
 */
function songsSaved(id: string, label: string, count: number, minPlayability?: number): RoadmapRequirement {
  return {
    id,
    label,
    needsScore: minPlayability != null,
    check: ({ songs, playabilityOf }) => {
      const qualifying = minPlayability == null
        ? songs
        : songs.filter(s => (playabilityOf(s) ?? -1) >= minPlayability);
      const have = Math.min(qualifying.length, count);
      return {
        value: have,
        total: count,
        met: qualifying.length >= count,
        detail: minPlayability == null
          ? `${songs.length} saved`
          : `${qualifying.length} at ${minPlayability}%+ playability`,
      };
    },
  };
}

/** Any `count` distinct chord pairs trained to `target` — breadth, not specific pairs. */
function swapBreadth(id: string, label: string, count: number, target: number): RoadmapRequirement {
  return {
    id,
    label,
    check: ({ swaps }) => {
      const hit = Object.values(swaps).filter(r => r.bestCount >= target).length;
      return {
        value: Math.min(hit, count),
        total: count,
        met: hit >= count,
        detail: `${hit} pair${hit === 1 ? '' : 's'} at ${target}+/min`,
      };
    },
  };
}

// --- the levels --------------------------------------------------------------

// The chord changes themselves live in src/data/transitionTargets.ts: which pairs a
// level asks for, at what speed, and why. Each level's swap steps are generated from
// that table so the two can never drift, and so a level is retuned by editing the
// curriculum rather than this file.
const swapStepsFor = (level: string): RoadmapRequirement[] =>
  stepsFor(level).map(s => swapTargets(s.id, s.label, s.targets));

/** The non-transition targets — chords owned, songs saved, breadth. */
const OTHER_REQUIREMENTS: Record<string, RoadmapRequirement[]> = {
  l1: [
    ownsCategory('l1-chords', 'Have all the basic open chords calibrated', 'open-basic'),
    songsSaved('l1-songs', 'Add 3 songs to a playlist', 3),
  ],
  l2: [
    ownsCategory('l2-chords', 'Have all the open seventh chords calibrated', 'sevenths-open'),
    swapBreadth('l2-breadth', 'Get 6 different chord changes to 25/min', 6, 25),
    songsSaved('l2-songs', 'Add 3 songs you could play end to end to a playlist', 3, 100),
  ],
  l3: [
    ownsCategory('l3-chords', 'Have the barre chords calibrated', 'barre'),
    songsSaved('l3-songs', 'Add 5 songs you could play end to end to a playlist', 5, 100),
  ],
  l4: [swapBreadth('l4-breadth', 'Get 20 different chord changes to 40/min', 20, 40)],
  l5: [swapBreadth('l5-breadth', 'Get 30 different chord changes to 45/min', 30, 45)],
  l6: [swapBreadth('l6-breadth', 'Get 40 different chord changes to 55/min', 40, 55)],
};

// Chords first, then the chord changes, then the songs they add up to.
export const LEVEL_REQUIREMENTS: Record<string, RoadmapRequirement[]> = Object.fromEntries(
  CURRICULUM_LEVELS.map(level => {
    const other = OTHER_REQUIREMENTS[level] ?? [];
    const chords = other.filter(r => r.id.endsWith('-chords'));
    const rest = other.filter(r => !r.id.endsWith('-chords'));
    return [level, [...chords, ...swapStepsFor(level), ...rest]];
  }),
);

export function requirementsFor(levelId: string): RoadmapRequirement[] {
  return LEVEL_REQUIREMENTS[levelId] ?? [];
}

export function evaluateLevel(levelId: string, ctx: RequirementContext): RequirementResult[] {
  return requirementsFor(levelId).map(r => ({ id: r.id, label: r.label, ...r.check(ctx) }));
}

/** True when any listed level needs a song scored — the catalog gate keys off this. */
export function needsPlayability(levelIds: string[]): boolean {
  return levelIds.some(id => requirementsFor(id).some(r => r.needsScore));
}
