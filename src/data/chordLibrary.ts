import type { Chord } from '../state/store';

type LibraryChord = Omit<Chord, 'learnedAt' | 'perfectReps'>;

export const CHORD_LIBRARY: LibraryChord[] = [
  {
    id: 'Em', name: 'Em', difficulty: 1,
    shape: {
      frets: [0, 2, 2, 0, 0, 0],
      fingers: [null, 2, 3, null, null, null],
    },
  },
  {
    id: 'E', name: 'E', difficulty: 1,
    shape: {
      frets: [0, 2, 2, 1, 0, 0],
      fingers: [null, 2, 3, 'T', null, null],
    },
  },
  {
    id: 'Am', name: 'Am', difficulty: 1,
    shape: {
      frets: ['x', 0, 2, 2, 1, 0],
      fingers: [null, null, 2, 3, 'T', null],
    },
  },
  {
    id: 'A', name: 'A', difficulty: 1,
    shape: {
      frets: ['x', 0, 2, 2, 2, 0],
      fingers: [null, null, 'T', 2, 3, null],
    },
  },
  {
    id: 'D', name: 'D', difficulty: 1,
    shape: {
      frets: ['x', 'x', 0, 2, 3, 2],
      fingers: [null, null, null, 'T', 3, 2],
    },
  },
  {
    id: 'Dm', name: 'Dm', difficulty: 2,
    shape: {
      frets: ['x', 'x', 0, 2, 3, 1],
      fingers: [null, null, null, 2, 3, 'T'],
    },
  },
  {
    id: 'C', name: 'C', difficulty: 2,
    shape: {
      frets: ['x', 3, 2, 0, 1, 0],
      fingers: [null, 3, 2, null, 'T', null],
    },
  },
  {
    id: 'G', name: 'G', difficulty: 2,
    shape: {
      frets: [3, 2, 0, 0, 0, 3],
      fingers: [2, 'T', null, null, null, 3],
    },
  },
  {
    id: 'Fmini', name: 'F (mini)', difficulty: 3,
    shape: {
      frets: ['x', 'x', 3, 2, 1, 1],
      fingers: [null, null, 3, 2, 'T', 'T'],
      barre: { fromIndex: 4, toIndex: 5, fret: 1 },
    },
  },
  {
    id: 'A7', name: 'A7', difficulty: 1,
    shape: {
      frets: ['x', 0, 2, 0, 2, 0],
      fingers: [null, null, 'T', null, 2, null],
    },
  },
  {
    id: 'D7', name: 'D7', difficulty: 2,
    shape: {
      frets: ['x', 'x', 0, 2, 1, 2],
      fingers: [null, null, null, 2, 'T', 3],
    },
  },
  {
    id: 'E7', name: 'E7', difficulty: 1,
    shape: {
      frets: [0, 2, 0, 1, 0, 0],
      fingers: [null, 2, null, 'T', null, null],
    },
  },
  {
    id: 'G7', name: 'G7', difficulty: 2,
    shape: {
      frets: [3, 2, 0, 0, 0, 1],
      fingers: [3, 2, null, null, null, 'T'],
    },
  },
  {
    id: 'Cmaj7', name: 'Cmaj7', difficulty: 1,
    shape: {
      frets: ['x', 3, 2, 0, 0, 0],
      fingers: [null, 3, 2, null, null, null],
    },
  },
  {
    id: 'Am7', name: 'Am7', difficulty: 1,
    shape: {
      frets: ['x', 0, 2, 0, 1, 0],
      fingers: [null, null, 2, null, 'T', null],
    },
  },
  {
    id: 'Dm7', name: 'Dm7', difficulty: 2,
    shape: {
      frets: ['x', 'x', 0, 2, 1, 1],
      fingers: [null, null, null, 2, 'T', 'T'],
      barre: { fromIndex: 4, toIndex: 5, fret: 1 },
    },
  },
  {
    id: 'Em7', name: 'Em7', difficulty: 1,
    shape: {
      frets: [0, 2, 0, 0, 0, 0],
      fingers: [null, 2, null, null, null, null],
    },
  },
  {
    id: 'Bm', name: 'Bm', difficulty: 4,
    shape: {
      frets: ['x', 2, 4, 4, 3, 2],
      fingers: [null, 'T', 3, 4, 2, 'T'],
      barre: { fromIndex: 1, toIndex: 5, fret: 2 },
    },
  },
  {
    id: 'B7', name: 'B7', difficulty: 3,
    shape: {
      frets: ['x', 2, 1, 2, 0, 2],
      fingers: [null, 2, 'T', 3, null, 4],
    },
  },
  {
    id: 'F', name: 'F (barre)', difficulty: 5,
    shape: {
      frets: [1, 3, 3, 2, 1, 1],
      fingers: ['T', 3, 4, 2, 'T', 'T'],
      barre: { fromIndex: 0, toIndex: 5, fret: 1 },
    },
  },
];

export function libraryChordById(id: string): LibraryChord | undefined {
  return CHORD_LIBRARY.find(c => c.id === id);
}
