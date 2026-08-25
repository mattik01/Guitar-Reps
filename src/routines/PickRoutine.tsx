import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ChordCard } from '../components/ChordCard';
import { ChordCategorySections } from '../components/ChordCategorySections';
import { RoutineHeader } from '../components/RoutineHeader';
import { PickTab } from '../components/PickTab';
import { PickLedger } from '../components/PickLedger';
import { BpmDial } from '../components/BpmDial';
import { IconCelebrate, IconCollapsed, IconExpanded, IconRandom } from '../components/icons';
import { useChordView } from '../components/ChordView';
import { ProgressionMenu, type MenuProgression } from '../components/ProgressionMenu';
import { CHORD_LIBRARY } from '../data/chordLibrary';
import { CHORD_CATEGORIES } from '../data/chordCategories';
import { cardFromLibrary, resolveChord } from '../data/chordResolve';
import { libraryPrimaryShape } from '../data/chordLibrary';
import { PROGRESSIONS } from '../data/progressions';
import { buildTab, pickExerciseById, supportsShape } from '../data/pickPatterns';
import {
  deletePickProgression, progressionName, read, recordPickAttempt, savePickProgression,
  useFingeringChoice, usePickProgressions, usePickRecords, useRepertoire, useRoutineLog,
  type Chord, type SavedProgression,
} from '../state/store';

// One picking exercise: hold the chord (or play the riff), pick in time with the
// metronome, then say whether you kept pace.
//
// NO MICROPHONE, deliberately. Verifying individual picks is not reliable enough
// to be believed yet (docs/pick-detection.md — a pick's attack transient
// contaminates the analysis window), and an exercise that tells you you played it
// wrong when you didn't is worse than one that asks. So the metronome carries the
// tempo and YOU are the judge, exactly as the quiz's "got it" works. The number
// that means something is the fastest tempo you have played it cleanly — which is
// precisely what reps improve.
//
// The pattern runs once per chord in the progression and moves on without a
// break, so the changes have to happen inside the pulse. A progression is an
// ordered LIST, not a set: the same chord may appear at several positions, which
// is why selecting one adds a position rather than toggling it.

const DEFAULT_BPM = 60;

// No separate "finished" screen: answering the question returns to 'setup' with
// the result shown inline, so nothing on the page jumps when a run ends.
type Phase = 'setup' | 'running' | 'report';

