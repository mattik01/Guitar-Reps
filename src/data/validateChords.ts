// Chord data validator — the double-check that keeps fingerings correct and
// consistent with our convention (T = thumb, 1 index, 2 middle, 3 ring, 4 pinky).
//
// It runs two independent kinds of check:
//   1. STRUCTURAL — a finger can't sit on an open/muted string, can't press two
//      different frets at once, fretted strings need a finger, barres are sane, etc.
//   2. HARMONIC   — it computes the pitch classes the shape actually sounds (from
//      standard tuning + the frets) and asserts they spell the named chord. A wrong
//      fret makes a wrong note, so this catches "sends the learner in a wrong
//      direction" errors that structural checks alone would miss.
//
// The harmonic check only runs for plain major/minor triads (e.g. C, Am, Bm);
// richer chords (7ths, sus, extended) skip it and rely on the structural checks.

import type { ChordShape } from '../state/store';
import { CHORD_CATEGORIES } from './chordCategories';

// Standard-tuning open-string pitch classes, low E → high E.
export const OPEN_PC = [4, 9, 2, 7, 11, 4];
const STRING_LABELS = ['low E', 'A', 'D', 'G', 'B', 'high e'];
const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6,
  Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const NOTE_NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CATEGORY_IDS = new Set<string>(CHORD_CATEGORIES.map(c => c.id));

export type ChordToCheck = {
  id: string;
  name: string;
  fingerings: { shape: ChordShape; label?: string }[];
  category?: string;
  difficulty?: number;
  importance?: number;
};

export type ChordIssue = { chordId: string; message: string };

