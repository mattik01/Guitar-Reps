import { useEffect, useRef } from 'react';
import type { ListenerState } from '../audio/chordListener';

// Live mic level bar. Polls getLevel() from a rAF loop and mutates the fill
// width directly — zero React re-renders at analysis rate. Doubles as the
// "mic is alive" reassurance in the routines.
export function MicMeter({ getLevel, state, error }: {
  getLevel: () => number;
  state: ListenerState;
  error?: string | null;
}) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state !== 'listening') return;
    let raf = 0;
    const loop = () => {
      if (fillRef.current) fillRef.current.style.width = `${Math.round(getLevel() * 100)}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, getLevel]);

  if (state === 'denied' || state === 'error') {
    return <div className="mic-meter-status muted">🎙 {error ?? 'Microphone unavailable'}</div>;
  }
  if (state === 'starting') {
    return <div className="mic-meter-status muted">🎙 starting…</div>;
  }
  if (state !== 'listening') return null;

  return (
    <div className="mic-meter" title="Microphone level">
      <span aria-hidden>🎙</span>
      <div className="mic-meter-track">
        <div ref={fillRef} className="mic-meter-fill" />
      </div>
    </div>
  );
}
