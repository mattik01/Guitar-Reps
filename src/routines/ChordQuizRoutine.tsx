import { useEffect, useMemo, useRef, useState } from 'react';
import { IconAdd, IconKnock, IconMic, IconNo, IconRandom, IconTarget, IconYes } from '../components/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { CalibrationMic } from '../components/CalibrationMic';
import { ChordCard } from '../components/ChordCard';
import { ChordCategorySections } from '../components/ChordCategorySections';
import { useChordView } from '../components/ChordView';
import { cardFromChord } from '../data/chordResolve';
import { ChordEditor } from '../components/ChordEditor';
import { CleanlinessBadge } from '../components/CleanlinessBadge';
import { strumLogDetail, type MicLogEntry } from '../components/detectionLog';
import { MicPanel } from '../components/MicPanel';
import { RoutineHeader } from '../components/RoutineHeader';
import { useChordListener } from '../audio/useChordListener';
import type { KnockEvent, StrumEvent } from '../audio/chordListener';
import { type Cleanliness, type Verdict } from '../audio/chroma';
import { chordTargetFromProfile, shapeKey } from '../audio/calibration';
import { checkSignal, signalFromStrum } from '../audio/signalContract';
import { useCalibrationGate } from '../audio/useCalibrationGate';
import { useChordProfiles, useFingeringChoice, useMicSettings, useRepertoire, useRoutineLog, type Chord, type ChordShape } from '../state/store';
import { libraryChordById, materializeLibraryChord } from '../data/chordLibrary';
import type { ChordCategoryId } from '../data/chordCategories';

type Phase = 'picking' | 'asking' | 'revealed';

// Grace period after a question appears before the mic arms — so the strum that
// answered the PREVIOUS question (or finger-settling noise) can't insta-reveal.
const QUIZ_ARM_DELAY_MS = 1200;
const QUIZ_AUTO_ADVANCE_S = 4;

