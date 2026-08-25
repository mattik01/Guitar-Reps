// Thin React lifecycle wrapper around PluckListener — the picking sibling of
// useChordListener, with the same discipline: only `state`/`error` are React
// state, everything at audio rate is a stable getter the caller can poll.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListenerState } from './chordListener';
import { PluckListener, type PluckEvent } from './pluckListener';
import type { PluckCandidate } from './pluck';
import type { ChordShape } from '../state/store';

const EMPTY_CHROMA = new Float32Array(12);
const EMPTY_SPECTRUM = new Float32Array(0);
const NO_CANDIDATES: PluckCandidate[] = [];

export function usePluckListener(opts: {
  enabled: boolean;
  shape: ChordShape | null;    // the chord being held — sets the candidates
  activationThreshold?: number;
  filters?: boolean;
  filterHpHz?: number;
  filterLpHz?: number;
  onPluck?: (e: PluckEvent) => void;
}): {
  state: ListenerState;
  error: string | null;
  getLevel: () => number;
  getLiveChroma: () => Float32Array;
  getSpectrum: () => Float32Array;
  getSpectrumMeta: () => { sampleRate: number; fftSize: number };
  getCandidates: () => PluckCandidate[];
} {
  const { enabled, shape } = opts;
  const listenerRef = useRef<PluckListener | null>(null);
  const [state, setState] = useState<ListenerState>('idle');
  const [error, setError] = useState<string | null>(null);

  const pluckRef = useRef(opts.onPluck);
  pluckRef.current = opts.onPluck;

  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  const minLevelRef = useRef(opts.activationThreshold ?? 0);
  minLevelRef.current = opts.activationThreshold ?? 0;
  const filtersRef = useRef(!!opts.filters);
  filtersRef.current = !!opts.filters;
  const filterHpRef = useRef(opts.filterHpHz ?? 75);
  filterHpRef.current = opts.filterHpHz ?? 75;
  const filterLpRef = useRef(opts.filterLpHz ?? 7000);
  filterLpRef.current = opts.filterLpHz ?? 7000;

  // Only the FRETS decide which pitches sound, so the effect key ignores
  // fingers/barre — re-annotating a fingering must not restart the candidates.
  const shapeKey = useMemo(() => shape?.frets.join(',') ?? '', [shape]);

  useEffect(() => {
    if (!enabled) return;
    const listener = new PluckListener();
    listenerRef.current = listener;
    const subs = [
      listener.onStateChange(s => { setState(s); setError(listener.error); }),
      listener.onPluck(e => pluckRef.current?.(e)),
    ];
    listener.setShape(shapeRef.current);
    listener.setMinLevel(minLevelRef.current);
    listener.setFilterParams(filterHpRef.current, filterLpRef.current);
    listener.setFilters(filtersRef.current);
    void listener.start();
    return () => {
      subs.forEach(unsub => unsub());
      listener.stop();
      listenerRef.current = null;
      setState('idle');
      setError(null);
    };
  }, [enabled]);

  useEffect(() => {
    listenerRef.current?.setShape(shapeRef.current);
  }, [shapeKey]);

  useEffect(() => {
    listenerRef.current?.setMinLevel(opts.activationThreshold ?? 0);
  }, [opts.activationThreshold]);

  useEffect(() => {
    listenerRef.current?.setFilters(!!opts.filters);
  }, [opts.filters]);

  useEffect(() => {
    listenerRef.current?.setFilterParams(opts.filterHpHz ?? 75, opts.filterLpHz ?? 7000);
  }, [opts.filterHpHz, opts.filterLpHz]);

  const getLevel = useCallback(() => listenerRef.current?.getLevel() ?? 0, []);
  const getLiveChroma = useCallback(() => listenerRef.current?.getLiveChroma() ?? EMPTY_CHROMA, []);
  const getSpectrum = useCallback(() => listenerRef.current?.getSpectrum() ?? EMPTY_SPECTRUM, []);
  const getSpectrumMeta = useCallback(
    () => listenerRef.current?.getSpectrumMeta() ?? { sampleRate: 44100, fftSize: 4096 },
    []
  );
  const getCandidates = useCallback(
    () => listenerRef.current?.getCandidates() ?? NO_CANDIDATES,
    []
  );

  return { state, error, getLevel, getLiveChroma, getSpectrum, getSpectrumMeta, getCandidates };
}
