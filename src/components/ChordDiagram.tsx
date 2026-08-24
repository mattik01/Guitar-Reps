import type { ChordShape } from '../state/store';

type Props = {
  shape: ChordShape;
  size?: number;
};

export function ChordDiagram({ shape, size = 120 }: Props) {
  const W = 100;
  const H = 120;
  const baseFret = shape.baseFret ?? 1;
  const stringX = (i: number) => 10 + i * 16;
  const fretY = (n: number) => 30 + n * 16;
  const dotY = (absFret: number) => 30 + (absFret - baseFret + 0.5) * 16;
  const showNut = baseFret === 1;

  const strings = [0, 1, 2, 3, 4, 5];
  const frets = [0, 1, 2, 3, 4, 5];

  return (
    <svg
      viewBox={`0 12 ${W} ${H - 18}`}
      width={size}
      height={(size * (H - 18)) / W}
      role="img"
      aria-label="chord diagram"
      fill="var(--ink)"
    >
      {strings.map(i => (
        <line
          key={`s${i}`}
          x1={stringX(i)} y1={fretY(0)}
          x2={stringX(i)} y2={fretY(5)}
          stroke="var(--ink)" strokeWidth={1}
        />
      ))}
      {frets.map(n => (
        <line
          key={`f${n}`}
          x1={stringX(0)} y1={fretY(n)}
          x2={stringX(5)} y2={fretY(n)}
          stroke="var(--ink)"
          strokeWidth={n === 0 && showNut ? 4 : 1}
        />
      ))}

      {shape.frets.map((f, i) => {
        if (f === 'x') {
          return (
            <text key={`m${i}`} x={stringX(i)} y={20}
              textAnchor="middle" dominantBaseline="central"
              fontSize={11} fontWeight={700}>✕</text>
          );
        }
        if (f === 0) {
          return (
            <circle key={`m${i}`} cx={stringX(i)} cy={20} r={4}
              fill="none" stroke="var(--ink)" strokeWidth={1.3} />
          );
        }
        return null;
      })}

      {shape.barre && (
        <>
          <rect
            x={stringX(shape.barre.fromIndex) - 6}
            y={dotY(shape.barre.fret) - 5}
            width={(shape.barre.toIndex - shape.barre.fromIndex) * 16 + 12}
            height={10}
            rx={5}
            fill="var(--paint, var(--ink))"
          />
          <text
            x={stringX(shape.barre.fromIndex)}
            y={dotY(shape.barre.fret) + 3}
            fontSize={8} fontWeight={700}
            fill="var(--panel)" textAnchor="middle"
          >
            {shape.barre.label ?? shape.fingers[shape.barre.fromIndex] ?? 'T'}
          </text>
        </>
      )}

      {shape.frets.map((f, i) => {
        if (typeof f !== 'number' || f === 0) return null;
        const inBarre =
          shape.barre &&
          shape.barre.fret === f &&
          i >= shape.barre.fromIndex &&
          i <= shape.barre.toIndex;
        if (inBarre) return null;
        return (
          <g key={`d${i}`}>
            <circle cx={stringX(i)} cy={dotY(f)} r={5.5} fill="var(--paint, var(--ink))" />
            {shape.fingers[i] != null && (
              <text
                x={stringX(i)} y={dotY(f) + 3}
                fontSize={8} fontWeight={700}
                fill="var(--panel)" textAnchor="middle"
              >
                {shape.fingers[i]}
              </text>
            )}
          </g>
        );
      })}

      {!showNut && (
        <text
          x={93} y={fretY(0) + 12}
          fontSize={9} fontWeight={700}
          textAnchor="start"
        >
          {baseFret}fr
        </text>
      )}
    </svg>
  );
}
