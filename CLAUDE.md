# Guitar-Reps — working notes for Claude

Local-first React 18 + Vite SPA. No backend; all state is `localStorage` via
`useLocalStore` (`src/state/store.ts`). See `docs/mic-calibration.md` for the
microphone/calibration architecture and `guitar-roadmap.md` for the practice model.

## Verifying changes

Always run, in order:

```bash
npm run build          # tsc -b && vite build
npm run check:chords   # chord library structure + harmony
npm run check:chroma   # templates + confusable pairs
npm run check:profiles # calibration math, signal contract, calibration gate
npm run check:songs    # progression sections, transitions, playability score
npm run check:roadmap  # per-level hard requirements (owned+calibrated, swap targets, songs)
npm run check:normalize
```

These are plain esbuild→node scripts — no test framework. `check:profiles` is where
pure audio/calibration logic gets asserted; extend it rather than adding a runner.
**Run them from the repo root** (they're npm scripts).

## Driving the app in a real browser

You can and should drive the running app in Chrome to verify UI and behaviour —
don't stop at a type-check.

The `mcp__playwright__*` tools may fail with *"Browser chrome-for-testing is not
installed"* when the MCP's expected Chromium build isn't in `~/.cache/ms-playwright`.
Don't download a new one; drive Playwright directly against the build that IS there:

```bash
ls ~/.cache/ms-playwright/            # find the installed chromium-<build>
# one-time, in the scratchpad (NOT in this repo — playwright is not a dependency here):
cd "$SCRATCHPAD" && npm init -y && npm install playwright
```

```js
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome',
});
```

Start the dev server with `npm run dev` (port 5173) in the background first.

Seed state before asserting anything — the app is empty on first load:

```js
await page.goto('http://localhost:5173/');
await page.evaluate(r => localStorage.setItem('reps.repertoire', JSON.stringify(r)), REP);
await page.goto('http://localhost:5173/repertoire');   // then navigate
```

Useful keys: `reps.repertoire`, `reps.chordProfiles`, `reps.micSettings`,
`reps.swaps`, `reps.fingeringChoice`. Avoid `/browse` and `/songs` in smoke tests
unless you mean it — they pull the ~190 MB catalog.

### Synthetic microphone (testing mic features without a guitar)

Install via `context.addInitScript` BEFORE the first page load:

- `getUserMedia` must return **`dest.stream.clone()` on every call** — the app calls
  `track.stop()` on teardown, which kills a shared stream for the next listener.
- A synthetic strum must sound **≥3 distinct pitch classes** with a **long decay**
  (sustain ≥ 0.25). Short or thin tones are classified as *knocks* and never emit a
  `StrumEvent`. Several detuned harmonics per note works well.
- Space strums ≥ ~600 ms apart (`STRUM_DEBOUNCE_MS`), and wait out
  `QUIZ_ARM_DELAY_MS` (1200 ms) after a quiz question appears.
- Launch with `args: ['--autoplay-policy=no-user-gesture-required']` and
  `permissions: ['microphone']`.
- Counting `getUserMedia` calls is the way to assert the mic *didn't* open (e.g. the
  calibration gate). Remember the counter resets on every page load.

A working harness lives in the session scratchpad (`mic.mjs`, `l2-quiz.mjs`).

**This only proves wiring and direction.** Real guitar + room + mic is the actual
acceptance gate, and only Matteo can run it — hand him a crisp recipe (exact URL,
which toggles, what to play, what to look for) and pause for feedback.

## Conventions

- **One shared component per UI concept**, reused with variant props — never
  per-page duplicates. `ChordCard` is THE way a chord is rendered anywhere (grids,
  pickers, big in-exercise diagrams); cross-cutting features go on it once.
  Build sources with the `cardFrom*` adapters in `src/data/chordResolve.ts`.
- `resolveChord(id, repertoire, fingeringChoice)` is the single "repertoire first,
  else library" lookup. Don't re-inline that precedence.
- `src/audio/signalContract.ts` is the ONLY boundary between the mic engine and
  anything that consumes detection. Callers must not read `StrumEvent` /
  `ChordListener` internals — go through `signalFromStrum` / `checkSignal` /
  `bestOfSignal` so the engine stays swappable.
- Never write to a store during render (`useLocalStore` defers `writeStorage` to a
  microtask for exactly this reason). Clear profiles from event handlers only.
