# Chord Library & Expansion Plan

The **chord library** (`src/data/chordLibrary.ts`, `CHORD_LIBRARY`) is the app's curated
set of "known" guitar chords: each carries a category, difficulty/importance ratings, an
optional info blurb, and one or more **fingerings** (ordered most-popular-first). It is the
single source of truth behind every "learn a chord" surface and the repertoire you build up.

> **Status:** the library is intentionally **small (~20 chords)** right now. This is a
> deliberate starting point, not an oversight — the plan is to **grow it bit by bit** (see
> [Expansion plan](#expansion-plan) below). Nothing is blocked on it.

## What's in it today (20 chords)

| Category | Chords |
|---|---|
| Open — major & minor (`open-basic`) | Em, E, Am, D, A, Dm, C, G |
| Barre (`barre`) | Fmini, F, Bm |
| Open 7ths (`sevenths-open`) | A7, D7, E7, G7, Cmaj7, Am7, Dm7, Em7, B7 |

Categories live in `src/data/chordCategories.ts` (ordered easiest → advanced, mapped to
`guitar-roadmap.md`), and now include an **`other`** catch-all for manually-registered
chords that don't fit a standard bucket.

## Why "sparse library" is visible in the app

Song chords come from the large Chordonomicon-sourced catalog, and **roughly half of all
chord occurrences are harder than the current library covers**. So the gap surfaces in the
UI, by design:

- **Chord chips** (`ChordChips` in `src/components/SongCard.tsx`) render in three tiers:
  - **green** — in your repertoire (or derivable from it at the active match level);
  - **grey dashed** — a library chord you haven't learned yet (click → preview & add);
  - **grey dotted + a `?`** — **not in the library at all** (click → register the shape
    yourself). This tier shrinks automatically as the library grows.
- **Quiz** (`ChordQuizRoutine`): a library-but-unowned chord is quizzed directly, with an
  **Add to repertoire / Don't add** choice after the reveal; a not-in-library chord opens
  the **register-it-yourself** editor first.
- **Swap** (`SwapRoutine`): opens the pair using library shapes as previews, each with an
  in-repertoire toggle; only chords that aren't even in the library must be registered first.

## How playable is the catalog? (data snapshot, 2026-07-15)

Across ~2.85M chord occurrences in the v5 catalog:

- **Playable on guitar?** Effectively **all of them** — the data is sourced from guitar
  chord sheets and the build pipeline only keeps tokens `parseChord` recognizes, so nothing
  piano-only or unplayable survives. Just **24 distinct base triads** / 2,829 exact chords.
- **Easily playable?** About half. **48.4%** of occurrences are the 8 beginner open chords
  (C A G E D Am Em Dm); the rest lean on barre and colour chords:

  | Bucket | Share of occurrences |
  |---|---|
  | 8 beginner open chords | 48.4% |
  | root is a sharp/flat (usually barre) | 17.8% |
  | has an extension digit (7/9/11/13) | 18.7% |
  | slash / inversions | 5.2% |
  | sus | 2.2% |
  | dim / aug | 0.7% |

## Expansion plan

Grow the library gradually. **Priority = how often a still-missing chord appears in the
catalog**, so each addition retires the most `?` chips. Highest-value chords not yet in the
library (share of all occurrences):

| Chord | Share | Notes |
|---|---|---|
| B | 2.8% | barre (A-shape) |
| A♯ / B♭ | 2.4% | barre |
| F♯m | 2.1% | barre (Em-shape) |
| F♯ | 1.8% | barre |
| C♯m | 1.5% | barre |
| G♯ | 1.4% | barre |
| D♯ / E♭ | 1.4% | barre |
| Gm | 1.3% | barre (Am-shape) |
| C♯ | 1.2% | barre |
| Cm | 1.0% | barre (Am-shape) |
| G♯m | 0.9% | barre |
| Fm | 0.8% | barre (Em-shape) |

Almost all of the next tier are **movable barre shapes** — the CAGED E- and A-shapes cover
nearly all of them, so adding the shapes (and letting the runtime transpose) is the highest-
leverage work. After the barre roots, the common **maj7 / 9 / add9** colours are the next
tier down.

## How to add a chord

Append a `LibraryChord` entry in `src/data/chordLibrary.ts` with `id`, `name`, `category`
(a `ChordCategoryId`), `difficulty` (1–10), `importance` (1–10), an optional `info`, and one
or more `fingerings` (each `{ shape, label }`, most-popular first). `validateLibrary` checks
every fingering at module load — it **throws in dev** if a shape is inconsistent or mis-
voiced, so a wrong fingering can never ship. Fingering convention: `frets` low-E→high-E
(`x` = muted, `0` = open, n = absolute fret); `fingers` `1`–`4`/`T` (null = open/muted).
