// Hand-curated supplementary videos from OTHER teachers — NOT part of Justin's
// numbered course series (so they have no chronological `n`). Keyed by roadmap
// item id (or a level id). This file is hand-maintained and is NOT touched by
// scripts/buildRoadmapVideos.py, so additions here survive a data regeneration.
export type ExtraVideo = { id: string; title: string; channel: string };

export const EXTRA_VIDEOS: Record<string, ExtraVideo[]> = {
  // Level 1, bullet 2: "Learn the string names and single notes"
  'l1-single-notes-first': [
    { id: 'sOEHpb2s-F8', title: 'Learn the Guitar String Names', channel: 'Steve Stine' },
    { id: 'MO1YfyFCZu4', title: 'Guitar Note Names Explained in 5 Minutes', channel: 'Andy Guitar' },
    { id: 'kthMOYovnQI', title: 'How to Play Single Notes', channel: 'TrueFire' },
    { id: 'zZSNQK0NmW8', title: '5 Minute Picking Workout for Beginners', channel: 'Andy Guitar' },
    { id: 'SCNlFwCXLWQ', title: 'Exercise to Practice Your Alternate Picking', channel: 'Marty Music' },
  ],
};
