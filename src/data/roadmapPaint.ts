// Which colour a roadmap level is drawn in.
//
// Unlike chordPaint (colour = family identity, order irrelevant), the roadmap's
// colours are a RAMP: the eight levels run cool & light → warm → hot → deep →
// ink, the way an osu! difficulty spread reads as harder without ever being a
// plain red/green scale. Same gouache inks as --paint-*, ordered rather than
// assigned by family. Values live in styles.css as --level-1 … --level-8.

import { ROADMAP } from './roadmap';

export const LEVEL_ORDER: string[] = ROADMAP.flatMap(p => p.levels.map(l => l.id));

/** 1-based position of a level in the whole roadmap, clamped to the ramp. */
export function levelRank(levelId: string): number {
  const i = LEVEL_ORDER.indexOf(levelId);
  const rank = i < 0 ? 1 : i + 1;
  return Math.min(Math.max(rank, 1), LEVEL_ORDER.length);
}

/** The class that sets --paint for anything belonging to a level (chip, card, badge). */
export function levelClass(levelId: string): string {
  return `level-${levelRank(levelId)}`;
}

/** The class that sets --paint for a level card. */
export function levelPaintClass(levelId: string): string {
  return `level-card ${levelClass(levelId)}`;
}
