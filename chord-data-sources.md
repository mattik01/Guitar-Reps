# Chord Sheet Data Sources — Research Report

*Scope: online platforms with chord charts for songs, prioritizing (1) a usable API and (2) directly downloadable databases. Audio/MP3 excluded. Compiled for sourcing chord data programmatically into a guitar practice/reps app.*

---

## TL;DR — what to actually use

- **No mainstream chord site offers a clean, sanctioned public API for full song chord sheets.** Ultimate Guitar, Chordie, e-chords, Chordify have **no official API**. The APIs that exist (Songsterr, Uberchord, Hooktheory) each return something *other* than a lyric-aligned chord sheet.
- **Your fastest path to real songs + chords + lyrics is a downloadable dataset, not an API.** The **Kaggle "Chords and Lyrics Dataset" (135,783 songs, scraped from e-chords)** is the closest match to what a chord-sheet app needs — but its license is "Unknown" (legal risk for a commercial product).
- **Store everything in ChordPro format.** It's the de-facto open interchange format for chord sheets (inline `[C]` chords aligned to lyrics + metadata for key/capo/tempo + section markup + chord-diagram definitions).
- **For chord *diagrams* (fingerings), don't rely on song APIs** — use a dedicated chord source like the **Uberchord API** or a bundled local chord-shape library.

---

## 1. Live APIs

### Songsterr — open API, no key, but *not* chord sheets
- **Access:** Public/"open" API, **no API key or auth required**, HTTPS. A plain GET (with a browser User-Agent) returns HTTP 200 JSON.
- **⚠️ Endpoint moved:** The old documented endpoint `/a/ra/songs.json?pattern=` is **deprecated (404)**. The current working endpoint is `https://www.songsterr.com/api/songs?pattern=<query>` → JSON array of songs.
- **What you get:** Search metadata only — `songId`, `artistId`, `artist`, `title`, a **`hasChords` boolean**, `hasPlayer`, and a `tracks` array (instrument, tuning as MIDI notes, difficulty, opaque `hash`).
- **The catch:** Songsterr is **multi-track tablature (Guitar Pro-style), not chord sheets.** The search endpoint tells you *whether* chords exist (`hasChords`) but **does not return the chord/tab content** — tracks are referenced by opaque hashes.
- **Terms:** Unofficial/reverse-engineered surface. **No published ToS, rate limits, or licensing grant.** Undocumented and unsanctioned.
- **Verdict:** Good for a **song-search / metadata index**; poor as a chord-content source.

### Uberchord API — individual chord diagrams, not songs
- **Access:** REST, `GET https://api.uberchord.com/v1/chords/{chordName}` → JSON.
- **What you get:** **Chord fingering/diagram data** — each chord has a `strings` pattern of fret numbers per string (high→low), for rendering chord diagrams. Chord names use a "quality + tension" naming pattern.
- **The catch:** Oriented around **single chords and embeddable HTML** widgets, **not** full song chord sheets with lyric-aligned chords.
- **Verdict:** Useful **companion** for rendering chord fingering diagrams; not a song catalog.

### Hooktheory (TheoryTab) API — chord *statistics*, not chord sheets
- **Product:** Hooktheory runs the **TheoryTab Database**, "the largest online database of songs broken down by music theory."
- **Access:** **OAuth2 Bearer token** (obtained via hooktheory.com username/password), HTTPS only. **Rate limit: 10 requests / 10 seconds.**
- **What you get:** The **Trends API** exposes only *statistical* chord-progression data — chord identifiers, Roman-numeral symbols (`I`, `vi`), and next-chord probabilities (query by appending a `cp` child-path param). The `songs` endpoint returns **only metadata** (artist, title, section, link to the TheoryTab page), paginated 20/page — **no actual chord sheet or lyrics**.
- **Terms:** ToS (updated Oct 2025) **explicitly prohibit scraping, bulk download, text/data mining, and redistribution.** Bulk/programmatic access requires an **explicit written data license.** Rate limits enforced; circumvention forbidden.
- **Verdict:** Great for **music-theory / progression suggestions**; cannot supply per-song chord charts.