export default function ChordQuizRoutine() {
  const [repertoire, setRepertoire] = useRepertoire();
  const [, setLog] = useRoutineLog();
  const [params] = useSearchParams();
  const { open: openChordView, openId: openChordId } = useChordView();

  const [chord, setChord] = useState<Chord | null>(null);
  const [phase, setPhase] = useState<Phase>('picking');
  const [asked, setAsked] = useState(0);
  const [gotRight, setGotRight] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // Deep-linked chord id that isn't in the repertoire yet — prompts manual registration.
  const [registerId, setRegisterId] = useState<string | null>(null);
  // The current chord is a library chord being previewed but not yet owned: the
  // reveal offers "Add to repertoire" / "Don't add" instead of Got it / Didn't know.
  const [preview, setPreview] = useState(false);

  // --- microphone auto-reveal ---
  const [fingeringChoice] = useFingeringChoice();
  // Read inside the mount-only deep-link effect without widening its deps.
  const fingeringChoiceRef = useRef(fingeringChoice);
  fingeringChoiceRef.current = fingeringChoice;
  const [micSettings, setMicSettings] = useMicSettings();
  const [profiles] = useChordProfiles();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [strumClean, setStrumClean] = useState<Cleanliness | null>(null);
  const [strumRevealed, setStrumRevealed] = useState(false); // reveal came from a strum
  const [selected, setSelected] = useState<'got' | 'not' | null>(null); // countdown default
  const [countdown, setCountdown] = useState<number | null>(null);
  const [knockFlipped, setKnockFlipped] = useState(false);
  const [debugLog, setDebugLog] = useState<MicLogEntry[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Mic events are ignored while the chord view is open over the quiz — same
  // reason the old in-quiz editor gated them.
  const overlayRef = useRef(false);
  overlayRef.current = openChordId != null;
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;
  const questionShownAtRef = useRef(0);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  // The mic callback lives behind a ref inside useChordListener, so read the
  // current target through a ref rather than closing over a stale render.
  const profileTargetRef = useRef<ReturnType<typeof chordTargetFromProfile> | null>(null);

  useEffect(() => {
    const presetId = params.get('chord');
    if (!presetId || phase !== 'picking') return;
    const c = repertoire.find(r => r.id === presetId);
    if (c) { ask(c); return; }                    // already owned → quiz as normal
    // Honor the user's saved fingering choice, so a deep-linked preview shows the
    // same voicing the Chords page and the Calibration Studio use.
    const lib = materializeLibraryChord(presetId, fingeringChoiceRef.current[presetId] ?? 0);
    if (lib) { ask(lib, true); return; }          // in the library, not owned → preview + offer to add
    setRegisterId(presetId);                       // not in the library at all → register it manually
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register a deep-linked, not-yet-owned chord into the repertoire, then quiz it.
  // If the id happens to be a known library chord, its shape/category prefill the editor.
  function registerAndAsk(value: { name: string; shape: ChordShape; category?: ChordCategoryId }) {
    if (!registerId) return;
    const lib = libraryChordById(registerId);
    const chord: Chord = {
      id: registerId, name: value.name, shape: value.shape,
      category: value.category, difficulty: lib?.difficulty, importance: lib?.importance, info: lib?.info,
      learnedAt: Date.now(), perfectReps: 0,
    };
    setRepertoire(prev => prev.some(c => c.id === chord.id) ? prev : [...prev, chord]);
    setRegisterId(null);
    ask(chord);
  }

  const otherChords = useMemo(() => {
    return repertoire.filter(c => c.id !== chord?.id);
  }, [repertoire, chord]);

  const chordNames = useMemo(() => new Map(repertoire.map(c => [c.id, c.name])), [repertoire]);
  const repertoireGate = useCalibrationGate(repertoire.map(c => c.id));
  const calibratedCount = repertoire.length - repertoireGate.blocking.length;
  const worstChordId = repertoireGate.blocking[0]?.chordId ?? null;
  function pushDebug(entry: MicLogEntry) {
    setDebugLog(prev => [entry, ...prev].slice(0, 80));
  }

  // The listener only ever matches the theoretical template, so it gets a bare
  // target; every verdict is decided caller-side against the LEARNED profile via
  // the signal contract (exactly what the Calibration Studio does).
  const micTargets = useMemo(
    () => (chord ? [{ id: chord.id, shape: chord.shape }] : []),
    [chord]
  );
  const profileTarget = useMemo(
    () => (chord ? chordTargetFromProfile(chord.id, chord.shape, profiles[chord.id]?.samples ?? []) : null),
    [chord, profiles]
  );

  profileTargetRef.current = profileTarget;

  // Calibration gate: auto-reveal needs THIS chord calibrated. Under-calibrated
  // chords don't get a degraded mic — they fall back to the reveal button.
  const gate = useCalibrationGate(
    [chord?.id],
    useMemo(() => (chord ? { [chord.id]: shapeKey(chord.shape) } : {}), [chord])
  );
  const blocked = gate.blocking[0] ?? null;

  // Keep the mic open across the whole quiz session (asking AND revealed —
  // revealed needs it for the double-knock override); events are gated below.
  const micActive = micSettings.enabled && gate.ready && phase !== 'picking' && chord != null;

  function handleStrum(e: StrumEvent) {
    if (micSettings.debug) pushDebug({ at: e.at, kind: 'strum', detail: strumLogDetail(e) });
    if (phaseRef.current !== 'asking' || overlayRef.current) return;
    if (Date.now() - questionShownAtRef.current < QUIZ_ARM_DELAY_MS) return;
    // Judge against the chord's LEARNED reference + calibrated thresholds. The
    // engine's own e.verdict only ever knows the theoretical template.
    const target = profileTargetRef.current;
    if (!target) return;
    const check = checkSignal(signalFromStrum(e), target);
    setStrumClean(e.cleanliness);
    setVerdict(check.verdict);
    setStrumRevealed(true);
    // Preview chords have Add/Don't-add (no Got/Didn't), so skip the auto-advance countdown.
    if (!previewRef.current) {
      setSelected(check.verdict === 'match' ? 'got' : 'not');
      setCountdown(QUIZ_AUTO_ADVANCE_S);
    }
    setPhase('revealed');
  }

  function handleDoubleKnock(e: KnockEvent) {
    if (micSettings.debug) pushDebug({ at: e.at, kind: 'double-knock', detail: 'double knock' });
    if (phaseRef.current !== 'revealed' || overlayRef.current) return;
    // Flip only while the countdown is live; a knock long after is meaningless.
    if (countdownRef.current == null) return;
    setSelected(s => (s === 'got' ? 'not' : 'got'));
    setKnockFlipped(true);
    setCountdown(QUIZ_AUTO_ADVANCE_S); // restart so the flip is visible (and re-flippable)
  }

  const mic = useChordListener({
    enabled: micActive,
    targets: micTargets,
    activationThreshold: micSettings.activationThreshold,
    filters: micSettings.filters,
    filterHpHz: micSettings.filterHpHz,
    filterLpHz: micSettings.filterLpHz,
    onStrum: handleStrum,
    onKnock: e => { if (micSettings.debug) pushDebug({ at: e.at, kind: 'knock', detail: 'percussive onset' }); },
    onDoubleKnock: handleDoubleKnock,
  });

  // Auto-advance countdown: ticks once a second; on expiry fires the
  // pre-selected default. Any button click cancels it by advancing directly.
  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) {
      if (selected === 'got') gotIt(); else didNot();
      return;
    }
    const t = window.setTimeout(() => setCountdown(c => (c == null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  function resetMicQuestionState() {
    setVerdict(null);
    setStrumClean(null);
    setStrumRevealed(false);
    setSelected(null);
    setCountdown(null);
    setKnockFlipped(false);
    questionShownAtRef.current = Date.now();
    setDebugLog([]);
  }

  function ask(c: Chord, isPreview = false) {
    setChord(c);
    setPreview(isPreview);
    setPhase('asking');
    setAsked(a => a + 1);
    resetMicQuestionState();
    if (!startedAt) setStartedAt(Date.now());
  }

  function askRandom() {
    const pool = chord ? otherChords : repertoire;
    const source = pool.length ? pool : repertoire;
    if (source.length === 0) { setChord(null); setPreview(false); setPhase('picking'); return; }
    ask(source[Math.floor(Math.random() * source.length)]);
  }

  // A previewed (unowned) library chord: after the reveal, add it to the repertoire
  // or skip — then carry on quizzing whatever's in the repertoire.
  function addPreviewToRepertoire() {
    if (chord) setRepertoire(prev => prev.some(c => c.id === chord.id) ? prev : [...prev, chord]);
    setPreview(false);
    askRandom();
  }
  function skipPreview() {
    setPreview(false);
    askRandom();
  }

  function reveal() {
    setPhase('revealed');
  }

  function gotIt() {
    if (chord) {
      setRepertoire(prev => prev.map(c =>
        c.id === chord.id ? { ...c, perfectReps: c.perfectReps + 1 } : c
      ));
    }
    setGotRight(g => g + 1);
    askRandom();
  }

  function didNot() {
    askRandom();
  }

  function finish() {
    if (startedAt && asked > 0) {
      setLog(prev => [...prev, {
        at: startedAt,
        kind: 'chord',
        perfectReps: gotRight,
        durationMs: Date.now() - startedAt,
      }]);
    }
    setChord(null);
    setPhase('picking');
    setAsked(0);
    setGotRight(0);
    setStartedAt(null);
    resetMicQuestionState();
  }

  // A deep link asked for a chord that isn't in the repertoire — register it first.
  if (registerId && phase === 'picking') {
    const lib = libraryChordById(registerId);
    return (
      <div>
        <RoutineHeader title="Chord quiz" backLabel="Exercise" backTo="/exercise" />
        <div className="card">
          <p style={{ margin: 0 }}>
            <strong>{registerId}</strong> isn’t in your repertoire yet. Register it — draw the shape
            and pick a category — to quiz yourself on it.
          </p>
        </div>
        <ChordEditor
          title={`Register ${registerId}`}
          initialName={registerId}
          initialShape={lib?.fingerings[0]?.shape}
          withCategory
          initialCategory={lib?.category ?? 'other'}
          saveLabel="Save & quiz"
          onSave={registerAndAsk}
          onCancel={() => setRegisterId(null)}
        />
      </div>
    );
  }

  // Empty-repertoire prompt only when idle — a previewed library chord (phase
  // 'asking'/'revealed') must still show even with nothing else in the repertoire.
  if (repertoire.length === 0 && phase === 'picking') {
    return (
      <div>
        <RoutineHeader title="Chord quiz" backLabel="Exercise" backTo="/exercise" />
        <div className="card">
          <p>Your repertoire is empty. Add a chord first.</p>
          <Link to="/routine/new" className="button primary">Learn a new chord</Link>
        </div>
      </div>
    );
  }

  if (phase === 'picking') {
    return (
      <div>
        <RoutineHeader title="Chord quiz" backLabel="Exercise" backTo="/exercise" />
        <p className="muted">
          You'll see a chord name. Try to play it from memory, then reveal the diagram to check.
        </p>

        <div className="card">
          <div className="row">
            <button className="button primary" onClick={askRandom}>
              <IconRandom /> Random chord
            </button>
          </div>
          <hr className="rule" />
          <div className="row section-head">
            <h3>Or pick a specific chord</h3>
            <div className="spacer" />
            <CalibrationMic
              percent={repertoire.length ? (100 * calibratedCount) / repertoire.length : 0}
              done={repertoireGate.ready}
              // Straight to the chord that needs it most (blocking is worst-first).
              to={worstChordId ? `/calibrate/${encodeURIComponent(worstChordId)}` : '/chords'}
              size={30}
              label={repertoireGate.ready
                ? 'All calibrated'
                : `${repertoireGate.blocking.length} calibration${repertoireGate.blocking.length === 1 ? '' : 's'} left`}
              title={`${calibratedCount} of ${repertoire.length} chords calibrated`}
            />
          </div>
          {/* Same grouping as the library, so a chord sits in the same place
              wherever you meet it. */}
          <ChordCategorySections
            items={repertoire}
            categoryOf={c => c.category}
            sortWithin={(a, b) => (a.difficulty ?? 99) - (b.difficulty ?? 99)}
            compact
            gridClassName="grid dense"
            renderCard={c => (
              // diagram="none" is LOAD-BEARING: this is a memory quiz, so showing
              // the shape here would give away the answer before it's asked.
              <ChordCard
                key={c.id}
                chord={cardFromChord(c)}
                diagram="none"
                className="compact"
                meta={`${c.perfectReps} reps`}
                onClick={() => ask(c)}
              />
            )}
          />
        </div>
      </div>
    );
  }

  if (!chord) return null;

  const owned = repertoire.find(c => c.id === chord.id) ?? null;
  const lib = libraryChordById(chord.id);

  return (
    <div>
      <RoutineHeader
        title="Chord quiz"
        backLabel="Finish"
        onBack={finish}
        backTitle="Leave the quiz and log this session"
        stats={<>Asked <strong>{asked}</strong> · Got <strong>{gotRight}</strong></>}
      />

      <div className="card stage">
        <div className="step-title">Play this chord</div>
        <div className="stage-display">{chord.name}</div>

        {phase === 'asking' ? (
          <>
            {/* Calibration gate: rather than auto-revealing on a chord the app
                can't reliably recognize, say so, offer the fix, and fall back to
                the button (which is always rendered below). */}
            {micSettings.enabled && blocked && chord && (
              <div className="gate-note">
                <div>
                  <IconMic size={13} /> Auto-reveal is off for <strong>{chord.name}</strong> —{' '}
                  {blocked.reason === 'shape-changed'
                    ? 'its shape changed since it was calibrated.'
                    : blocked.score > 0
                      ? `it's only calibrated to ${blocked.score}/100.`
                      : "it isn't calibrated yet."}
                </div>
                <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                  <Link className="button primary" to={`/calibrate/${encodeURIComponent(chord.id)}`}>
                    <IconTarget size={13} /> Calibrate {chord.name}
                  </Link>
                  <span className="muted">
                    {blocked.samplesLeft > 0
                      ? `about ${blocked.samplesLeft} clean strum${blocked.samplesLeft === 1 ? '' : 's'}`
                      : 'recalibrate it'}{' '}· or reveal with the button as usual.
                  </span>
                </div>
              </div>
            )}
            <div className="stage-actions">
              <button className="button primary big" onClick={reveal}>Reveal diagram</button>
            </div>
            {/* The one mic area on this screen: live level + sensitivity (the same
                control the Studio uses) sitting next to the toggles that turn it
                on. The details panel below deliberately does NOT repeat it. */}

          </>
        ) : (
          <>
            {strumRevealed && verdict && (
              <>
                <div className={`verdict-banner ${verdict === 'match' ? 'match' : verdict === 'nomatch' ? 'nomatch' : ''}`}>
                  {verdict === 'match' && <>Sounded right <IconYes size={13} /></>}
                  {verdict === 'unsure' && 'Heard a strum — couldn’t tell. Judge from the diagram.'}
                  {verdict === 'nomatch' && 'Hmm — didn’t quite match'}
                  {knockFlipped && <span className="muted" style={{ fontWeight: 400 }}> · flipped <IconKnock size={12} /></span>}
                </div>
                {strumClean && (
                  <div style={{ marginTop: 2 }}>
                    <CleanlinessBadge clean={strumClean} />
                  </div>
                )}
              </>
            )}
            {/* The same card the Chords grid shows — same meta, and clicking it
                opens the shared chord view (where editing/calibrating live). */}
            <div className="quiz-reveal">
              <ChordCard
                variant="feature"
                size="lg"
                chord={cardFromChord(chord)}
                showName={false}
                meta={owned
                  ? <div>{owned.perfectReps} rep{owned.perfectReps === 1 ? '' : 's'} · yours</div>
                  : lib
                    ? <div>Difficulty {lib.difficulty} · Importance {lib.importance}</div>
                    : undefined}
                onClick={() => { setCountdown(null); openChordView(chord.id); }}
              />
            </div>
            {(preview ? (
              <>
                <div className="muted" style={{ marginBottom: 8 }}>
                  This chord isn’t in your repertoire yet.
                </div>
                <div className="stage-actions">
                  <button className="button big primary" onClick={addPreviewToRepertoire}>
                    <IconAdd /> Add to repertoire
                  </button>
                  <button className="button big" onClick={skipPreview}>
                    Don’t add
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="stage-actions">
                  <button className={`button big ${selected !== 'not' ? 'primary' : ''}`} onClick={gotIt}>
                    <IconYes /> Got it — next{countdown != null && selected === 'got' ? ` (${countdown})` : ''}
                  </button>
                  <button className={`button big ${selected === 'not' ? 'primary' : ''}`} onClick={didNot}>
                    <IconNo /> Didn't know — next{countdown != null && selected === 'not' ? ` (${countdown})` : ''}
                  </button>
                </div>
                {countdown != null && (
                  <p className="muted" style={{ marginTop: 8 }}>
                    knock ×2 on the guitar body (strings muted) to flip
                  </p>
                )}
              </>
            ))}
          </>
        )}
      </div>

      <MicPanel
        mic={mic} micSettings={micSettings} setMicSettings={setMicSettings}
        micLabel="Auto-reveal" active={micActive}
        targets={micTargets} log={debugLog} names={chordNames}
        expectedId={chord?.id}
      />

    </div>
  );
}
