// The one place that answers "given a chord id, what chord is that?" and the one
// place that normalizes the app's three chord representations into the shape a
// ChordCard renders.
//
// Why this file exists: the "repertoire first, else library" precedence was
// duplicated (CalibrationStudio, ChordQuizRoutine) and each copy drifted — the
// Studio resolved to `libraryPrimaryShape` while the routines materialize with
// the user's saved `reps.fingeringChoice`, so you could calibrate one fingering
// and be quizzed on another. Resolving through here fixes that by construction.

import type { Chord, ChordShape, Fingering } from '../state/store';
import { libraryChordById, libraryPrimaryShape, materializeLibraryChord, type LibraryChord } from './chordLibrary';

// What a ChordCard needs to render. `shape` is null ONLY for the ChordEditor
// preview, where the user's in-progress form doesn't parse yet.
export type CardChord = {
  id: string;                 // '' = anonymous draft → no calibration chip
  name: string;
  shape: ChordShape | null;
  fingerings?: Fingering[];   // present → the swipe viewer is possible
};

export type ResolvedChord = {
  id: string;
  name: string;
  shape: ChordShape;
  fingerings?: Fingering[];   // only when it came from the library
  owned: boolean;             // came from the repertoire
};

// Repertoire first (owned, possibly user-EDITED shape), else the library at the
// user's chosen fingering. Null when the id is unknown to both.
export function resolveChord(
  id: string,
  repertoire: Chord[],
  fingeringChoice: Record<string, number> = {},
): ResolvedChord | null {
  const owned = repertoire.find(c => c.id === id);
  if (owned) return { id: owned.id, name: owned.name, shape: owned.shape, owned: true };

  const lib = libraryChordById(id);
  if (!lib) return null;
  // materializeLibraryChord clamps the index and honors the saved choice; fall
  // back to the primary shape if the id somehow resolves to nothing.
  const mat = materializeLibraryChord(id, fingeringChoice[id] ?? 0);
  return {
    id: lib.id,
    name: lib.name,
    shape: mat?.shape ?? libraryPrimaryShape(lib),
    fingerings: lib.fingerings,
    owned: false,
  };
}

export function resolveCard(
  id: string,
  repertoire: Chord[],
  fingeringChoice: Record<string, number> = {},
): CardChord | null {
  const r = resolveChord(id, repertoire, fingeringChoice);
  if (!r) return null;
  return { id: r.id, name: r.name, shape: r.shape, fingerings: r.fingerings };
}

// --- adapters: the three representations → CardChord -------------------------

// A repertoire chord has ONE shape, which the user may have edited. Never attach
// library fingerings here: `reps.fingeringChoice` is keyed by chord id and shared
// with the library grid, so a swipe would silently render over the user's edit.
export function cardFromChord(c: Chord): CardChord {
  return { id: c.id, name: c.name, shape: c.shape };
}

export function cardFromLibrary(l: LibraryChord): CardChord {
  return { id: l.id, name: l.name, shape: libraryPrimaryShape(l), fingerings: l.fingerings };
}

// An unsaved chord being drawn in the editor. Pass id '' to suppress the
// calibration chip (there is no persisted chord to calibrate yet).
export function cardFromDraft(id: string, name: string, shape: ChordShape | null): CardChord {
  return { id, name, shape };
}