// A plain major/minor triad name → the pitch classes it must contain.
// Returns null for anything that isn't a bare triad (7ths, sus, "F (barre)", …).
function expectedTriad(name: string): Set<number> | null {
  const m = name.trim().match(/^([A-G][#b]?)(m)?$/);
  if (!m) return null;
  const root = NOTE_PC[m[1]];
  if (root == null) return null;
  const third = (root + (m[2] === 'm' ? 3 : 4)) % 12;
  const fifth = (root + 7) % 12;
  return new Set([root, third, fifth]);
}

export function soundingPitchClasses(shape: ChordShape): number[] {
  const out: number[] = [];
  shape.frets.forEach((f, i) => {
    if (f === 'x') return;
    out.push((OPEN_PC[i] + (f as number)) % 12);
  });
  return out;
}

// Structural + harmonic checks for a single fingering of a chord named `name`.
export function validateShape(name: string, shape: ChordShape): string[] {
  const errs: string[] = [];
  const { frets, fingers, barre } = shape;

  if (!Array.isArray(frets) || frets.length !== 6) errs.push(`frets must have 6 entries (got ${frets?.length})`);
  if (!Array.isArray(fingers) || fingers.length !== 6) errs.push(`fingers must have 6 entries (got ${fingers?.length})`);
  if (errs.length) return errs; // can't check placement without well-formed arrays

  const fingerFrets = new Map<number | 'T', Set<number>>();
  for (let i = 0; i < 6; i++) {
    const f = frets[i];
    const finger = fingers[i];

    if (f !== 'x' && (typeof f !== 'number' || !Number.isInteger(f) || f < 0 || f > 24)) {
      errs.push(`${STRING_LABELS[i]}: fret must be 0–24 or 'x' (got ${JSON.stringify(f)})`);
      continue;
    }
    if (!(finger === null || finger === 'T' || finger === 1 || finger === 2 || finger === 3 || finger === 4)) {
      errs.push(`${STRING_LABELS[i]}: finger must be 1–4, 'T' or null (got ${JSON.stringify(finger)})`);
      continue;
    }
    // The thumb wraps over the top of the neck: it can only reach the two lowest
    // strings (low E, A). A 'T' on D/G/B/high-e is physically impossible — this is
    // the check that catches "thumb where the index finger belongs" mistakes.
    if (finger === 'T' && i >= 2) {
      errs.push(`${STRING_LABELS[i]}: thumb (T) can only reach the low E or A string, not ${STRING_LABELS[i]} — did you mean finger 1?`);
    }

    const inBarre = !!barre && f !== 'x' && (f as number) === barre.fret && i >= barre.fromIndex && i <= barre.toIndex;

    if (f === 'x' || f === 0) {
      if (finger !== null) {
        errs.push(`${STRING_LABELS[i]}: ${f === 'x' ? 'muted' : 'open'} string must have no finger (got ${JSON.stringify(finger)})`);
      }
    } else {
      if (finger === null && !inBarre) {
        errs.push(`${STRING_LABELS[i]}: fretted at ${f} but no finger assigned`);
      }
      if (finger !== null) {
        let set = fingerFrets.get(finger);
        if (!set) { set = new Set(); fingerFrets.set(finger, set); }
        set.add(f as number);
      }
    }
  }

  // one finger cannot press two different frets at once
  for (const [finger, fretSet] of fingerFrets) {
    if (fretSet.size > 1) {
      errs.push(`finger ${finger} placed on multiple frets (${[...fretSet].sort((a, b) => a - b).join(', ')}) — impossible`);
    }
  }

  if (shape.baseFret != null && (!Number.isInteger(shape.baseFret) || shape.baseFret < 1 || shape.baseFret > 24)) {
    errs.push(`baseFret must be 1–24 (got ${shape.baseFret})`);
  }

  if (barre) {
    if (!(barre.fromIndex >= 0 && barre.fromIndex < barre.toIndex && barre.toIndex <= 5)) {
      errs.push(`barre must satisfy 0 ≤ fromIndex < toIndex ≤ 5 (got ${barre.fromIndex}→${barre.toIndex})`);
    }
    if (!(Number.isInteger(barre.fret) && barre.fret >= 1)) {
      errs.push(`barre fret must be an integer ≥ 1 (got ${barre.fret})`);
    }
    if (frets[barre.fromIndex] !== barre.fret || frets[barre.toIndex] !== barre.fret) {
      errs.push(`barre endpoints must be fretted at the barre fret (${barre.fret})`);
    }
  }

  // harmonic: do the frets actually spell the named chord? (triads only)
  const expected = expectedTriad(name);
  if (expected) {
    const sounding = new Set(soundingPitchClasses(shape));
    for (const pc of sounding) {
      if (!expected.has(pc)) errs.push(`sounds a ${NOTE_NAME[pc]}, which is not in ${name}`);
    }
    for (const pc of expected) {
      if (!sounding.has(pc)) errs.push(`missing chord tone ${NOTE_NAME[pc]} for ${name}`);
    }
  }

  return errs;
}

// Full check for a chord: metadata once, plus every fingering.
export function validateChord(chord: ChordToCheck): string[] {
  const errs: string[] = [];

  if (chord.category != null && !CATEGORY_IDS.has(chord.category)) {
    errs.push(`unknown category '${chord.category}'`);
  }
  if (chord.difficulty != null && !(Number.isInteger(chord.difficulty) && chord.difficulty >= 1 && chord.difficulty <= 10)) {
    errs.push(`difficulty must be an integer 1–10 (got ${chord.difficulty})`);
  }
  if (chord.importance != null && !(Number.isInteger(chord.importance) && chord.importance >= 1 && chord.importance <= 10)) {
    errs.push(`importance must be an integer 1–10 (got ${chord.importance})`);
  }

  if (!Array.isArray(chord.fingerings) || chord.fingerings.length === 0) {
    errs.push('must have at least one fingering');
    return errs;
  }

  chord.fingerings.forEach((f, i) => {
    const tag = f.label ? `fingering ${i + 1} (${f.label})` : `fingering ${i + 1}`;
    for (const m of validateShape(chord.name, f.shape)) errs.push(`${tag}: ${m}`);
  });

  return errs;
}

export function validateLibrary(chords: ChordToCheck[]): ChordIssue[] {
  const issues: ChordIssue[] = [];
  const seen = new Set<string>();
  for (const c of chords) {
    if (seen.has(c.id)) issues.push({ chordId: c.id, message: 'duplicate chord id' });
    seen.add(c.id);
    for (const m of validateChord(c)) issues.push({ chordId: c.id, message: m });
  }
  return issues;
}
