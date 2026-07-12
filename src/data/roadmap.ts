// Structured version of guitar-roadmap.md (source of truth stays the markdown doc).
// Every item `id` is a STABLE slug — it is the localStorage key for a user's
// checkmark + notes, so never renumber or rename an existing id.

export type RoadmapItem = { id: string; text: string };
export type RoadmapLevel = {
  id: string;
  name: string;
  note?: string; // short parenthetical context; not editable
  items: RoadmapItem[];
};
export type RoadmapPhase = {
  id: string;
  name: string;
  blurb: string;
  levels: RoadmapLevel[];
  mistakes: string[]; // reference-only, not checkable
};

export const ROADMAP: RoadmapPhase[] = [
  {
    id: 'beginner',
    name: 'Beginner (Levels 1–3)',
    blurb: 'Overriding priority: just play a lot. Volume and reps matter more than what exactly you practice.',
    levels: [
      {
        id: 'l1',
        name: 'Level 1 — Complete beginner',
        items: [
          { id: 'l1-basics', text: 'Tuning, how to hold the guitar, and how to hold & use the pick' },
          { id: 'l1-single-notes-first', text: 'Learn the string names and single notes (single notes before chords — easier)' },
          { id: 'l1-read-tabs-pick', text: 'Read tabs and chord diagrams' },
          { id: 'l1-open-chords', text: 'Basic minor & major open chords' },
          { id: 'l1-strumming', text: 'Basic strumming' },
          { id: 'l1-simple-songs', text: 'Simple one-riff songs you like' },
        ],
      },
      {
        id: 'l2',
        name: 'Level 2',
        items: [
          { id: 'l2-pentatonic-pos1', text: 'First position of the pentatonic scale' },
          { id: 'l2-12-bar-blues', text: '12-bar blues (rhythm + simple improvisation)' },
          { id: 'l2-sus-chords', text: 'More colorful open chords: sus2, sus4' },
          { id: 'l2-strumming-patterns', text: 'More strumming patterns' },
          { id: 'l2-songs', text: 'Play songs matching your skill level' },
        ],
      },
      {
        id: 'l3',
        name: 'Level 3',
        items: [
          { id: 'l3-fretboard-notes', text: 'Learn & understand the notes of the fretboard (not just memorize — see how it’s connected)' },
          { id: 'l3-pentatonic-5-positions', text: 'All 5 positions of the pentatonic scale, in all keys' },
          { id: 'l3-bar-chords-intro', text: 'Introduction to bar chords (genuinely hard — you don’t suck)' },
          { id: 'l3-rhythm-groove-fills', text: 'Deeper rhythm guitar: combine chords, groove, and fills' },
          { id: 'l3-songs', text: 'Play songs matching your skill level' },
        ],
      },
    ],
    mistakes: [
      'Not being patient — 90% of players quit within their first year. Don’t quit and you’re ahead.',
      'Not enough playing — get in the reps.',
      'Looking for the perfect routine — what you play barely matters; playing does. Play what you enjoy.',
    ],
  },
  {
    id: 'intermediate',
    name: 'Intermediate (Levels 4–6)',
    blurb: 'Where most players plateau and get stuck. Level 4 is a critical foundation — do it in order.',
    levels: [
      {
        id: 'l4',
        name: 'Level 4',
        items: [
          { id: 'l4-major-scale-shapes', text: 'Understand & play the shapes of the major scale (almost all music is built on it)' },
          { id: 'l4-seventh-chords', text: 'Seventh chords' },
          { id: 'l4-technique-fundamentals', text: 'Technique fundamentals: right hand, left hand, alternate picking, legato, fingerpicking' },
          { id: 'l4-improv-fundamentals', text: 'Improvisation & soloing fundamentals — go from scales to musical phrases' },
          { id: 'l4-phrasing', text: 'Tasty phrasing: creative slides and bends' },
        ],
      },
      {
        id: 'l5',
        name: 'Level 5',
        note: 'You’re quite good now — from here, skills can be learned in a more flexible order.',
        items: [
          { id: 'l5-caged-bar-chords', text: 'Major & minor bar chords across the whole neck (e.g. CAGED system)' },
          { id: 'l5-modes', text: 'The 7 modes of the major scale' },
          { id: 'l5-economy-picking', text: 'Economy picking (a game changer)' },
          { id: 'l5-legato-arpeggios', text: 'Deeper legato; seventh arpeggios across the whole neck' },
        ],
      },
      {
        id: 'l6',
        name: 'Level 6',
        items: [
          { id: 'l6-seventh-chords-neck', text: 'Seventh chords across the whole neck' },
          { id: 'l6-extended-chords', text: 'Extended chords: 6, 9, add9' },
          { id: 'l6-altered-scale', text: 'The altered scale (over dominant chords)' },
          { id: 'l6-two-note-arpeggios', text: 'Two-note-per-string arpeggios (useful, not a must)' },
          { id: 'l6-double-stops', text: 'Double stops' },
        ],
      },
    ],
    mistakes: [
      'Not practicing the basics enough — pros know the pentatonic scale super well. Keep getting better at basics.',
      'Not learning basic theory — the two essentials: notes of the fretboard + theory of the major scale.',
      'Not pushing technique — get intentional; add technique exercises. Great technique lets you play anything.',
    ],
  },
  {
    id: 'advanced',
    name: 'Advanced (Levels 7–8)',
    blurb: 'Go deep. Never really "finish" — always new ways to improve.',
    levels: [
      {
        id: 'l7',
        name: 'Level 7',
        items: [
          { id: 'l7-fancier-chords', text: 'Fancier chords' },
          { id: 'l7-non-diatonic-harmony', text: 'Beautiful chord progressions with non-diatonic harmony (beyond the major scale)' },
          { id: 'l7-hybrid-picking', text: 'Hybrid picking' },
          { id: 'l7-extended-arpeggios', text: 'Extended arpeggios (e.g. 9th arpeggios)' },
          { id: 'l7-advanced-pentatonic', text: 'Advanced applications of the pentatonic scale' },
          { id: 'l7-solo-over-changes', text: 'Soloing/improvising over chord changes' },
        ],
      },
      {
        id: 'l8',
        name: 'Level 8',
        items: [
          { id: 'l8-fourth-drop2', text: 'Fourth chords, drop-2 voicings' },
          { id: 'l8-extended-chords', text: 'More extended chords: 11, 13' },
          { id: 'l8-advanced-arpeggios', text: 'Advanced arpeggio use' },
          { id: 'l8-melodic-minor', text: 'Melodic minor and other fancy scales' },
          { id: 'l8-your-goals', text: 'Add whatever fits your goals: songwriting, ear training, etc.' },
        ],
      },
    ],
    mistakes: [
      'Stopping learning. You never finish guitar — keep finding new ways to improve.',
    ],
  },
];

export const PRACTICE_FRAMEWORK = {
  title: 'How to practice: the L-E-C framework',
  intro: 'For anything on the roadmap:',
  steps: [
    { key: 'L', label: 'Lesson', text: 'Find a lesson that explains the concept (blog post, teacher, YouTube). Get the information.' },
    { key: 'E', label: 'Exercise', text: 'Find or create good exercises and actually practice it. Watching ≠ learning.' },
    { key: 'C', label: 'Challenge', text: 'Use the skill in real music (e.g. improvise over a backing track). This is the only thing that ultimately matters.' },
  ],
};

export const ALL_ROADMAP_ITEM_IDS: string[] = ROADMAP.flatMap(p =>
  p.levels.flatMap(l => l.items.map(i => i.id))
);
