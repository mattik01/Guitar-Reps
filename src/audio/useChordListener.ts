// Thin React lifecycle wrapper around ChordListener.
//
// Only `state`/`error` are React state (they change rarely); level and live
// chroma are exposed as stable getters so meters can poll them from a rAF loop
// without causing any re-renders at analysis rate.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChordListener, type KnockEvent, type ListenerState, type StrumEvent, type TargetInput } from './chordListener';

const EMPTY_CHROMA = new Float32Array(12);

export function useChordListener(opts: {
  enabled: boolean;
  targets: TargetInput[];
  onStrum?: (e: StrumEvent) => void;
  onKnock?: (e: KnockEvent) => void;
  onDoubleKnock?: (e: KnockEvent) => void;
}): {
  state: ListenerState;
  error: string | null;
  getLevel: () => number;
  getLiveChroma: () => Float32Array;
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

  const getLevel = useCallback(() => listenerRef.current?.getLevel() ?? 0, []);
  const getLiveChroma = useCallback(() => listenerRef.current?.getLiveChroma() ?? EMPTY_CHROMA, []);

  return { state, error, getLevel, getLiveChroma };
}