### Open Chord Charts — AGPL web API, but abandoned
- Free-software project (`open-chord-charts/web-api`): Python **Pyramid + MongoDB** backend serving collaboratively-editable chord charts.
- **License AGPL-3.0** (network-copyleft — source-disclosure obligations if you deploy it).
- **Impractical:** minimal community traction, **no documented endpoints, no schema, no catalog stats, no hosted instance URL**, no data export.

### Ultimate Guitar — **no official API** (scrapers only)
UG has the largest catalog but **offers no sanctioned public API.** Two community scrapers exist, both carrying **ToS/licensing risk** (unauthorized, "educational"):

| Tool | Stack | How it works | Output | Notes |
|---|---|---|---|---|
| **`Pilfer/ultimate-guitar-scraper`** | Go | Reverse-engineered **mobile API** (via Frida/mitmproxy) | Fetch tab by ID, search, saved tabs, export popular, scrape all tabs by artist; **text + HTML + metadata** | No documented auth/rate-limits; no dataset dump |
| **`joncardasis/ultimate-api`** | Python/Flask | Scrapes ultimate-guitar.com | Single `GET /tab?url=<UG tab URL>` → JSON (metadata + tab lines) | ~118★, per-URL only, no auth/rate-limit/license docs |

---

## 2. Downloadable Datasets (recommended route)

### ⭐ Kaggle "Chords and Lyrics Dataset" — closest to a real chord-sheet corpus
- **Size:** **135,783 songs** (rows). **~270 MB CSV.**
- **Content:** Separate fields for **chords+lyrics combined, chords alone, lyrics alone, and tabs**, plus `artist_name`, `song_name`, `lang`, `genres`, `popularity`. **This covers most chord-chart fields you need.**
- **Provenance:** **Scraped from e-chords.com** — effectively a downloadable snapshot of e-chords content.
- **License:** **"Unknown"** — no clear reuse/commercial grant. ⚠️ Legal risk for a shipped product.
- **Verdict:** **Best single source for songs + chords + lyrics.** Ideal for prototyping; resolve licensing before commercial launch.
- `kaggle.com/datasets/eitanbentora/chords-and-lyrics-dataset`

### Chordonomicon — huge, but progressions only (no lyrics/diagrams)
- **Size:** **~666,000 songs.** CSV/Parquet/pickle via Hugging Face (~264 MB).
- **Content:** **Symbolic chord progressions** annotated with **song structure** (intro/verse/chorus/bridge/solo/outro), genre/sub-genre, release date, artist ID, **Spotify song/artist IDs**. Multiple encodings (single-token/triad/tetrad).
- **Missing:** ❌ no lyrics, ❌ no chord alignment, ❌ no fretboard diagrams, ❌ no key, ❌ no capo.
- **License:** **CC-BY-NC-4.0 (non-commercial).** Citation to arXiv:2410.22046 requested.
- **Verdict:** Great for **progression analysis / recommendation**; not playable chord sheets. `huggingface.co/datasets/ailsntua/Chordonomicon`

### ChoCo — research corpus, timed Harte-notation chords
- **Size:** **20,086 JAMS files** (2,283 audio-derived + 17,803 symbolic); 60,263 annotations incl. 20,530 chord + 20,029 tonality annotations; 1.57M chord occurrences. Pop/rock/jazz/classical/folk.
- **Content:** **Timed chord progressions + key/tonality/mode + structure**, in JAMS (JSON); also an **RDF knowledge graph (~30M triples)**. Aggregates **18 existing chord datasets**.
- **License:** Mostly **CC-BY-4.0** (three subsets CC-BY-NC-SA-4.0). Zenodo DOI `10.5281/zenodo.7706751`, `github.com/smashub/choco`.
- **Missing:** ❌ no lyrics, ❌ no diagrams, ❌ no capo. Research corpus, not a live API.

