# Raw source data for the song catalog

This directory holds the source dataset(s) used to build the seeded song catalog.
It is **gitignored** (files are large). Download manually, then run `npm run build:catalog`.

## e-chords "Chords and Lyrics Dataset" (current source)

1. Download from Kaggle (free login required):
   https://www.kaggle.com/datasets/eitanbentora/chords-and-lyrics-dataset
2. Unzip and drop the `.csv` here (any filename ending in `.csv`).
3. Build:  `npm run build:catalog`
   - or point at a specific file:  `CATALOG_CSV=data/raw/your.csv npm run build:catalog`

The pipeline auto-detects the title/artist/chords/popularity/genre/lang columns and
extracts only chord tokens that the shared `src/data/chordNormalize.ts` parser recognises.

Output → `public/catalog.sqlite.gz` (what the app downloads) + `public/catalog.meta.json`.
