import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * THE progress bar. One pill that carries its own labels INSIDE it — percentage on
 * the left, the count on the right — so a progress readout costs one slim row and
 * never needs a card, a caption or a separate count line around it.
 *
 * Used for the roadmap total, each roadmap level, and the video list; anything else
 * that measures "x of y done" should use this rather than rolling a bar.
 *
 * Contrast is handled by measurement, not by clipping the text to the fill (which
 * splits a glyph down the middle and reads as a rendering bug): each label turns
 * white once the fill is actually under it, and at tiny percentages the percentage
 * label steps aside to sit just past the fill instead of sitting on its edge.
 */
const PAD = 8; // must match .pbar-labels' horizontal padding in styles.css

export function ProgressBar({
  value, total, unit, right, height = 20, title, tone = 'good',
}: {
  value: number;
  total: number;
  /** Noun for the count, e.g. "steps" / "watched". Omitted → bare "3 / 8". */
  unit?: string;
  /** Replaces the right-hand label entirely (e.g. steps + requirements). */
  right?: ReactNode;
  height?: number;
  title?: string;
  /** 'good' = completion (default). 'accent' = in progress / not a completion metric. */
  tone?: 'good' | 'accent';
}) {
  const pct = total <= 0 ? 0 : Math.round((value / total) * 100);
  const rightLabel = right ?? `${value} / ${total}${unit ? ` ${unit}` : ''}`;

  // Which labels the fill has reached. Measured, because it depends on the bar's
  // rendered width and on how wide each label happens to be.
  const track = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const rightRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState({ leftOnFill: false, rightOnFill: false, leftShift: 0 });

  useLayoutEffect(() => {
    const el = track.current, l = leftRef.current, r = rightRef.current;
    if (!el || !l || !r) return;
    const measure = () => {
      const w = el.clientWidth;
      const filled = (w * pct) / 100;
      // Widths only — never offsets, which our own shift would feed back into.
      const lw = l.offsetWidth, rw = r.offsetWidth;
      const leftOnFill = filled >= PAD + lw;                 // fill fully under it
      const rightOnFill = filled >= w - PAD - rw / 2;        // fill past its centre
      setLayout({
        leftOnFill,
        rightOnFill,
        // Too narrow to sit on: step past the fill rather than straddle its edge.
        leftShift: leftOnFill || filled <= PAD ? 0 : filled + 6 - PAD,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pct, value, total, rightLabel]);

  return (
    <div ref={track} className="pbar" style={{ height }} title={title}
      role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
      aria-label={title}>
      <div className={`pbar-fill ${tone}`} style={{ width: `${pct}%` }} />
      <div className="pbar-labels">
        <span ref={leftRef} className={layout.leftOnFill ? 'on-fill' : ''}
          style={{ marginLeft: layout.leftShift }}>{pct}%</span>
        <span ref={rightRef} className={layout.rightOnFill ? 'on-fill' : ''}>{rightLabel}</span>
      </div>
    </div>
  );
}
