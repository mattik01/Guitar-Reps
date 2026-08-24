import { useEffect, useRef } from 'react';
import type { ListenerState } from '../audio/chordListener';

// A live log-frequency spectrum with the high-pass / low-pass cutoffs drawn on
// top as draggable lines. Lets you SEE your guitar's energy and place the filter
// cutoffs against it (drag a line, watch the band outside it disappear). The
// spectrum is post-filter, so the effect of the cutoffs shows directly.

const FMIN = 40;      // Hz at the left edge (below low-E ≈ 82 Hz)
const FMAX = 8000;    // Hz at the right edge
const DB_MIN = -100;  // floor of the vertical scale
const DB_MAX = -25;   // top of the vertical scale
const H = 96;         // canvas CSS height
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000];

export function FilterSpectrum({ getSpectrum, getSpectrumMeta, state, hp, lp, onChange }: {
  getSpectrum: () => Float32Array;
  getSpectrumMeta: () => { sampleRate: number; fftSize: number };
  state: ListenerState;
  hp: number;
  lp: number;
  onChange: (hp: number, lp: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hpRef = useRef(hp); hpRef.current = hp;
  const lpRef = useRef(lp); lpRef.current = lp;
  const dragRef = useRef<'hp' | 'lp' | null>(null);
  // Per-bin smoothed live trace + a slow min-hold "steady noise floor" trace.
  const smoothRef = useRef<Float32Array | null>(null);
  const floorRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const css = getComputedStyle(canvas);
    const col = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const cAccent = col('--accent', '#c4643c');
    const cInk = col('--ink', '#1b1b1b');
    const cLine = col('--line', '#d9d6cf');
    const cMuted = col('--muted', '#6b6b6b');
    const cGood = col('--good', '#6e8b62');
    const cWarn = col('--warn', '#c9992b');

    let raf = 0;
    const logMin = Math.log(FMIN), logSpan = Math.log(FMAX) - logMin;
    const xOf = (f: number, w: number) => ((Math.log(f) - logMin) / logSpan) * w;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 300;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(H * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, H);

      const curHp = hpRef.current, curLp = lpRef.current;
      // passband tint
      ctx.fillStyle = cGood;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(xOf(curHp, w), 0, xOf(curLp, w) - xOf(curHp, w), H);
      ctx.globalAlpha = 1;

      // frequency gridlines + labels
      ctx.strokeStyle = cLine; ctx.fillStyle = cMuted; ctx.font = '10px system-ui, sans-serif';
      ctx.lineWidth = 1;
      for (const f of GRID_HZ) {
        const x = xOf(f, w);
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, H - 3);
      }

      // spectrum: smoothed live trace (broadband while you play) + a slow
      // min-hold "steady noise floor" (the persistent rumble/hum/hiss you can
      // actually cut). Set the cutoffs against the FLOOR line, not the peaks.
      const spec = getSpectrum();
      const { sampleRate, fftSize } = getSpectrumMeta();
      const n = spec.length;
      if (n > 2 && sampleRate > 0) {
        if (!smoothRef.current || smoothRef.current.length !== n) {
          smoothRef.current = new Float32Array(n).fill(DB_MIN);
          floorRef.current = new Float32Array(n).fill(DB_MIN);
        }
        const sm = smoothRef.current, fl = floorRef.current!;
        for (let b = 0; b < n; b++) {
          // getFloatFrequencyData yields -Infinity for empty bins → clamp to the
          // floor, else the EMA produces NaN and poisons the trace forever.
          const c = spec[b] > DB_MIN ? spec[b] : DB_MIN;
          sm[b] += 0.4 * (c - sm[b]);                        // smoothed live
          // peak envelope: jump up fast toward strum peaks (small delay), settle
          // slowly — what stays elevated after settling is steady noise to cut.
          fl[b] += (c > fl[b] ? 0.6 : 0.008) * (c - fl[b]);
        }
        const yOf = (db: number) => H - Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN))) * H;
        const binOf = (f: number) => Math.round((f * fftSize) / sampleRate);

        // live smoothed area
        ctx.beginPath(); ctx.moveTo(0, H);
        for (let px = 0; px <= w; px++) {
          const b = binOf(Math.exp(logMin + (px / w) * logSpan));
          ctx.lineTo(px, yOf(b > 0 && b < n ? sm[b] : DB_MIN));
        }
        ctx.lineTo(w, H); ctx.closePath();
        ctx.fillStyle = cAccent; ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1;

        // steady noise-floor line
        ctx.beginPath();
        for (let px = 0; px <= w; px++) {
          const b = binOf(Math.exp(logMin + (px / w) * logSpan));
          const y = yOf(b > 0 && b < n ? fl[b] : DB_MIN);
          if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.strokeStyle = cWarn; ctx.lineWidth = 1.5; ctx.stroke();
      }

      // cutoff lines + labels
      const line = (f: number, label: string) => {
        const x = xOf(f, w);
        ctx.strokeStyle = cInk; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.fillStyle = cInk; ctx.beginPath(); ctx.arc(x, 6, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = cInk; ctx.font = 'bold 10px system-ui, sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, Math.min(Math.max(x + 6, 2), w - tw - 2), 14);
      };
      line(curHp, `HP ${curHp}`);
      line(curLp, `LP ${curLp >= 1000 ? (curLp / 1000).toFixed(1) + 'k' : curLp}`);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getSpectrum, getSpectrumMeta, state]);

  // Drag the nearest cutoff line.
  function freqFromClientX(clientX: number): number {
    const canvas = canvasRef.current;
    if (!canvas) return FMIN;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.exp(Math.log(FMIN) + frac * (Math.log(FMAX) - Math.log(FMIN)));
  }
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const logMin = Math.log(FMIN), logSpan = Math.log(FMAX) - logMin;
    const xOf = (f: number) => ((Math.log(f) - logMin) / logSpan) * rect.width;
    const clickX = e.clientX - rect.left;
    dragRef.current = Math.abs(clickX - xOf(hpRef.current)) <= Math.abs(clickX - xOf(lpRef.current)) ? 'hp' : 'lp';
    apply(e.clientX);
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function apply(clientX: number) {
    const f = Math.round(freqFromClientX(clientX));
    if (dragRef.current === 'hp') onChange(Math.max(20, Math.min(300, f)), lpRef.current);
    else if (dragRef.current === 'lp') onChange(hpRef.current, Math.max(2000, Math.min(12000, f)));
  }

  return (
    <canvas
      ref={canvasRef}
      className="filter-spectrum"
      style={{ width: '100%', height: H, touchAction: 'none', cursor: 'ew-resize' }}
      onPointerDown={onPointerDown}
    />
  );
}
