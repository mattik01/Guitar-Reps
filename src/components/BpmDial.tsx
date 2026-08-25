import { useRef, useState } from 'react';
import { IconMetronome } from './icons';

// THE tempo control: a metronome sitting inside a curved slider you can sweep,
// with the number still typeable underneath.
//
// Hand-drawn rather than pulled from npm on purpose. The candidates were checked
// — react-dial-knob ships fixed visual "skins" that would have to be overridden
// away, react-knob-headless is headless (so the arc gets drawn here regardless)
// and adds two transitive deps, react-round-slider pins React 16, rc-slider is
// linear. This repo has five runtime dependencies and a house style; the arc
// maths below is fifteen lines, and the pointer-drag idiom already exists in
// FilterSpectrum.tsx. Buying any of them would cost more than it saved.
//
// Colours follow docs/ui.md §2.1: the filled arc is --accent-2 (the same "this
// is the live value" teal PickTab marks its current column with), and the handle
// is --accent because the handle is the part you press.

const START = 135;   // degrees, measured clockwise from 3 o'clock
const SWEEP = 270;   // a full dial with a gap at the bottom
const R = 34;
const C = 44;        // centre of the 88×88 box

function polar(angleDeg: number, r = R): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arcPath(fromDeg: number, toDeg: number): string {
  const [x1, y1] = polar(fromDeg);
  const [x2, y2] = polar(toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
}

export function BpmDial({ value, onChange, min = 30, max = 200, label = 'BPM' }: {
  value: number;
  onChange: (bpm: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // While typing, the field may hold something not yet a number ("" or "1"), so
  // the text is its own state and only committed when it parses. It is dropped
  // the moment the DIAL sets the value (sweepTo) — otherwise a stale "1" would
  // sit there while the ring sweeps past it.
  const [typed, setTyped] = useState<string | null>(null);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const frac = (clamp(value) - min) / (max - min);
  const angle = START + SWEEP * frac;

  function valueFromPoint(clientX: number, clientY: number): number {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return value;
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Rebase so the track starts at 0 and runs to SWEEP.
    const t = (deg - START + 720) % 360;
    // Past the end of the track, snap to whichever end is nearer rather than
    // wrapping the tempo from 200 straight to 30.
    if (t > SWEEP) return t < SWEEP + (360 - SWEEP) / 2 ? max : min;
    return clamp(Math.round(min + (t / SWEEP) * (max - min)));
  }

  // The dial owns the value again: whatever half-typed text the field is holding
  // is dropped, so the number always reads what the ring is showing — including
  // mid-run, where the tempo stays live.
  function sweepTo(v: number) {
    setTyped(null);
    onChange(v);
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    sweepTo(valueFromPoint(e.clientX, e.clientY));
    const move = (ev: PointerEvent) => sweepTo(valueFromPoint(ev.clientX, ev.clientY));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); sweepTo(clamp(value + step)); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); sweepTo(clamp(value - step)); }
  }

  const [hx, hy] = polar(angle);

  return (
    <div className="bpm-dial">
      <svg
        ref={svgRef} width={88} height={88} viewBox="0 0 88 88"
        role="slider" tabIndex={0}
        aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
        onPointerDown={onPointerDown} onKeyDown={onKeyDown}
      >
        {/* SVG wants a <title> child, not a title attribute. */}
        <title>Drag the ring to set the tempo — arrow keys nudge, shift for ten</title>
        <path d={arcPath(START, START + SWEEP)} className="bpm-track" />
        {frac > 0 && <path d={arcPath(START, angle)} className="bpm-fill" />}
        <circle cx={hx} cy={hy} r={6} className="bpm-handle" />
        <g transform={`translate(${C - 11} ${C - 15})`} className="bpm-glyph">
          <IconMetronome size={22} />
        </g>
      </svg>
      <input
        className="bpm-number" type="number" inputMode="numeric"
        min={min} max={max}
        value={typed ?? value}
        onChange={e => {
          setTyped(e.target.value);
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
        onBlur={() => setTyped(null)}
        aria-label={`${label}, typed`}
      />
    </div>
  );
}
