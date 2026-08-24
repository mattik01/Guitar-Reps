import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// THE calibration indicator, everywhere: a little microphone inside a progress
// ring that colours with how calibrated the thing is. Used per-chord on
// ChordCard and in aggregate (e.g. "3 calibrations left") wherever a screen
// links into the Calibration Studio — same symbol, same reading.
//
// `asLink` is false when an ancestor is already a <Link>: an <a> inside an <a>
// is invalid HTML and the parser would break React's tree.
export type CalibrationMicProps = {
  percent: number;             // 0-100 ring fill
  done?: boolean;              // full/green regardless of percent rounding
  to?: string;                 // where the button goes (studio / index)
  label?: ReactNode;           // optional text beside the mic
  title?: string;
  ariaLabel?: string;
  size?: number;               // px, default 26
  needs?: boolean;             // pulse: this is blocking an exercise right now
  asLink?: boolean;
};

const R = 10.5;
const CIRC = 2 * Math.PI * R;

export function CalibrationMic({
  percent, done = false, to, label, title, ariaLabel,
  size = 28, needs = false, asLink = true,
}: CalibrationMicProps) {
  const pct = Math.max(0, Math.min(100, percent));
  const tone = done ? 'good' : pct > 0 ? 'partial' : 'warn';
  const cls = `cal-mic ${tone}${label ? ' with-label' : ''}${needs ? ' needs' : ''}`;

  const glyph = (
    <svg className="cal-mic-ring" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r={R} className="cal-mic-track" />
      <circle cx="12" cy="12" r={R} className="cal-mic-fill"
        strokeDasharray={`${(CIRC * pct) / 100} ${CIRC}`}
        transform="rotate(-90 12 12)" />
      <g className="cal-mic-glyph">
        <rect x="9.9" y="5.6" width="4.2" height="7.2" rx="2.1" />
        <path d="M7.9 11.3a4.1 4.1 0 0 0 8.2 0" />
        <path d="M12 15.4v2.7" />
      </g>
    </svg>
  );

  const inner = <>{glyph}{label != null && <span className="cal-mic-label">{label}</span>}</>;

  if (to && asLink) {
    return (
      <Link to={to} className={cls} title={title} aria-label={ariaLabel ?? title}
        // Cards are often role=button; a click on this must not fire the card too.
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >{inner}</Link>
    );
  }
  return <span className={cls} title={title} aria-label={ariaLabel ?? title}>{inner}</span>;
}
