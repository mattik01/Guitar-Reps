# Hooktheory Trends API — reference notes

Captured for a **possible future feature** (not used by the app today). Hooktheory's
Trends API exposes music-theory *statistics* computed over their **TheoryTab database**
(tens of thousands of user-transcribed songs, analyzed harmonically). It is **NOT a source
of per-song chord sheets** — do not treat it as a catalog. Think of it as a **Markov model
of chord progressions**.

## What the data is

Every TheoryTab song is transcribed in **key-relative Roman numerals / scale degrees**
(`I`, `IV`, `V`, `vi`, …), not absolute chords (`C`, `F`, `Am`). The Trends data aggregates
across all songs to answer: *"given the progression so far, what tends to come next, and how
common is it?"*

## Endpoints (base: `https://api.hooktheory.com/v1/`)

- **Progression node stats** — `GET /trends/nodes?cp=<path>`
  - `cp` = the progression prefix as scale-degree chord IDs, e.g. `cp=4,1` → **IV → I**.
  - Returns the chords that follow, each with: chord symbol (`V`, `vi`, …), a **`probability`**
    (fraction of songs with that prefix where this chord comes next), and a `child_path`
    to drill deeper.
  - Example: after **IV → I**, common next chords ≈ `V`, `vi`, `IV`, `I` (descending probability).
- **Songs for a progression** — `GET /trends/songs?cp=<path>`
  - Returns songs containing the progression, **metadata only**: artist, title, section
    (e.g. "Chorus"), link to the TheoryTab page. Paginated 20/page. **No chords/lyrics returned.**

## Access / constraints

- **Auth:** OAuth2 Bearer token. Obtain via `POST /users/auth` with a Hooktheory account
  username/password → returns an `activkey`/bearer token. HTTPS only.
- **Rate limit:** ~**10 requests / 10 seconds**.
- **License/ToS:** Prohibits **scraping, bulk download, text/data mining, and redistribution**
  of the TheoryTab statistics. → OK for interactive per-query use; **NOT** OK to harvest into
  our local DB or bundle their rankings into this repo.

## Why it's here — the future feature it enables

A **repertoire-aware "common progressions you can play"** feature (self-contained, needs NO API):
1. Store common progressions as **Roman numerals** (`I–V–vi–IV`) — see existing `src/data/progressions.ts`.
2. **Transpose to all 12 keys** (chord math already exists in `src/data/chordNormalize.ts`).
3. **Filter to progressions where every chord is in the user's repertoire** (reuse `knownSetAtLevel` / `isKnown`).
4. Surface as practice material (hook into the existing StrumRoutine); optionally
   "learn one more chord (X) to unlock N more progressions."

Hooktheory would only be an **optional reference** for choosing/ranking which progressions to
include — the headline progressions are public music-theory knowledge anyway:
`I–V–vi–IV` (+ rotations), `I–IV–V`, 12-bar blues, `ii–V–I`, `I–vi–IV–V` (doo-wop), etc.
Because of the redistribution ToS, prefer curating from general knowledge over baking in
Hooktheory's exact statistics.

## Related in-repo
- `src/data/progressions.ts` — current hardcoded progressions + strum patterns (StrumRoutine).
- `src/data/chordNormalize.ts` — chord parsing/transposition primitives to reuse.
- `chord-data-sources.md` — the broader chord-data landscape research (incl. why no API returns bulk song→chords).