export default function PickRoutine() {
  const { exerciseId = '' } = useParams();
  const exercise = pickExerciseById(exerciseId);

  const [repertoire] = useRepertoire();
  const [fingeringChoice] = useFingeringChoice();
  const [records] = usePickRecords();
  const [savedProgressions, setSavedProgressions] = usePickProgressions();
  const [, setLog] = useRoutineLog();

  // Start on a chord so the screen is never blank: the tab IS the explanation of
  // the exercise, and for a pattern it cannot be drawn until something is held.
  // Your first repertoire chord if you have one, else the library's G.
  const [chordIds, setChordIds] = useState<string[]>(() => {
    const ex = pickExerciseById(exerciseId);
    // A riff has no chord — it is a fixed set of frets, so there is nothing to
    // choose and nothing to draw.
    if (!ex || ex.kind === 'riff') return [];
    const runnable = (id: string) => {
      const lib = CHORD_LIBRARY.find(c => c.id === id);
      const own = read<Chord[]>('reps.repertoire', []).find(c => c.id === id);
      const shape = own?.shape ?? (lib && libraryPrimaryShape(lib));
      return !!shape && supportsShape(ex, shape);
    };
    const mine = read<Chord[]>('reps.repertoire', []).map(c => c.id).find(runnable);
    return [mine ?? CHORD_LIBRARY.find(c => runnable(c.id))?.id ?? 'G'];
  });
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [phase, setPhase] = useState<Phase>('setup');
  const [pos, setPos] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // The tempo AT THE MOMENT OF STOPPING. The dial stays live during a run, so
  // "clean at what?" has to be answered about the tempo you actually finished
  // on, not whatever the dial reads by the time you press an answer.
  const [stoppedBpm, setStoppedBpm] = useState(DEFAULT_BPM);
  const [last, setLast] = useState<{ bpm: number; clean: boolean; record: boolean } | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const chordView = useChordView();
  const [pickerOpen, setPickerOpen] = useState(false);
  // While this is on, clicking a chord APPENDS it to the progression. Off, a
  // click opens the chord view — which is what clicking a chord does everywhere
  // else in the app, so that stays the default.
  const [choosing, setChoosing] = useState(false);
  // Which named progression is currently loaded, '' when the chords came from
  // anywhere else. Kept so the control can show what it is showing.
  const [progressionId, setProgressionId] = useState('');
  // The metronome effect restarts whenever the tempo changes, so the step count
  // cannot live in its closure or every tempo nudge would jump back to slot 1.
  const posRef = useRef(0);

  const isRiff = exercise?.kind === 'riff';
  const record = records[exerciseId];

  const owned = useMemo(() => new Set(repertoire.map(c => c.id)), [repertoire]);

  // The exercise decides which chords it can be run on: Directional pattern #1 reaches five
  // strings up from the lowest, so a chord that sounds fewer simply cannot play
  // it. Filtering here rather than warning later keeps the picker honest.
  const runnable = useMemo(
    () => (exercise
      ? CHORD_LIBRARY.filter(c => supportsShape(exercise, libraryPrimaryShape(c)))
      : []),
    [exercise],
  );
  const runnableIds = useMemo(() => new Set(runnable.map(c => c.id)), [runnable]);

  // Random draws from YOUR chords, not the library: the point is a chord you can
  // already play, and it still has to be one this exercise can run.
  // The card the grid renders first, mirroring ChordCategorySections' own order
  // (category order, then difficulty). Only used to point at it — a browser
  // check asserts it really is the first one on screen.
  const firstCardId = useMemo(() => {
    for (const cat of CHORD_CATEGORIES) {
      const inCat = runnable.filter(c => (c.category ?? 'other') === cat.id);
      if (inCat.length) {
        return [...inCat].sort((a, b) => a.difficulty - b.difficulty)[0].id;
      }
    }
    return null;
  }, [runnable]);

  const randomPool = useMemo(
    () => runnable.filter(c => owned.has(c.id)),
    [runnable, owned],
  );

  // A progression is only offered when EVERY chord in it can run the exercise —
  // a half-playable progression would be worse than not offering it.
  const progressions = useMemo(
    () => PROGRESSIONS.filter(p => p.chordIds.every(id => runnableIds.has(id))),
    [runnableIds],
  );
  const savedRunnable = useMemo<MenuProgression[]>(
    () => savedProgressions.filter(p => p.chordIds.every(id => runnableIds.has(id))),
    [savedProgressions, runnableIds],
  );

  // Worth keeping only if it is a real sequence, is not already kept, and did
  // not just come out of the menu it would be saved back into.
  const alreadySaved = useMemo(
    () => savedProgressions.some(p => p.chordIds.join(',') === chordIds.join(',')),
    [savedProgressions, chordIds],
  );
  const canSave = chordIds.length >= 2 && !progressionId && !alreadySaved;

  const chords = useMemo(
    () => chordIds
      .map(id => resolveChord(id, repertoire, fingeringChoice))
      .filter((c): c is NonNullable<typeof c> => !!c),
    [chordIds, repertoire, fingeringChoice],
  );

  // One pass per chord, laid end to end. A riff ignores the chords entirely and
  // returns a single pass, so nothing downstream branches on the kind.
  const passes = useMemo(
    () => (exercise ? buildTab(exercise, chords.map(c => c.shape)) : []),
    [exercise, chords],
  );
  const flat = useMemo(
    () => passes.flatMap((notes, chordIdx) => notes.map(note => ({ chordIdx, note }))),
    [passes],
  );
  const total = flat.length;
  const current = total ? flat[pos % total] : null;
  const chord = current && !isRiff ? chords[current.chordIdx] : null;
  const lap = total ? Math.floor(pos / total) : 0;

  // The metronome reads the pattern, so the rests have to be readable from it
  // without looking at the tab. It restarts on tempo change only, so the steps
  // cannot live in its closure.
  const flatRef = useRef(flat);
  useEffect(() => { flatRef.current = flat; }, [flat]);

  // The metronome. One click per SLOT, accented every fourth — same shape as
  // StrumRoutine's, kept local because the two count different things (slots in
  // a bar vs picks in a pattern).
  //
  // A rest is a slot too: the pulse must not skip a beat there, or the pattern
  // loses the gap it is teaching. So a rest still sounds — dull and quiet, a
  // low thud under a lowpass — while a slot you actually pick gets the bright
  // click. Same beat grid, two voices: you can hear "pick / don't pick".
  useEffect(() => {
    if (phase !== 'running' || total === 0) return;
    const Ctor = window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctxRef.current = new Ctor();

    const click = (accent: boolean, rest: boolean) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // The accent still lands on a rest — it marks where you are in the bar,
      // which is exactly what you need when there is no note to hear.
      osc.frequency.value = rest
        ? (accent ? 300 : 230)
        : (accent ? 1100 : 800);
      const peak = rest ? 0.09 : 0.28;
      gain.gain.setValueAtTime(0.0001, t);
      // Slower attack + slower decay: no transient, so it reads as damped
      // rather than as a quieter click.
      gain.gain.exponentialRampToValueAtTime(peak, t + (rest ? 0.02 : 0.005));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (rest ? 0.1 : 0.06));
      if (rest) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        osc.connect(lp).connect(gain).connect(ctx.destination);
      } else {
        osc.connect(gain).connect(ctx.destination);
      }
      osc.start(t);
      osc.stop(t + (rest ? 0.14 : 0.08));
    };
    const tick = () => {
      setPos(posRef.current);
      const steps = flatRef.current;
      const step = steps.length ? steps[posRef.current % steps.length] : null;
      click(posRef.current % 4 === 0, step?.note.stringIndex == null);
      posRef.current++;
    };
    tick();
    const id = window.setInterval(tick, 60_000 / bpm);
    return () => {
      window.clearInterval(id);
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, [phase, bpm, total]);

  if (!exercise) return <Navigate to="/routine/pick" replace />;

  function onChordClick(id: string) {
    // With nothing chosen there is nothing else a click could usefully mean, so
    // it selects even outside selection mode — which is what makes the hint on
    // the first card honest rather than pointing at a card that would just open
    // the chord view.
    if (!choosing && chordIds.length > 0) { chordView.open(id); return; }
    setChordIds(prev => [...prev, id]);
    setProgressionId('');   // hand-picked now, not a named progression
  }

  // Entering starts a FRESH progression. Clicking an already-chosen chord adds
  // another position rather than removing it (Am can be the 1st, 2nd and 4th
  // chord), so starting over is the only way to undo — and that has to be one
  // obvious action rather than a hidden one.
  function toggleChoosing() {
    if (choosing) { setChoosing(false); return; }
    setChordIds([]);
    setProgressionId('');
    setChoosing(true);
    setPickerOpen(true);
  }

  function randomChord() {
    if (!randomPool.length) return;
    const pick = randomPool[Math.floor(Math.random() * randomPool.length)];
    setChordIds([pick.id]);
    setProgressionId('');
    setChoosing(false);
  }

  // A progression spells repeats out literally (blues-E is E,E,E,E,A,A,…), but a
  // pass per chord already repeats the pattern — so four identical E passes would
  // be padding. Collapse consecutive duplicates.
  function loadProgression(p: MenuProgression) {
    // Collapse consecutive duplicates: a progression spells repeats out
    // literally (blues-E is E,E,E,E,A,A,…) and a pass per chord already repeats
    // the pattern. A hand-saved one has none, so this is a no-op for those.
    setChordIds(p.chordIds.filter((c, i) => c !== p.chordIds[i - 1]));
    setProgressionId(p.id);
    setChoosing(false);
  }

  function saveProgression() {
    savePickProgression(chordIds);
    const all = read<SavedProgression[]>('reps.pickProgressions', []);
    setSavedProgressions(all);
    // Select what was just saved, so the menu reads back what you kept.
    const mine = all.find(p => p.chordIds.join(',') === chordIds.join(','));
    if (mine) setProgressionId(mine.id);
  }

  function removeProgression(id: string) {
    deletePickProgression(id);
    setSavedProgressions(read('reps.pickProgressions', []));
    if (progressionId === id) setProgressionId('');
  }

  function start() {
    posRef.current = 0;
    setPos(0);
    setLast(null);
    setStartedAt(Date.now());
    setPhase('running');
  }

  function stop() {
    setStoppedBpm(bpm);
    setPhase('report');
  }

  // The one judgement the exercise asks for. Both answers are logged — a run with
  // slips is still practice — but only a clean one may raise the best tempo.
  function report(clean: boolean) {
    const at = startedAt ?? Date.now();
    const priorBest = record?.bestCleanBpm ?? 0;
    recordPickAttempt(exerciseId, {
      at, bpm: stoppedBpm, clean, chordIds,
      passes: total ? Math.floor(pos / total) : 0,
    });
    setLog(prev => [...prev, {
      at, kind: 'pick', exerciseId, bpm: stoppedBpm, clean, durationMs: Date.now() - at,
    }]);
    setLast({ bpm: stoppedBpm, clean, record: clean && stoppedBpm > priorBest });
    setStartedAt(null);
    setPhase('setup');
  }

  const running = phase === 'running';
  const shownChord = running ? chord : chords[0] ?? null;
  const allNotes = passes.flat();

  // What is coming, and how far off. The next two chords ride beside the
  // current one so a change never arrives unannounced, and the count says how
  // many picks are left of the pass you are in.
  const atChordIdx = running && current ? current.chordIdx : 0;
  const upcoming = chords.length > 1
    ? [1, 2, 3].slice(0, chords.length - 1).map(n => chords[(atChordIdx + n) % chords.length])
    : [];
  const passEnd = passes.slice(0, atChordIdx + 1).reduce((n, p) => n + p.length, 0);
  const picksToNext = running ? passEnd - (pos % total) : (passes[atChordIdx]?.length ?? 0);

  return (
    <div>
      <RoutineHeader
        title={exercise.name}
        backLabel="Picking"
        backTo="/routine/pick"
        stats={<>
          {bpm} bpm · best clean <strong>{record?.bestCleanBpm || '—'}</strong>
        </>}
      />

      <div className="card">
        {/* ONE layout for every phase. Starting and stopping must not shuffle
            anything about — so the dial, the button, the diagram, the tab and
            the status line are always in the same places, and only their
            CONTENT changes. */}
        {/* The chord sits above, full width; the tempo sits beside the TAB,
            which is the thing you are reading while you play. A riff has no
            chord, so it gets no fretboard at all — not an empty one. */}
        {!isRiff && (
          <div className="pick-chord">
            {shownChord ? (
              <ChordCard
                variant="bare" size="md"
                chord={{ id: shownChord.id, name: shownChord.name, shape: shownChord.shape }}
                diagram="shape"
                calibration={false}
                highlightString={running && current ? current.note.stringIndex : null}
                // The countdown belongs to THIS chord — how long you stay on it
                // — so it reads beside its name rather than hovering over the
                // one that comes after.
                nameAside={chords.length > 1 ? `${picksToNext}` : undefined}
                meta={chords.length > 1
                  ? `${(running && current ? current.chordIdx : 0) + 1} of ${chords.length}`
                  : undefined}
              />
            ) : <div className="muted">Pick a chord</div>}

            {upcoming.length > 0 && (
              <div className="pick-next">
                {upcoming.map((c, i) => (
                  <div key={`${c.id}-${i}`} className="pick-next-item">
                    <ChordCard
                      variant="bare" size="sm"
                      chord={{ id: c.id, name: c.name, shape: c.shape }}
                      diagram="shape"
                      calibration={false}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="pick-stage">
          <div className="pick-controls">
            {/* Live during the run on purpose: a tempo you cannot adjust while
                playing is a tempo you have to stop to find. */}
            <BpmDial value={bpm} onChange={setBpm} />
            <button
              className={`button big ${phase === 'report' ? '' : 'primary'}`}
              onClick={running ? stop : start}
              disabled={phase === 'report' || total === 0}
              title={phase === 'report' ? 'Answer the question first' : undefined}
            >
              {running ? 'Stop' : 'Start'}
            </button>
          </div>

          <div className="pick-main">
            {/* The whole sequence, always — so the marker simply starts moving
                on Start rather than the tab's contents being swapped out. */}
            <PickTab notes={allNotes} position={running ? pos % total : null}
              ariaLabel={`${exercise.name} tab`} />

            <div className="pick-status">
              {phase === 'report' ? (
                <>
                  <span className="step-title" style={{ margin: 0 }}>
                    Clean at {stoppedBpm} bpm?
                  </span>
                  <button className="button primary" onClick={() => report(true)}
                    title="Every pick on the right string, in time, no stumbles">
                    Kept pace
                  </button>
                  <button className="button" onClick={() => report(false)}
                    title="Logged as practice, but it will not raise your best tempo">
                    Slipped
                  </button>
                </>
              ) : running ? (
                <span className="muted">
                  {(pos % total) + 1}/{total} · pass {lap + 1}
                </span>
              ) : last ? (
                <span className="muted">
                  <strong>{last.bpm}</strong> bpm · {last.clean ? 'kept pace' : 'slipped'}
                  {last.record && <> — new record <IconCelebrate size={14} /></>}
                </span>
              ) : (
                <span className="muted">
                  {!isRiff && `${chordIds.length} chord${chordIds.length === 1 ? '' : 's'} · `}
                  {total} picks
                </span>
              )}
            </div>
          </div>
        </div>

        {!isRiff && (
          <>
            <hr className="rule" />
            <div className="row section-head">
              <button className="picker-toggle" onClick={() => setPickerOpen(o => !o)}
                aria-expanded={pickerOpen}
                title={pickerOpen ? 'Hide the chords' : 'Choose which chords to run this on'}>
                {pickerOpen ? <IconExpanded size={14} /> : <IconCollapsed size={14} />}
                <h3>Chords</h3>
              </button>
              {/* Collapsed, the header still has to say WHAT is selected — the
                  progression is the exercise's other half. */}
              <span className="muted">{chords.map(c => c.name).join(' → ') || 'none'}</span>
              <div className="spacer" />
              <span className="meta">
                {exercise.kind === 'pattern' && exercise.minStrings > 1
                  ? `${exercise.minStrings}+ strings only`
                  : `${runnable.length} chords`}
              </span>
            </div>

            {pickerOpen && (
              <>
                <div className="row picker-controls">
                  <button className="button" onClick={randomChord}
                    disabled={running || randomPool.length === 0}
                    title={randomPool.length
                      ? `One of your ${randomPool.length} chords that can run this`
                      : 'None of your chords can run this exercise yet'}>
                    <IconRandom size={14} /> Random chord
                  </button>
                  <button className={`button btn-choose ${choosing ? 'primary' : ''}`}
                    onClick={toggleChoosing} disabled={running}
                    title={choosing
                      ? 'Stop adding chords'
                      : 'Build a progression by clicking chords in order — the same chord can appear more than once'}>
                    {choosing
                      ? `Done — ${chordIds.length} chord${chordIds.length === 1 ? '' : 's'}`
                      : 'Custom progression'}
                  </button>
                  <ProgressionMenu
                    builtIn={progressions}
                    saved={savedRunnable}
                    value={progressionId}
                    onPick={loadProgression}
                    onDelete={removeProgression}
                    disabled={running}
                  />
                  <button className="button" onClick={saveProgression}
                    disabled={running || !canSave}
                    title={alreadySaved ? 'Already saved'
                      : progressionId ? 'This is already a saved progression'
                      : chordIds.length < 2 ? 'Pick at least two chords to save a progression'
                      : `Save ${progressionName(chordIds)}`}>
                    Save
                  </button>
                </div>

                <ChordCategorySections
                  items={runnable}
                  categoryOf={c => c.category}
                  sortWithin={(a, b) => a.difficulty - b.difficulty}
                  compact
                  gridClassName={`grid dense${choosing ? ' choosing' : ''}`}
                  renderCard={c => {
                    // Every position this chord holds in the progression, so a
                    // chord used three times reads "1 · 3 · 4" rather than
                    // pretending to be a single selection.
                    const at = chordIds
                      .map((id, i) => (id === c.id ? i + 1 : 0))
                      .filter(Boolean);
                    return (
                      <ChordCard
                        key={c.id}
                        chord={cardFromLibrary(c)}
                        diagram="shape"
                        className="compact"
                        calibration={false}
                        selected={at.length > 0}
                        // Greyed back, still clickable: dim means "not in your
                        // repertoire yet", the same thing it means on /chords.
                        dim={!owned.has(c.id)}
                        hint={chordIds.length === 0 && c.id === firstCardId && !running}
                        // Locked mid-run — changing the chords would rebuild the
                        // sequence under the position marker.
                        disabled={running}
                        // On the outline, not in the card: a chord used six
                        // times must not become a taller card than its
                        // neighbours.
                        legend={at.length ? at.join(' · ') : undefined}
                        onClick={() => onChordClick(c.id)}
                        title={at.length
                          ? `${c.name} — chord ${at.join(', ')} of ${chordIds.length}`
                          : choosing
                            ? `Add ${c.name} as chord ${chordIds.length + 1}`
                            : `Open ${c.name}`}
                      />
                    );
                  }}
                />
              </>
            )}
          </>
        )}
      </div>

      <PickLedger record={record} />
    </div>
  );
}
