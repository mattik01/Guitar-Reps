export type StrummingProgression = {
  id: string;
  name: string;
  chordIds: string[];
};

export type StrummingPattern = {
  id: string;
  name: string;
  pattern: string;
};

export const PROGRESSIONS: StrummingProgression[] = [
  { id: 'pop-G', name: 'Pop I–V–vi–IV (G, D, Em, C)', chordIds: ['G', 'D', 'Em', 'C'] },
  { id: '50s-C', name: '50s (C, Am, F, G)', chordIds: ['C', 'Am', 'Fmini', 'G'] },
  { id: 'ballad-Am', name: 'Ballad (Am, F, C, G)', chordIds: ['Am', 'Fmini', 'C', 'G'] },
  { id: 'campfire-C', name: 'Campfire (C, G, Am, F)', chordIds: ['C', 'G', 'Am', 'Fmini'] },
  { id: 'blues-E', name: '12-bar Blues in E', chordIds: ['E','E','E','E','A','A','E','E','B7','A','E','E'] },
  { id: 'two-GC', name: 'Two-chord (G, C)', chordIds: ['G', 'C'] },
  { id: 'two-AmE', name: 'Two-chord (Am, E)', chordIds: ['Am', 'E'] },
];

export const PATTERNS: StrummingPattern[] = [
  { id: 'all-down', name: 'All down — D D D D', pattern: 'D-D-D-D-' },
  { id: 'basic', name: 'Basic — D DU UDU', pattern: 'D-DU-UDU' },
  { id: 'folk', name: 'Folk — D D DU DU', pattern: 'D-D-DU-DU' },
  { id: 'slow', name: 'Slow ballad', pattern: 'D---D-DU' },
  { id: 'offbeat', name: 'Off-beat — UUUU', pattern: '-U-U-U-U' },
];
