# Guitar-Reps UI system

The rules this app's screens are held to. Written down because "too big", "not
compact", "redundant" kept being decided per screen and then re-decided. If a
screen breaks a rule here, the screen is wrong — or the rule is, and this file
changes first.

Related: `CLAUDE.md` (component conventions), `docs/mic-calibration.md` (mic
architecture), `guitar-roadmap.md` (practice model).

## 1. Principles

1. **One control per concept per screen.** The sensitivity gate, the calibration
   indicator, the filter cutoffs — each exists exactly once on screen. If a
   shared panel already renders one, the surrounding screen must not render a
   second (this is why `DetectionDetails` is one component, not a per-screen
   variant).
2. **Setup controls hide; play controls show.** The two things you reach for
   *while playing* — the sensitivity gate and the HP/LP filters — sit on the
   surface of `<DetectionDetails>`, which is one row tall. Everything you only
   read (live chroma, similarities, the raw event log, calibration profiles) is
   behind that panel's `🔬` expander.
3. **One large thing per screen.** Exactly one element may use display type — the
   chord name in a quiz, the timer in a swap. Everything else is body scale.
4. **Grids get denser, not wider.** Chord/song collections grow over time; use
   `auto-fill` grids with small tiles, never fixed columns of large cards.
5. **No decorative repetition.** If two screens show the same block (the week
   strip, a swap table), that is a signal to move it, not to copy it.
6. **Instructions are not UI.** A sentence that says what the screen obviously
   does gets deleted. Detail goes in a `title` tooltip.

## 2. Tokens

Defined in `src/styles.css` `:root`. **Use the token, never the number.**

### Spacing — 4px base
| Token | px | Use |
|---|---|---|
| `--s1` | 4  | icon/label gaps |
| `--s2` | 8  | inside a control, dense grid gap |
| `--s3` | 12 | between cards, grid gap |
| `--s4` | 16 | card padding, block separation |
| `--s5` | 24 | between sections |
| `--s6` | 32 | page-level separation (rare) |

### Type scale
| Token | px | Use |
|---|---|---|
| `--fs-xs` | 11 | dense tile meta |
| `--fs-sm` | 12 | `.meta`, chroma labels |
| `--fs-md` | 13 | `.muted` body, log lines |
| `--fs-base` | 15 | body, buttons |
| `--fs-lg` | 17 | `.button.big`, compact section heads |
| `--fs-xl` | 20 | h2 |
| `--fs-2xl` | 26 | h1 |
| `--fs-display` | 60 | the one large thing (rule 3) |

### Radius
`--r-sm` 6 · `--r-md` 10 (controls) · `--r-lg` 12 (cards) · `--r-pill` 999px

### Color
`--bg --panel --ink --muted --accent --accent-ink --line --good --warn`.
Never hardcode a hex in a component. `--good` = calibrated/success,
`--warn` = needs attention, `--accent` = in progress / primary action.

### 2.1 Colour — the Gouache Bal palette

The look is a balfolk flyer: linen paper, six muted-saturated **paints**, drawn
2px outlines (`--bw`), and depth expressed by outline weight rather than shadow.

| Role | Token | Rule |
|---|---|---|
| Ground / paper | `--bg`, `--panel`, `--panel-2` | `--panel-2` is *recessed* — tracks, wells, inactive segments |
| Text | `--ink`, `--muted` | |
| Edges | `--line`, `--line-soft` | `--line-soft` only inside a panel, where 2px would shout |
| **Interactive** | `--accent` (terracotta) | The ONLY colour that means "you can press this" |
| Display type | `--accent-2` (teal) | Headings' big siblings: `.display`, `.timer`, `.stage-display` |
| Semantic | `--good` `--warn` `--bad` | |
| **Identity** | `--paint-*` × 6 | Routine kind, chart series. NEVER a control |
| **Difficulty** | `--level-1` … `--level-8` | The roadmap ramp: chord cards, level cards, level chips |

The `--paint-*` split is the load-bearing rule: **hue means "what kind of thing
is this" or "how far along is it", never "what state is it in" and never "this
is clickable".**

`--level-1 … --level-8` are the roadmap's difficulty RAMP — the same gouache
inks, ordered cool & light → warm → hot → deep → ink, so "harder" reads from
saturation and darkness rather than from a red/green scale. Anything that
belongs to a roadmap level wears its colour: the level cards on `/roadmap`
(`.level-card`, `src/data/roadmapPaint.ts`), the `L3 40` badges in
`TransitionFacts` (`.level-chip`), and every chord card — a chord takes the
level of its category (`src/data/chordPaint.ts`), so a barre chord looks harder
than an open C. `ChordCard` applies the `level-*` class itself, so `--paint` is
readable by anything inside a card (`ChordDiagram` dots and barres already use
it). Ownership, selection and calibration are carried by border weight, the mic
ring and the check — not hue.

Type is split the way the flyers split it: **Fraunces** (`--font-display`, with
`--display-vf` turning the wonk/soft axes on) for headings, chord names and the
one big number; **Work Sans** (`--font-body`) for everything else, because the
12–13px meta text has to stay legible. Never hardcode a font stack.

Texture is `<PaintLayer/>`, rendered exactly once by `App` — guitar-derived
brushed shapes fixed behind the whole app. Its painterly edges come from path
geometry plus one blur, deliberately not from `feTurbulence`/`feDisplacementMap`:
those cost over 30s to rasterise on `/chords` while layout stayed at ~1ms.

## 3. Controls

