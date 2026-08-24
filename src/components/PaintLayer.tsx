// The brushed shapes bleeding behind the whole app — the balfolk-flyer ground.
//
// Every form is guitar-derived rather than a generic blob: a soundhole rosette,
// six strings sweeping the page, a fret ladder, plectrums, a headstock curve.
//
// The gouache edge comes from the PATH GEOMETRY (hand-wobbled beziers) plus one
// cheap blur — deliberately NOT from feTurbulence + feDisplacementMap. Those
// look marginally better and cost enormously more: with them in the tree,
// rasterising /chords (20+ chord diagrams) took over 30s, while layout and
// scripting stayed at ~1ms. Painterly is a shape problem here, not a filter one.
//
// Fixed, aria-hidden and pointer-events:none — texture, never content.
// Rendered ONCE, by App. A second instance would double the paint density.

const PAINTS = {
  terracotta: '#c4643c',
  ochre: '#c9992b',
  sage: '#6e8b62',
  teal: '#35706e',
  plum: '#7a4b63',
  indigo: '#3c4a7a',
};

// Irregular closed beziers — no two edges parallel, so they read as brushed.
const WASHES: { d: string; fill: string; opacity: number }[] = [
  { d: 'M-60,-90 C120,-120 312,4 336,92 C360,178 296,240 184,252 C74,264 -34,212 -86,140 Z',
    fill: PAINTS.terracotta, opacity: 0.15 },
  { d: 'M756,-90 C884,-112 1036,-34 1062,62 C1088,148 1018,200 918,188 C816,176 740,118 734,42 Z',
    fill: PAINTS.teal, opacity: 0.12 },
  { d: 'M182,602 C346,550 622,554 802,608 C906,640 902,732 778,754 C596,788 298,782 188,738 C104,704 104,626 182,602 Z',
    fill: PAINTS.ochre, opacity: 0.12 },
  { d: 'M-126,468 C-18,436 112,488 142,572 C172,656 94,730 -14,736 C-116,742 -186,674 -180,580 C-176,512 -170,484 -126,468 Z',
    fill: PAINTS.sage, opacity: 0.13 },
  { d: 'M796,466 C900,436 1024,484 1046,554 C1068,626 998,678 906,670 C816,662 758,608 764,538 Z',
    fill: PAINTS.plum, opacity: 0.10 },
];

// A rounded triangle — the plectrum, the app's one repeated motif.
const PICK = 'M-58,-30 C-52,-58 -26,-66 0,-66 C26,-66 52,-58 58,-30 C64,-4 28,46 8,64 C3,68 -3,68 -8,64 C-28,46 -64,-4 -58,-30 Z';

export function PaintLayer() {
  return (
    <div className="paint-layer" aria-hidden="true">
      <svg viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="pl-soft" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        <g filter="url(#pl-soft)">
          {WASHES.map((w, i) => <path key={i} d={w.d} fill={w.fill} opacity={w.opacity} />)}
        </g>

        {/* Line-work stays crisp — the flyers are flat ink plus drawn marks. */}
        <g fill="none" strokeLinecap="round">
          {/* Soundhole rosette, top right. */}
          <g transform="translate(852 148)" stroke={PAINTS.teal} opacity="0.28">
            <circle r="104" strokeWidth="11" />
            <circle r="80" strokeWidth="3" />
            <circle r="70" strokeWidth="3" />
            <circle r="52" strokeWidth="24" opacity="0.5" />
          </g>

          {/* Six strings sweeping the whole page — the app is a fretboard. */}
          <g stroke={PAINTS.indigo} opacity="0.15">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <path
                key={i}
                d={`M-40,${168 + i * 15} C 320,${150 + i * 19} 660,${430 + i * 17} 1040,${392 + i * 21}`}
                strokeWidth={0.8 + i * 0.7}
              />
            ))}
          </g>

          {/* Fret ladder, lower left. */}
          <g stroke={PAINTS.plum} opacity="0.20" strokeWidth="7">
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <line key={i} x1={38 + i * 62} y1={470 + i * 26} x2={92 + i * 62} y2={556 + i * 26} />
            ))}
          </g>

          {/* Headstock curve, left edge. */}
          <path d="M-60,300 C 60,262 128,300 150,364 C 168,418 128,468 66,470"
                stroke={PAINTS.sage} strokeWidth="16" opacity="0.18" />
        </g>

        <path d={PICK} transform="translate(742 612) rotate(-24) scale(1.5)"
              fill={PAINTS.terracotta} opacity="0.16" />
        <path d={PICK} transform="translate(196 196) rotate(18) scale(0.62)"
              fill={PAINTS.ochre} opacity="0.20" />
      </svg>
    </div>
  );
}
