import type { Chord, Fingering } from '../state/store';
import type { ChordCategoryId } from './chordCategories';
import { validateLibrary } from './validateChords';

// Every library chord carries: which category it's in, a difficulty (1–10) and
// importance (1–10), an optional short info blurb, and one or more fingerings.
//
// Fingering convention (must match ChordEditor's help text):
//   frets: low E → high E, 'x' = muted, 0 = open, n = fret number (absolute).
//   fingers: 'T' thumb, 1 index, 2 middle, 3 ring, 4 pinky, null = open/muted.
//
// A chord may have several genuinely-used fingerings (all sounding the same
// notes). They are listed in `fingerings`, MOST POPULAR FIRST — fingerings[0] is
// the default shown. Popularity order is an estimate; reorder as you see fit.
//
// Every fingering is checked at module load by validateChords — see the guard at
// the bottom of this file. A wrong fingering is verified away, not shipped.
export type LibraryChord =
  Omit<Chord, 'learnedAt' | 'perfectReps' | 'shape' | 'category' | 'difficulty' | 'importance'> & {
    category: ChordCategoryId;
    difficulty: number; // 1–10
    importance: number; // 1–10
    info?: string;
    fingerings: Fingering[]; // ordered most-popular first; [0] is the default
  };

export const CHORD_LIBRARY: LibraryChord[] = [
  // ── Category 1: Open Chords — Major & Minor (complete) ─────────────────────
  {
    id: 'Em', name: 'Em', category: 'open-basic', difficulty: 1, importance: 9,
    info: 'The easiest open chord — just two fingers. Found in every genre; a great first chord.',
    fingerings: [
      { shape: { frets: [0, 2, 2, 0, 0, 0], fingers: [null, 2, 3, null, null, null] }, label: '2-3 (middle, ring)' },
      { shape: { frets: [0, 2, 2, 0, 0, 0], fingers: [null, 1, 2, null, null, null] }, label: '1-2 (index, middle)' },
    ],
  },
  {
    id: 'E', name: 'E', category: 'open-basic', difficulty: 3, importance: 8,
    info: 'Full, resonant major using all six strings. Common in rock and blues.',
    fingerings: [
      { shape: { frets: [0, 2, 2, 1, 0, 0], fingers: [null, 2, 3, 1, null, null] }, label: '2-3-1 (standard)' },
    ],
  },
  {
    id: 'Am', name: 'Am', category: 'open-basic', difficulty: 3, importance: 9,
    info: 'Warm, melancholic minor. One of the first and most-used chords.',
    fingerings: [
      { shape: { frets: ['x', 0, 2, 2, 1, 0], fingers: [null, null, 2, 3, 1, null] }, label: '2-3-1 (standard)' },
      { shape: { frets: ['x', 0, 2, 2, 1, 0], fingers: [null, null, 1, 2, 3, null] }, label: '1-2-3' },
    ],
  },
  {
    id: 'D', name: 'D', category: 'open-basic', difficulty: 3, importance: 10,
    info: 'Bright major on the top four strings. Extremely common in folk and pop.',
    fingerings: [
      { shape: { frets: ['x', 'x', 0, 2, 3, 2], fingers: [null, null, null, 1, 3, 2] }, label: '1-3-2 (standard)' },
    ],
  },
  {
    id: 'A', name: 'A', category: 'open-basic', difficulty: 4, importance: 8,
    info: 'Bright major with three fingers at the 2nd fret. Several common fingerings — pick what fits your hand.',
    fingerings: [
      { shape: { frets: ['x', 0, 2, 2, 2, 0], fingers: [null, null, 2, 3, 4, null] }, label: '2-3-4 (frees index)' },
      { shape: { frets: ['x', 0, 2, 2, 2, 0], fingers: [null, null, 1, 2, 3, null] }, label: '1-2-3 (index, middle, ring)' },
      { shape: { frets: ['x', 0, 2, 2, 2, 0], fingers: [null, null, 2, 1, 3, null] }, label: '2-1-3 (index in middle)' },
      {
        shape: {
          frets: ['x', 0, 2, 2, 2, 0], fingers: [null, null, null, null, null, null],
          barre: { fromIndex: 2, toIndex: 4, fret: 2, label: '1/3' },
        },
        label: '1-finger barre',
      },
    ],
  },
  {
    id: 'Dm', name: 'Dm', category: 'open-basic', difficulty: 4, importance: 7,
    info: 'Somber minor on the top four strings — the "saddest" common open chord.',
    fingerings: [
      { shape: { frets: ['x', 'x', 0, 2, 3, 1], fingers: [null, null, null, 2, 3, 1] }, label: '2-3-1 (standard)' },
    ],
  },
  {
    id: 'C', name: 'C', category: 'open-basic', difficulty: 5, importance: 10,
    info: 'A cornerstone major chord. The stretch to the ring finger takes practice.',
    fingerings: [
      { shape: { frets: ['x', 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null] }, label: '3-2-1 (standard)' },
    ],
  },
  {
    id: 'G', name: 'G', category: 'open-basic', difficulty: 5, importance: 10,
    info: 'One of the most-used chords. Two common fingerings; the 3-2-4 keeps the index free for changes to C and D.',
    fingerings: [
      { shape: { frets: [3, 2, 0, 0, 0, 3], fingers: [3, 2, null, null, null, 4] }, label: '3-2-4 (frees index)' },
      { shape: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3] }, label: '2-1-3 (traditional)' },
    ],
  },

  // ── Category: Barre Chords (partial — seeded from the old library) ─────────
  {
    id: 'Fmini', name: 'F (mini)', category: 'barre', difficulty: 6, importance: 6,
    info: 'A four-string "mini F" — a gentler stepping stone toward the full F barre chord.',
    fingerings: [
      {
        shape: {
          frets: ['x', 'x', 3, 2, 1, 1], fingers: [null, null, 3, 2, 1, 1],
          barre: { fromIndex: 4, toIndex: 5, fret: 1 },
        },
      },
    ],
  },
  {
    id: 'F', name: 'F (barre)', category: 'barre', difficulty: 8, importance: 8,
    info: 'The classic E-shape barre chord — a major rite of passage for beginners.',
    fingerings: [
      {
        shape: {
          frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1],
          barre: { fromIndex: 0, toIndex: 5, fret: 1 },
        },
      },
    ],
  },
  {
    id: 'Bm', name: 'Bm', category: 'barre', difficulty: 7, importance: 7,
    info: 'A-shape minor barre at the 2nd fret; the first barre chord in many songs.',
    fingerings: [
      {
        shape: {
          frets: ['x', 2, 4, 4, 3, 2], fingers: [null, 1, 3, 4, 2, 1],
          barre: { fromIndex: 1, toIndex: 5, fret: 2 },
        },
      },
    ],
  },

  // ── Category: Open Seventh Chords (partial — seeded from the old library) ──
  {
    id: 'A7', name: 'A7', category: 'sevenths-open', difficulty: 2, importance: 6,
    info: 'Bluesy dominant 7th that wants to resolve. Easy open shape.',
    fingerings: [{ shape: { frets: ['x', 0, 2, 0, 2, 0], fingers: [null, null, 1, null, 2, null] } }],
  },
  {
    id: 'D7', name: 'D7', category: 'sevenths-open', difficulty: 3, importance: 6,
    info: 'Dominant 7th on the top strings; common turnaround chord.',
    fingerings: [{ shape: { frets: ['x', 'x', 0, 2, 1, 2], fingers: [null, null, null, 2, 1, 3] } }],
  },
  {
    id: 'E7', name: 'E7', category: 'sevenths-open', difficulty: 2, importance: 6,
    info: 'Gritty dominant 7th; a blues staple in the key of E.',
    fingerings: [{ shape: { frets: [0, 2, 0, 1, 0, 0], fingers: [null, 2, null, 1, null, null] } }],
  },
  {
    id: 'G7', name: 'G7', category: 'sevenths-open', difficulty: 3, importance: 6,
    info: 'Dominant 7th that pulls strongly toward C.',
    fingerings: [{ shape: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, null, null, null, 1] } }],
  },
  {
    id: 'Cmaj7', name: 'Cmaj7', category: 'sevenths-open', difficulty: 2, importance: 5,
    info: 'Soft, dreamy major 7th. Just lift a finger off the open C shape.',
    fingerings: [{ shape: { frets: ['x', 3, 2, 0, 0, 0], fingers: [null, 3, 2, null, null, null] } }],
  },
  {
    id: 'Am7', name: 'Am7', category: 'sevenths-open', difficulty: 2, importance: 6,
    info: 'Mellow minor 7th; a relaxed version of Am.',
    fingerings: [{ shape: { frets: ['x', 0, 2, 0, 1, 0], fingers: [null, null, 2, null, 1, null] } }],
  },
  {
    id: 'Dm7', name: 'Dm7', category: 'sevenths-open', difficulty: 4, importance: 5,
    info: 'Smooth minor 7th on the top strings; common in jazz and soul.',
    fingerings: [
      {
        shape: {
          frets: ['x', 'x', 0, 2, 1, 1], fingers: [null, null, null, 2, 1, 1],
          barre: { fromIndex: 4, toIndex: 5, fret: 1 },
        },
      },
    ],
  },
  {
    id: 'Em7', name: 'Em7', category: 'sevenths-open', difficulty: 1, importance: 6,
    info: 'An even easier Em — one finger. Warm, open minor 7th.',
    fingerings: [{ shape: { frets: [0, 2, 0, 0, 0, 0], fingers: [null, 2, null, null, null, null] } }],
  },
  {
    id: 'B7', name: 'B7', category: 'sevenths-open', difficulty: 5, importance: 6,
    info: 'Four-finger dominant 7th; the V chord of the E-blues. The only chord here that reaches a B — the change B↔E is 15th most common in the catalog.',
    fingerings: [{ shape: { frets: ['x', 2, 1, 2, 0, 2], fingers: [null, 2, 1, 3, null, 4] } }],
  },
];