| Class | Where |
|---|---|
| `.button` | default, everywhere |
| `.button.primary` | the one action a screen wants you to take |
| `.button.big` | that primary action when it's the screen's focus (Reveal, Start) |
| `.button.huge` | full-width; **avoid** — nothing but a tap-target-sized action |
| `.button.small` | inside a dense panel |

A screen has **at most one** primary button. Disabled means `disabled`, not
`opacity: 0.55` on a link that still navigates.

## 4. Layout classes

- `.card` — the panel. Padding `--s4`, radius `--r-lg`.
- `.row` / `.col` / `.spacer` — flex primitives. Headings inside `.row` are
  margin-free automatically; don't inline `margin: 0`.
- `.row.section-head` — a title (+ actions) directly above a grid.
- `.grid` — 4 fixed columns, for full-size cards.
- `.grid.dense` — `auto-fill` tiles, ~104px. Default for collections.
- `.rule` — the horizontal separator inside a card.
- `.mic-strip` — the per-exercise mic switch row.
- `.det` — `<DetectionDetails>`; `.det-bar` is its always-visible row,
  `.det-body` the expanded grid.
- `.mono` — monospace numeric/diagnostic text.

## 5. Density budget

A routine screen must fit its whole interactive part **above the fold at
1440×900** with detection details off. Reference: the quiz question card is
~200px tall — label, chord name, one button, one switch row.

## 6. The routine template

Every exercise screen is built from the same pieces, in this order:

1. `<RoutineHeader>` — leave affordance (`.back-btn`), title, live stats. The
   **only** way out of a routine; no second "finish"/"cancel" button below.
2. A `.card` for setup (pick what to practise) or `.card.stage` for the exercise
   itself: `.step-title` label → one `.stage-display` element → `.stage-actions`
   with one primary button.
3. `<MicPanel>` last — the mic switch row, then `<DetectionDetails>`: one
   sensitivity row, expanding to chroma + events on 🔬.

Chord pickers use `<ChordCategorySections compact gridClassName="grid dense">`
so a chord sits in the same place in every screen it appears.

## 7. Shared components (see also CLAUDE.md)

`ChordCard` is the only way a chord is drawn. `CalibrationMic` is the only
calibration indicator. `ChordCategorySections` is the only chord grouping.
`DetectionDetails` is the only mic diagnostics surface — sensitivity, HP/LP
filters, live-vs-expected chroma and the event log, identical in every exercise,
in `/mic-test` and in the Calibration Studio. `PageHeader`, `Modal`,
`SubTabs`, `Sparkline` likewise. A new per-page variant of any of these is a bug.

## 8. Review checklist

Before calling a screen done:

- [ ] Nothing on it duplicates something on another screen
- [ ] Exactly one display-size element, one primary button
- [ ] Every setup-only control is behind details/Studio
- [ ] Collections use `.grid.dense`
- [ ] No inline `fontSize` / `padding` / `margin` numbers left — tokens or classes
- [ ] Fits the density budget at 1440×900
- [ ] Real-guitar recipe handed over if it touches the mic

## 9. Migration status

Inline style objects are being removed screen by screen, with each screen's
design pass — not in one sweep, so nothing changes before you've reviewed it.

| Screen | Pass done | Inline styles left |
|---|---|---|
| Exercise | ✅ | none |
| Chord quiz | ✅ | few (reveal-phase leftovers) |
| Chord swap | ✅ | a few in the finished/history block |
| Strumming | ✅ | none |
| New chord | ✅ | none |
| Fingerpicking | ✅ (placeholder) | none |
| Chord view | ✅ | few |
| Mic components | ✅ | none of consequence |
| Calibration Studio | ◻ (mic part done) | ~18, all in the capture/test card |
| Chords / Songs / Browse | ⬜ | ~70 |
| Roadmap / Videos | ⬜ | ~70 |
| Editors (chord, song) | ⬜ | ~47 |


## Picking

`PickTab` (`src/components/PickTab.tsx`) is THE way a pick sequence is drawn —
the setup preview and the live run both render it. Standard tab orientation,
**high e on top**: that is the one place here where a real-world convention
outranks internal consistency, and flipping it to match `PickStrip` would make it
wrong to every guitarist who reads it.

`PickStrip` (`src/components/PickStrip.tsx`) is THE six-string display — a
vertical slice of "which string right now". It stays in the Pick Lab, where it is
a ground-truth *input*; the running routine doesn't render it, because the tab's
current column already says which string is next and two of them is decorative
repetition (§1 rule 5).

`LevelSections` (`src/components/LevelSections.tsx`) groups anything by roadmap
level, the sibling of `ChordCategorySections` (which groups chords by *category*,
the category carrying a display level string). Levels with no items don't render,
so a ladder that only reaches L1 shows one heading rather than eight.

"This one, now" is **`--accent-2`** wherever it appears — `PickTab`'s current
column and `ChordDiagram`'s `highlightString` use the same colour on purpose. A
chord's paint would be wrong there: paint is identity (which chord family), not
state. `.kind-chip` (the RIFF badge) is the reverse case — that IS identity, so
it takes a paint.
Strings read low E → high e, matching a chord diagram; the "string 6 … string 1"
numbering would run the other way and put the two views in opposite orders on the
same screen. Per-string highlight inside a diagram is `ChordDiagram`'s
`highlightString`, threaded through `ChordCard`.

Pick direction (down/up) is shown as an arrow and is **never scored** — it is not
recoverable from audio (`docs/pick-detection.md`), so the UI must not imply it is
being checked. That, and every other "why" in this routine, lives in a `title`
tooltip rather than page prose.
