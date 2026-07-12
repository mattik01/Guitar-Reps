// Chord categories, ordered easiest → most advanced, mapped to the 8-level
// guitar-roadmap.md. Membership lives on each chord (chord.category), so a chord
// belongs to exactly one category; use libraryChordsByCategory() to list members.

export type ChordCategoryId =
  | 'open-basic'
  | 'open-colorful'
  | 'power'
  | 'barre'
  | 'sevenths-open'
  | 'sevenths-movable'
  | 'extended'
  | 'altered-dominant'
  | 'advanced-voicings';

export type ChordCategory = {
  id: ChordCategoryId;
  name: string;
  description: string;
  roadmapLevel: string; // ties back to guitar-roadmap.md, e.g. "L1", "L3–5"
};

export const CHORD_CATEGORIES: ChordCategory[] = [
  {
    id: 'open-basic',
    name: 'Open Chords — Major & Minor',
    description: 'The first chords every player learns. Uses open strings, needs little finger strength — the foundation of most songs.',
    roadmapLevel: 'L1',
  },
  {
    id: 'open-colorful',
    name: 'Colorful Open Chords — sus2 / sus4 / add',
    description: 'Still easy open shapes, but with a richer, more interesting sound. Great once the basic open chords feel comfortable.',
    roadmapLevel: 'L2',
  },
  {
    id: 'power',
    name: 'Power Chords — movable 5ths',
    description: 'Two- or three-note movable shapes (root + 5th). The backbone of rock and riff-based playing; easy to fret, slide anywhere.',
    roadmapLevel: 'L1–2',
  },
  {
    id: 'barre',
    name: 'Barre Chords — Major & Minor',
    description: 'Movable E- and A-shape barre chords (the CAGED system). One of the hardest beginner hurdles — unlocks every key across the neck.',
    roadmapLevel: 'L3–5',
  },
  {
    id: 'sevenths-open',
    name: 'Open Seventh Chords — dom7 / maj7 / min7',
    description: 'Four-note chords adding the 7th for a more colorful sound. Open voicings first — essential for blues and the theory behind chords.',
    roadmapLevel: 'L4',
  },
  {
    id: 'sevenths-movable',
    name: 'Movable & Barre Sevenths — across the neck',
    description: 'The same dom7 / maj7 / min7 sounds as movable barre shapes, playable in any key up and down the fretboard.',
    roadmapLevel: 'L5–6',
  },
  {
    id: 'extended',
    name: 'Extended Chords — 6, 9, add9',
    description: 'Chords that stack notes beyond the 7th for lush, modern color. Common in pop, soul, and neo-soul voicings.',
    roadmapLevel: 'L6',
  },
  {
    id: 'altered-dominant',
    name: 'Altered Dominants — 7♭9 / 7♯9 / 7♯5 / 7♭5',
    description: 'Tense, spicy dominant chords built from the altered scale. Used to pull hard toward a resolution in jazz and funk.',
    roadmapLevel: 'L6–7',
  },
  {
    id: 'advanced-voicings',
    name: 'Advanced Voicings — quartal, drop-2, 11 & 13',
    description: 'The advanced toolkit: fourth (quartal) chords, drop-2 voicings, upper extensions (11, 13) and melodic-minor colors.',
    roadmapLevel: 'L8',
  },
];

export function chordCategoryById(id: ChordCategoryId): ChordCategory | undefined {
  return CHORD_CATEGORIES.find(c => c.id === id);
}