export function libraryChordById(id: string): LibraryChord | undefined {
  return CHORD_LIBRARY.find(c => c.id === id);
}

export function libraryChordsByCategory(category: ChordCategoryId): LibraryChord[] {
  return CHORD_LIBRARY.filter(c => c.category === category);
}

// The default (most popular) shape for a library chord.
export function libraryPrimaryShape(chord: LibraryChord) {
  return chord.fingerings[0].shape;
}

// Turn a library chord into a fresh repertoire `Chord`, honoring the user's saved
// fingering choice (clamped; falls back to the primary shape). Returns null for an
// unknown id. Single source of truth for the "add a library chord" call sites, which
// otherwise each re-spread the same fields — miss one and a chord loses its category
// or difficulty. `learnedAt` is stamped at call time.
export function materializeLibraryChord(id: string, fingeringIdx = 0): Chord | null {
  const lib = libraryChordById(id);
  if (!lib) return null;
  const idx = Math.min(Math.max(fingeringIdx, 0), lib.fingerings.length - 1);
  return {
    id: lib.id, name: lib.name, shape: lib.fingerings[idx].shape,
    category: lib.category, difficulty: lib.difficulty, importance: lib.importance,
    info: lib.info, learnedAt: Date.now(), perfectReps: 0,
  };
}

// ── Double-check: fail loudly if any fingering is inconsistent or mis-voiced ──
// Runs once at module load. In dev this throws so a bad fingering can never reach
// a learner; in production it logs (so the app still boots) but the error is visible.
const _issues = validateLibrary(CHORD_LIBRARY);
if (_issues.length > 0) {
  const report = 'chordLibrary validation FAILED:\n' +
    _issues.map(i => `  • ${i.chordId}: ${i.message}`).join('\n');
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) throw new Error(report);
  // eslint-disable-next-line no-console
  console.error(report);
}
