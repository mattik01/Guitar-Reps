// Thin React lifecycle wrapper around ChordListener.
//
// Only `state`/`error` are React state (they change rarely); level and live
// chroma are exposed as stable getters so meters can poll them from a rAF loop
// without causing any re-renders at analysis rate.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChordListener, type KnockEvent, type ListenerState, type StrumEvent, type TargetInput } from './chordListener';

const EMPTY_CHROMA = new Float32Array(12);
const EMPTY_SPECTRUM = new Float32Array(0);

export function useChordListener(opts: {
  enabled: boolean;
  targets: TargetInput[];
  activationThreshold?: number; // 0..1 Discord-style input gate; 0 = off
  filters?: boolean;            // Tier-1 DSP front-end (high-pass + low-pass)
  filterHpHz?: number;          // tunable high-pass cutoff (default 75)
  filterLpHz?: number;          // tunable low-pass cutoff (default 7000)
  onStrum?: (e: StrumEvent) => void;
  onKnock?: (e: KnockEvent) => void;
  onDoubleKnock?: (e: KnockEvent) => void;
}): {
  state: ListenerState;
  error: string | null;
  getLevel: () => number;
  getLiveChroma: () => Float32Array;
  getSpectrum: () => Float32Array;
  getSpectrumMeta: () => { sampleRate: number; fftSize: number };
} {
  const { enabled, targets } = opts;
  const listenerRef = useRef<ChordListener | null>(null);
  const [state, setState] = useState<ListenerState>('idle');
  const [error, setError] = useState<string | null>(null);

  // Callbacks live in refs so subscriptions stay stable across renders.
  const strumRef = useRef(opts.onStrum);
  const knockRef = useRef(opts.onKnock);
  const doubleKnockRef = useRef(opts.onDoubleKnock);
  strumRef.current = opts.onStrum;
  knockRef.current = opts.onKnock;
  doubleKnockRef.current = opts.onDoubleKnock;

  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  // Activation threshold in a ref so a freshly-started listener picks up the
  // current value without re-running the start effect.
  const minLevelRef = useRef(opts.activationThreshold ?? 0);
  minLevelRef.current = opts.activationThreshold ?? 0;
  const filtersRef = useRef(!!opts.filters);
  filtersRef.current = !!opts.filters;
  const filterHpRef = useRef(opts.filterHpHz ?? 75);
  filterHpRef.current = opts.filterHpHz ?? 75;
  const filterLpRef = useRef(opts.filterLpHz ?? 7000);
  filterLpRef.current = opts.filterLpHz ?? 7000;
  // Re-run the targets effect only when the chord set (or its calibrated
  // thresholds) actually changes.
  const targetsKey = useMemo(
    () => targets.map(t => `${t.id}:${t.matchThreshold ?? ''}:${t.unsureThreshold ?? ''}`).join(' '),
    [targets]
  );

  useEffect(() => {
    if (!enabled) return;
    const listener = new ChordListener();
    listenerRef.current = listener;
    const subs = [
      listener.onStateChange(s => { setState(s); setError(listener.error); }),
      listener.onStrum(e => strumRef.current?.(e)),
      listener.onKnock(e => knockRef.current?.(e)),
      listener.onDoubleKnock(e => doubleKnockRef.current?.(e)),
    ];
    listener.setTargets(targetsRef.current);
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
    listenerRef.current?.setTargets(targetsRef.current);
  }, [targetsKey]);

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
    () => listenerRef.current?.getSpectrumMeta() ?? { sampleRate: 44100, fftSize: 8192 },
    []
  );

  return { state, error, getLevel, getLiveChroma, getSpectrum, getSpectrumMeta };
}