### McGill Billboard — small, gold-standard, CC0
- **Size:** ~**740 distinct songs** (890 annotation slots), sampled from Billboard charts.
- **Content:** **Expert chord annotations + song structure + timing** (`salami_chords.txt`, SALAMI + McGill Billboard). No audio.
- **License:** **CC0** (freely reusable — only citation requested). ✅ cleanest license here.
- **Verdict:** Small but **legally unencumbered** — good for a curated seed set. `ddmal.ca` / `isophonics.net/datasets`

### Others (niche / too small)
- **CASD (Chordify)** — only **50 songs**, JAMS/Harte, **CC-BY-NC-SA-4.0**. Too small; built to study annotator subjectivity (4 annotators/song). `github.com/chordify/CASD`
- **Chordonomicon** also mirrored at `github.com/spyroskantarelis/chordonomicon`.

---

## 3. The storage format: ChordPro

Regardless of source, **normalize into ChordPro** — the open, plain-text, de-facto interchange format for chord sheets:

- **Inline chords aligned to lyrics:** chord names in square brackets `[C]`, `[F]` placed at the exact syllable where the chord sounds.
- **Metadata directives:** `{title}`, `{subtitle}`, `{artist}`, `{composer}`, `{lyricist}`, `{album}`, `{year}`, **`{key}`**, **`{capo}`**, `{tempo}`, `{time}`, `{duration}`, `{copyright}`.
- **Song structure:** paired environment directives `{start_of_verse}`/`{end_of_verse}`, `{start_of_chorus}`, `{start_of_bridge}`, `{start_of_tab}`, `{start_of_grid}` with optional labels.
- **Chord diagrams:** `{define}` / `{chord}` directives embed custom fingering/fret-position data (so ChordPro captures diagrams, not just names).
- **Transpose:** `{transpose}` directive shifts keys programmatically.
- **Current version 6**; extensions `.cho .chopro .chordpro .crd .pro .cpm`.
- **Converters exist:** Fretlist offers a free in-browser **Ultimate Guitar → ChordPro** converter (`fretlist.com/blog/chordpro-complete-guide`).
- Spec: `chordpro.org` — note it's a *format only*; it provides **no dataset or API**.

---

## Recommendation for a practice/reps app

1. **Seed content:** Start from the **Kaggle e-chords dataset (135k songs)** for songs+chords+lyrics; optionally mix in **McGill Billboard (CC0)** for a clean, unquestionably-licensed core.
2. **Normalize** everything into **ChordPro** as your internal schema (gives you key, capo, structure, transpose for free).
3. **Chord diagrams:** render fingerings from the **Uberchord API** or a bundled local chord-shape library (don't depend on song APIs for this).
4. **Song search / metadata:** the unofficial **Songsterr `/api/songs` endpoint** works keyless if you want a live search index.
5. **Progression smarts (later):** **Hooktheory Trends API** or **Chordonomicon** for "what chord comes next" style features.
6. **⚠️ Licensing:** Most large sources are scraped and **Unknown / NonCommercial**. For anything shipped commercially, prefer **CC0/CC-BY** sources (McGill Billboard, most of ChoCo) or secure a written license.

---

### Sources
ChordPro: chordpro.org, en.wikipedia.org/wiki/ChordPro, fretlist.com, onsongapp.com/docs · Songsterr: songsterr.com/a/wa/api, github.com/endel/songsterr-api, ultimate-guitar.com/forum/showthread.php?t=1915290 · Uberchord: api.uberchord.com · Hooktheory: hooktheory.com/api/trends/docs, hooktheory.com/terms · Ultimate Guitar: github.com/Pilfer/ultimate-guitar-scraper, github.com/joncardasis/ultimate-api · Open Chord Charts: github.com/open-chord-charts/web-api · Kaggle: kaggle.com/datasets/eitanbentora/chords-and-lyrics-dataset · Chordonomicon: huggingface.co/datasets/ailsntua/Chordonomicon, arXiv:2410.22046 · ChoCo: nature.com/articles/s41597-023-02410-w, github.com/smashub/choco · McGill Billboard: ddmal.ca, isophonics.net/datasets · CASD: github.com/chordify/CASD

*Report reconstructed from a multi-agent deep-research run: 5 search angles → 21 sources fetched → 98 claims → adversarial 3-vote verification.*
