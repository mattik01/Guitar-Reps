import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';

export type TimerHandle = {
  start: () => void;
  pause: () => void;
  reset: () => void;
};

type Props = {
  seconds: number;
  onComplete?: () => void;
  autoStart?: boolean;
};

export const Timer = forwardRef<TimerHandle, Props>(function Timer(
  { seconds, onComplete, autoStart = false },
  ref
) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(autoStart);
  const endAtRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    start: () => {
      completedRef.current = false;
      endAtRef.current = Date.now() + remaining * 1000;
      setRunning(true);
    },
    pause: () => {
      endAtRef.current = null;
      setRunning(false);
    },
    reset: () => {
      endAtRef.current = null;
      completedRef.current = false;
      setRunning(false);
      setRemaining(seconds);
    },
  }), [remaining, seconds]);

  useEffect(() => {
    if (!running) return;
    if (endAtRef.current === null) endAtRef.current = Date.now() + remaining * 1000;
    const id = setInterval(() => {
      const end = endAtRef.current;
      if (end === null) return;
      const r = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setRemaining(r);
      if (r === 0 && !completedRef.current) {
        completedRef.current = true;
        setRunning(false);
        endAtRef.current = null;
        onComplete?.();
      }
    }, 100);
    return () => clearInterval(id);
  }, [running, onComplete]);

  useEffect(() => {
    if (!running) setRemaining(seconds);
  }, [seconds, running]);

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const low = remaining <= 10;

  return (
    <div className={`timer ${low ? 'low' : ''}`}>
      {mm.toString().padStart(2, '0')}:{ss.toString().padStart(2, '0')}
    </div>
  );
});
