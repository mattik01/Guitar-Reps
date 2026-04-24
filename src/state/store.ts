import { useCallback, useEffect, useState } from 'react';

export type FingerMark = 1 | 2 | 3 | 4 | 'T' | null;

export type ChordShape = {
  frets: (number | 'x')[];
  fingers: FingerMark[];
  baseFret?: number;
  barre?: { fromIndex: number; toIndex: number; fret: number } | null;
};

export type Chord = {
  id: string;
  name: string;
  shape: ChordShape;
  difficulty?: number;
  learnedAt: number;
  perfectReps: number;
};

export type SwapAttempt = { count: number; at: number };

export type SwapRecord = {
  pairKey: string;
  chordA: string;
  chordB: string;
  bestCount: number;
  lastCount: number;
  attempts: number;
  lastAt: number;
  history: SwapAttempt[];
};

export type RoutineKind = 'chord' | 'swap' | 'strum';

export type RoutineLog = {
  at: number;
  kind: RoutineKind;
  chordId?: string;
  pairKey?: string;
  swapCount?: number;
  perfectReps?: number;
  progressionId?: string;
  durationMs?: number;
};

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function read<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return initial;
    return JSON.parse(raw) as T;
  } catch {
    return initial;
  }
}

function writeStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
  listeners.get(key)?.forEach(l => l());
}

function subscribe(key: string, l: Listener) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(l);
  return () => { set!.delete(l); };
}

export function useLocalStore<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => read(key, initial));

  useEffect(() => {
    return subscribe(key, () => setValue(read(key, initial)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      writeStorage(key, next);
      return next;
    });
  }, [key]);

  return [value, set] as const;
}

export type Song = {
  id: string;
  title: string;
  artist: string;
  chords: string[];
  url?: string;
  notes?: string;
  addedAt: number;
};

export const useRepertoire = () => useLocalStore<Chord[]>('reps.repertoire', []);
export const useSwapRecords = () => useLocalStore<Record<string, SwapRecord>>('reps.swaps', {});
export const useRoutineLog = () => useLocalStore<RoutineLog[]>('reps.routineLog', []);
export const useSongs = () => useLocalStore<Song[]>('reps.songs', []);
