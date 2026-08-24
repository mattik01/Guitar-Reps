import { useEffect, useMemo, useRef, useState } from 'react';
import { IconCelebrate, IconMic, IconNo, IconRandom, IconTarget, IconYes } from '../components/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { ChordCard } from '../components/ChordCard';
import { cardFromChord } from '../data/chordResolve';
import { ChordEditor } from '../components/ChordEditor';
import { CleanlinessBadge } from '../components/CleanlinessBadge';
import { libraryChordById, materializeLibraryChord } from '../data/chordLibrary';
import type { ChordCategoryId } from '../data/chordCategories';
import { strumLogDetail, type MicLogEntry } from '../components/detectionLog';
import { MicPanel } from '../components/MicPanel';
import { RoutineHeader } from '../components/RoutineHeader';
import { TransitionFacts } from '../components/TransitionFacts';
import { normalizeToLevel } from '../data/chordNormalize';
import { stripShape } from '../data/songTransitions';
import { Timer, type TimerHandle } from '../components/Timer';
import { useChordListener } from '../audio/useChordListener';
import type { StrumEvent } from '../audio/chordListener';
import { type Cleanliness } from '../audio/chroma';
import { chordTargetFromProfile, shapeKey } from '../audio/calibration';
import { bestOfSignal, signalFromStrum } from '../audio/signalContract';
import { useCalibrationGate } from '../audio/useCalibrationGate';
import { pairKey, useChordProfiles, useMicSettings, useRepertoire, useRoutineLog, useSwapRecords, type Chord, type ChordShape, type SwapRecord, type SwapAttempt } from '../state/store';
import { Sparkline } from '../components/Sparkline';

type Phase = 'picking' | 'ready' | 'running' | 'entering' | 'finished';

const MAX_HISTORY = 20;

export default function SwapRoutine() {
  const [repertoire, setRepertoire] = useRepertoire();
  const [swaps, setSwaps] = useSwapRecords();
  const [, setLog] = useRoutineLog();
  const [searchParams, setSearchParams] = useSearchParams();
  const deeplinkConsumed = useRef(false);

  const [pair, setPair] = useState<[Chord, Chord] | null>(null);
  const [phase, setPhase] = useState<Phase>('picking');
  // Deep-linked pair whose chords aren't all in the repertoire yet: `pendingPair`
  // holds the target ids, `registerId` the one currently being registered.
  const [pendingPair, setPendingPair] = useState<[string, string] | null>(null);
  const [registerId, setRegisterId] = useState<string | null>(null);
  // Fixed 60s window so a logged count is directly "swaps per minute" — the unit the
  // per-song transition colouring compares against (½ the song's BPM). Not adjustable.
  const seconds = 60;
  const [entered, setEntered] = useState('');
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [priorBest, setPriorBest] = useState<number | null>(null);
  const [flashing, setFlashing] = useState(false);
  const timerRef = useRef<TimerHandle>(null);
  const flashTimeoutRef = useRef<number | null>(null);
  const beepCtxRef = useRef<AudioContext | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- microphone auto-count ---
  const [micSettings, setMicSettings] = useMicSettings();
  const [profiles] = useChordProfiles();
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const detectedSwapsRef = useRef(0);
  const strumsHeardRef = useRef(0);
  // Last chord the classifier was CONFIDENT about; null right after an unsure
  // strum (we assumed alternation, so the current chord is unknown).
  const lastConfidentChordRef = useRef<string | null>(null);
  const [liveSwaps, setLiveSwaps] = useState(0);
  const [hearing, setHearing] = useState<string | null>(null);
  const [lastClean, setLastClean] = useState<Cleanliness | null>(null);
  const [micCounted, setMicCounted] = useState<number | null>(null);
  const [debugLog, setDebugLog] = useState<MicLogEntry[]>([]);

  const chordNames = useMemo(() => new Map(repertoire.map(c => [c.id, c.name])), [repertoire]);
  const owned = useMemo(() => new Set(repertoire.map(c => c.id)), [repertoire]);

  // Add/remove a pair chord from the repertoire in place. Re-adds the exact Chord
  // we already hold (shape, category, reps preserved) rather than re-materializing,
  // so removing then re-adding mid-round is lossless.
  function toggleRepertoire(chord: Chord) {
    setRepertoire(prev =>
      prev.some(c => c.id === chord.id)
        ? prev.filter(c => c.id !== chord.id)
        : [...prev, chord]
    );
  }

  function pushDebug(entry: MicLogEntry) {
    setDebugLog(prev => [entry, ...prev].slice(0, 80));
  }

  const key = pair ? pairKey(pair[0].id, pair[1].id) : null;
  const record = key ? swaps[key] : null;

  const notEnough = repertoire.length < 2;

  // The listener matches the theoretical template only, so it gets bare targets;
  // A-vs-B is decided caller-side by bestOfSignal, which can weigh each chord's
  // LEARNED reference and typicalSim. (typicalSim normalizes the comparison:
  // without it a flatter-template chord like a 7th is structurally outscored by a
  // peakier one even when played equally well.)
  const micTargets = useMemo(
    () => (pair ? pair.map(c => ({ id: c.id, shape: c.shape })) : []),
    [pair]
  );
  const profileTargets = useMemo(
    () => (pair ? pair.map(c => chordTargetFromProfile(c.id, c.shape, profiles[c.id]?.samples ?? [])) : []),
    [pair, profiles]
  );
  const profileTargetsRef = useRef(profileTargets);
  profileTargetsRef.current = profileTargets;

  // Calibration gate: counting needs to tell the two chords APART, so BOTH must
  // be calibrated. If either isn't, the mic stays shut and the round is counted
  // by hand rather than guessed at.
  const gate = useCalibrationGate(
    pair ? [pair[0].id, pair[1].id] : [],
    useMemo(
      () => (pair ? { [pair[0].id]: shapeKey(pair[0].shape), [pair[1].id]: shapeKey(pair[1].shape) } : {}),
      [pair]
    )
  );
  // "the mic is allowed to count this pair" — phase-independent, so the
  // end-of-round prefill can consult the same fact the round ran under.
  const micGated = micSettings.enabled && !!pair && gate.ready;

  // Armed from 'ready' so the permission prompt + level meter appear BEFORE the
  // clock starts (the pick click provides the user gesture for resume()).
  const micActive = micGated && (phase === 'ready' || phase === 'running');

  // The exercise IS the alternation, so what you're expected to play next is
  // whichever of the pair isn't the one just heard. Drives the chroma overlay.
  const expectedNextId = pair ? (hearing === pair[0].name ? pair[1].id : pair[0].id) : undefined;

  // Counting rule: "flip counting with permissive fallback". Counting matters
  // more than classification here — a muddy strum still counts. Classification
  // is only trusted for the one thing it's good at: suppressing confidently
  // IDENTICAL consecutive strums (double-strums of the same chord). Anything
  // unsure is assumed to be the alternation the exercise asks for.
  function handleStrum(e: StrumEvent) {
    // Classify through the signal contract so each chord's learned reference and
    // typicalSim count. With uncalibrated targets bestOfSignal reduces to exactly
    // the engine's own cosine-vs-template ranking, so this is a no-op until a
    // chord is deliberately calibrated.
    const ranking = bestOfSignal(signalFromStrum(e), profileTargetsRef.current);
    const best = ranking.best;
    if (micSettings.debug) {
      // Carry BOTH classifiers while this is bedding in, so a real-guitar round
      // shows where the contract and the engine disagree.
      pushDebug({ at: e.at, kind: 'strum', detail: `${strumLogDetail(e)} · contract=${best ?? '—'}` });
    }
    const name = best ? pair?.find(c => c.id === best)?.name ?? null : null;
    setHearing(name);
    setLastClean(e.cleanliness); // live feedback in ready AND running — never gates
    if (phaseRef.current !== 'running') return;
    strumsHeardRef.current++;
    if (strumsHeardRef.current === 1) {
      lastConfidentChordRef.current = best; // first strum starts the count, isn't a swap
      return;
    }
    if (best && lastConfidentChordRef.current === best) return; // confident repeat — not a swap
    lastConfidentChordRef.current = best; // null when unsure: next confident strum counts
    detectedSwapsRef.current++;
    setLiveSwaps(detectedSwapsRef.current);
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
    onDoubleKnock: e => { if (micSettings.debug) pushDebug({ at: e.at, kind: 'double-knock', detail: 'double knock' }); },
  });

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
      beepCtxRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (phase === 'entering') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [phase]);

  // Resolve a chord id to a full Chord: a repertoire chord if owned, else a library
  // chord materialized as a not-yet-owned preview (the ready screen's per-chord toggle
  // lets you add it any time). null when the id is neither owned nor in the library.
  function resolveChord(id: string): Chord | null {
    return repertoire.find(c => c.id === id) ?? materializeLibraryChord(id);
  }

  // Deep link from a song's chord-change strip: ?a=<id>&b=<id> pre-loads that pair
  // and drops straight to the 'ready' screen. Consumed once, then the params are
  // cleared so navigating back inside the routine doesn't re-trigger it.
  useEffect(() => {
    if (deeplinkConsumed.current) return;
    const aId = searchParams.get('a');
    const bId = searchParams.get('b');
    if (!aId || !bId) return;
    deeplinkConsumed.current = true;
    setSearchParams({}, { replace: true });
    if (aId === bId) return;
    const a = resolveChord(aId);
    const b = resolveChord(bId);
    if (a && b) { setPair([a, b]); setPhase('ready'); resetRoundState(); return; }
    setPendingPair([aId, bId]); // a chord is neither owned nor in the library → register it first
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Drive a deep-linked pair whose chord(s) aren't even in the library: register each
  // by hand in turn, then open the pair (library chords resolve straight to previews).
  useEffect(() => {
    if (!pendingPair) return;
    const [aId, bId] = pendingPair;
    const needsRegister = [aId, bId].find(id => !repertoire.some(c => c.id === id) && !libraryChordById(id));
    if (needsRegister) {
      if (registerId == null) setRegisterId(needsRegister);
      return;
    }
    const a = resolveChord(aId);
    const b = resolveChord(bId);
    if (a && b) {
      setPendingPair(null);
      setRegisterId(null);
      setPair([a, b]);
      setPhase('ready');
      resetRoundState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repertoire, pendingPair]);

  // Save a manually-registered chord to the repertoire; the effect above then
  // advances to the next missing chord or opens the pair. Library ids prefill shape/category.
  function registerChord(value: { name: string; shape: ChordShape; category?: ChordCategoryId }) {
    if (!registerId) return;
    const lib = libraryChordById(registerId);
    const chord: Chord = {
      id: registerId, name: value.name, shape: value.shape,
      category: value.category, difficulty: lib?.difficulty, importance: lib?.importance, info: lib?.info,
      learnedAt: Date.now(), perfectReps: 0,
    };
    setRepertoire(prev => prev.some(c => c.id === chord.id) ? prev : [...prev, chord]);
    setRegisterId(null);
  }

  function cancelRegister() {
    setRegisterId(null);
    setPendingPair(null);
  }

  function pickRandom() {
    if (notEnough) return;
    setPair(randomPair(repertoire));
    setPhase('ready');
    resetRoundState();
  }

  function pickManual(aId: string, bId: string) {
    if (aId === bId) return;
    const a = repertoire.find(c => c.id === aId);
    const b = repertoire.find(c => c.id === bId);
    if (!a || !b) return;
    setPair([a, b]);
    setPhase('ready');
    resetRoundState();
  }

  function resetRoundState() {
    setEntered('');
    setSavedCount(null);
    setPriorBest(null);
    setFlashing(false);
    resetMicCount();
    setMicCounted(null);
  }

  function resetMicCount() {
    detectedSwapsRef.current = 0;
    strumsHeardRef.current = 0;
    lastConfidentChordRef.current = null;
    setLiveSwaps(0);
    setHearing(null);
    setLastClean(null);
    setDebugLog([]);
  }

  function start() {
    if (!pair) return;
    setPriorBest(record?.bestCount ?? null);
    setPhase('running');
    setEntered('');
    setSavedCount(null);
    resetMicCount();
    setMicCounted(null);
    setTimeout(() => timerRef.current?.start(), 0);
  }

  function onTimerComplete() {
    setFlashing(true);
    playEndBeeps();
    if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setFlashing(false), 1600);
    // Prefill with the mic's count when it heard anything — still fully editable.
    // `micCounted` is also what gets recorded next to the saved count, so it is
    // set whenever the mic was counting, agreement or not.
    if (micGated && strumsHeardRef.current > 0) {
      setEntered(String(detectedSwapsRef.current));
      setMicCounted(detectedSwapsRef.current);
    }
    setPhase('entering');
  }

  function playEndBeeps() {
    try {
      beepCtxRef.current = beepCtxRef.current ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ctx = beepCtxRef.current;
      [0, 0.25, 0.5].forEach(offset => {
        const t = ctx.currentTime + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 1200;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      });
    } catch { /* ignore — audio might be blocked */ }
  }

  function saveCount() {
    if (!pair || !key) return;
    const n = parseInt(entered, 10);
    if (!Number.isFinite(n) || n < 0) return;
    const now = Date.now();
    const [aSorted, bSorted] = [pair[0].id, pair[1].id].sort();
    // Record the mic's count alongside the saved one whenever the mic was
    // counting — including when the two agree. The disagreement is the only
    // real measurement of detector accuracy we get, and it is worthless if
    // only the mismatches are kept.
    const attempt: SwapAttempt = micCounted == null
      ? { count: n, at: now }
      : { count: n, at: now, micCount: micCounted };
    setSwaps(prev => {
      const existing = prev[key];
      const history = [...(existing?.history ?? []), attempt].slice(-MAX_HISTORY);
      const next: SwapRecord = existing
        ? {
            ...existing,
            lastCount: n,
            bestCount: Math.max(existing.bestCount, n),
            attempts: existing.attempts + 1,
            lastAt: now,
            history,
          }
        : {
            pairKey: key,
            chordA: aSorted,
            chordB: bSorted,
            bestCount: n,
            lastCount: n,
            attempts: 1,
            lastAt: now,
            history: [attempt],
          };
      return { ...prev, [key]: next };
    });
    setLog(prev => [...prev, { at: now, kind: 'swap', pairKey: key, swapCount: n }]);
    setSavedCount(n);
    setPhase('finished');
  }

  function cancelBackToPicker() {
    setPair(null);
    setPhase('picking');
    resetRoundState();
    timerRef.current?.reset();
  }

  function againSame() {
    setPhase('ready');
    resetRoundState();
    timerRef.current?.reset();
  }

  function cancelAttempt() {
    if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    timerRef.current?.reset();
    setPhase('ready');
    resetRoundState();
  }

  // A deep-linked pair includes a chord not yet in the repertoire — register it first.
  if (registerId) {
    const lib = libraryChordById(registerId);
    const [aId, bId] = pendingPair ?? [registerId, registerId];
    return (
      <div>
        <RoutineHeader title="Chord swap" backLabel="Exercise" backTo="/exercise" />
        <div className="card">
          <p style={{ margin: 0 }}>
            To train the <strong>{aId} ↔ {bId}</strong> swap, <strong>{registerId}</strong> needs to be
            in your repertoire. Register it — draw the shape and pick a category — to continue.
          </p>
        </div>
        <ChordEditor
          title={`Register ${registerId}`}
          initialName={registerId}
          initialShape={lib?.fingerings[0]?.shape}
          withCategory
          initialCategory={lib?.category ?? 'other'}
          saveLabel="Save & continue"
          onSave={registerChord}
          onCancel={cancelRegister}
        />
      </div>
    );
  }

  // A deep-linked pair (possibly with library previews) is loading — show it, not the
  // "need 2 chords" gate, even if the repertoire itself has fewer than two owned chords.
  if (notEnough && !pair && !pendingPair) {
    return (
      <div>
        <RoutineHeader title="Chord swap" backLabel="Exercise" backTo="/exercise" />
        <div className="card">
          <p>You need at least 2 chords in your repertoire to run this routine.</p>
          <Link to="/chords?tab=library" className="button primary">Go learn some chords</Link>
        </div>
      </div>
    );
  }

  if ((phase === 'picking' || !pair) && !pendingPair) {
    return (
      <div>
        <RoutineHeader title="Chord swap" backLabel="Exercise" backTo="/exercise" />
        <div className="card">
          <div className="row">
            <button className="button primary" onClick={pickRandom}><IconRandom /> Random pair</button>
            <div className="spacer" />
            <span className="muted">{seconds}s per round</span>
          </div>
          <hr className="rule" />
          <ManualPicker repertoire={repertoire} swaps={swaps} onPick={pickManual} />
        </div>

        <TrainedPairsList swaps={swaps} repertoire={repertoire} onPick={(a, b) => pickManual(a, b)} />
      </div>
    );
  }

  if (!pair) return null; // transient: a pending deep-linked pair is still resolving

  const [a, b] = pair;

  return (
    <div className={flashing ? 'flash-done' : ''} style={{ transition: 'background 0.1s' }}>
      <RoutineHeader
        title={`${a.name} ↔ ${b.name}`}
        backLabel="Pick different"
        onBack={cancelBackToPicker}
        stats={<>Best <strong>{record?.bestCount ?? '—'}</strong> · Last <strong>{record?.lastCount ?? '—'}</strong> · {record?.attempts ?? 0} attempts</>}
      />

      <div className="pair">
        {[a, b].map(c => (
          <ChordCard
            key={c.id}
            variant="feature"
            chord={cardFromChord(c)}
            needsCalibration={micSettings.enabled && gate.needs.has(c.id)}
            // Only a chord you DON'T own needs an action here (a deep-linked
            // preview). "in repertoire · Remove" mid-drill is noise.
            footer={owned.has(c.id)
              ? undefined
              : <RepertoireToggle chord={c} owned={false} onToggle={toggleRepertoire} />}
          />
        ))}
      </div>

      {micSettings.enabled && pair && !gate.ready && (
        <div className="gate-note">
          <div>
            <IconMic size={13} /> <strong>Mic counting is off for this pair.</strong>{' '}
            {gate.blocking.map(bk => chordNames.get(bk.chordId) ?? bk.chordId).join(' and ')}{' '}
            {gate.blocking.length === 1 ? "isn't calibrated yet" : "aren't calibrated yet"} — without that I
            can't reliably tell your two chords apart, so I won't guess. Count in your head this round.
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
            {gate.blocking.map(bk => (
              <Link key={bk.chordId} className="button primary"
                to={`/calibrate/${encodeURIComponent(bk.chordId)}`}>
                <IconTarget size={13} /> Calibrate {chordNames.get(bk.chordId) ?? bk.chordId}
              </Link>
            ))}
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            About {Math.max(...gate.blocking.map(bk => bk.samplesLeft))} clean strums each — under a minute.
          </div>
        </div>
      )}

      <Timer ref={timerRef} seconds={seconds} onComplete={onTimerComplete} />


      {phase === 'ready' && (
        <div className="stage-actions">
          <button className="button primary big" onClick={start}>Start {seconds}s</button>
        </div>
      )}

      {phase === 'running' && (
        <>
          {micActive && mic.state === 'listening' ? (
            <div className="card stage">
              <div className="step-title">Swaps heard</div>
              <div className="stage-display">{liveSwaps}</div>
              <div className="muted">
                {hearing ? <>Hearing: <strong>{hearing}</strong></> : 'Hearing: …'}
                {lastClean && <> · <CleanlinessBadge clean={lastClean} showHint={false} /></>}
              </div>
            </div>
          ) : (
            <div className="card stage">
              <div className="step-title">Swap between the two chords — count in your head</div>
              <div className="muted" style={{ marginTop: 'var(--s2)' }}>
                {micSettings.enabled && !gate.ready
                  ? `Mic counting is off — ${gate.blocking.map(bk => chordNames.get(bk.chordId) ?? bk.chordId).join(' and ')} still needs calibrating. Screen will flash when the minute is up.`
                  : micSettings.enabled && (mic.state === 'denied' || mic.state === 'error')
                    ? 'Mic unavailable — count in your head as usual. Screen will flash when the minute is up.'
                    : 'Screen will flash when the minute is up.'}
              </div>
            </div>
          )}
          <div className="footer-bar">
            <button className="button" onClick={cancelAttempt}>Cancel — don't record</button>
          </div>
        </>
      )}

      {phase === 'entering' && (
        <div className="card stage">
          <div className="step-title">Time's up — how many did you count?</div>
          {micCounted != null && (
            <p className="muted" style={{ marginTop: 'var(--s2)' }}>
              <IconMic size={13} /> Mic counted <strong>{micCounted}</strong> — adjust if it's off.
            </p>
          )}
          <input
            ref={inputRef}
            className="big-number-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={500}
            value={entered}
            onChange={e => setEntered(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveCount(); }}
            placeholder="0"
          />
          <div className="stage-actions">
            <button className="button primary big" onClick={saveCount} disabled={entered === '' || !Number.isFinite(parseInt(entered, 10))}>
              Save
            </button>
            <button className="button" onClick={cancelAttempt}>Discard</button>
          </div>
        </div>
      )}

      {phase === 'finished' && savedCount != null && (
        <>
          <div className="card stage">
            <div className="stage-display">{savedCount}</div>
            <div className="step-title">
              swaps{priorBest == null || savedCount > priorBest ? <> — new record <IconCelebrate size={14} /></> : ''}
            </div>
          </div>
          {micCounted != null && (
            <p className="muted" style={{ textAlign: 'center', marginTop: -4 }}>
              {micCounted === savedCount
                ? 'The mic agreed with you exactly.'
                : `The mic counted ${micCounted} — ${Math.abs(savedCount - micCounted)} ${
                    micCounted < savedCount ? 'short' : 'over'}.`}
            </p>
          )}
          {record && record.history.length > 1 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3>History for this pair</h3>
              <Sparkline history={record.history} />
              <div className="muted">
                Showing last {record.history.length} attempts · best <strong>{record.bestCount}</strong>
                {micAccuracy(record.history)}
              </div>
            </div>
          )}
          {/* The header already carries "Pick different" and the way out. */}
          <div className="stage-actions">
            <button className="button primary big" onClick={againSame}>Again — same pair</button>
            <button className="button big" onClick={() => { setPair(randomPair(repertoire)); setPhase('ready'); resetRoundState(); timerRef.current?.reset(); }}>
              Different pair
            </button>
          </div>
        </>
      )}

      <MicPanel
        mic={mic} micSettings={micSettings} setMicSettings={setMicSettings}
        micLabel="Count with microphone" active={micActive}
        targets={micTargets} log={debugLog} names={chordNames}
        expectedId={expectedNextId}
      >
        {phase === 'ready' && micActive && <CleanlinessBadge clean={lastClean} />}
      </MicPanel>
    </div>
  );
}

function RepertoireToggle({ chord, owned, onToggle }: {
  chord: Chord;
  owned: boolean;
  onToggle: (c: Chord) => void;
}) {
  return (
    <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 10 }}>
      <span style={{ color: owned ? 'var(--good)' : 'var(--warn)', fontWeight: 700 }}>
        {owned ? <><IconYes size={12} /> in repertoire</> : <><IconNo size={12} /> not in repertoire</>}
      </span>
      <button className="button" onClick={() => onToggle(chord)}>
        {owned ? '− Remove' : '+ Add'}
      </button>
    </div>
  );
}

function ManualPicker({ repertoire, swaps, onPick }: {
  repertoire: Chord[];
  swaps: Record<string, SwapRecord>;
  onPick: (a: string, b: string) => void;
}) {
  const [a, setA] = useState(repertoire[0]?.id ?? '');
  const [b, setB] = useState(repertoire[1]?.id ?? '');
  const key = a && b ? pairKey(a, b) : '';
  const rec = key ? swaps[key] : null;

  return (
    <div className="row">
      <label>
        Chord A
        <select value={a} onChange={e => setA(e.target.value)} style={{ marginLeft: 6 }}>
          {repertoire.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>
        Chord B
        <select value={b} onChange={e => setB(e.target.value)} style={{ marginLeft: 6 }}>
          {repertoire.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="muted">
        {rec ? `Best ${rec.bestCount} · Last ${rec.lastCount} · ${rec.attempts}×` : 'Never tried'}
      </div>
      <div className="spacer" />
      {/* One primary per screen — Random pair owns it. */}
      <button className="button" disabled={!a || !b || a === b} onClick={() => onPick(a, b)}>
        Use this pair
      </button>
    </div>
  );
}

function TrainedPairsList({ swaps, repertoire, onPick }: {
  swaps: Record<string, SwapRecord>;
  repertoire: Chord[];
  onPick: (a: string, b: string) => void;
}) {
  const names = useMemo(() => new Map(repertoire.map(c => [c.id, c.name])), [repertoire]);
  const list = Object.values(swaps).sort((x, y) => y.lastAt - x.lastAt);
  if (list.length === 0) return null;
  // The pair's catalog identity is its base triads, so Am7↔Cmaj7 reads the same
  // frequency and roadmap targets as Am↔C — the same change either way.
  const base = (id: string) => normalizeToLevel(stripShape(names.get(id) ?? id) || id, 'base');
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Pairs you've trained</h3>
      <div className="col">
        {list.map(r => (
          <div key={r.pairKey} className="col" style={{ gap: 2, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <div className="row">
              <div style={{ fontWeight: 700 }}>
                {names.get(r.chordA) ?? r.chordA} ↔ {names.get(r.chordB) ?? r.chordB}
              </div>
              <div className="muted">best {r.bestCount} · last {r.lastCount} · {r.attempts}×</div>
              <div style={{ minWidth: 120 }}>
                <Sparkline history={r.history} small />
              </div>
              <div className="spacer" />
              <button className="button" onClick={() => onPick(r.chordA, r.chordB)}>Train</button>
            </div>
            <TransitionFacts a={base(r.chordA)} b={base(r.chordB)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Running accuracy of the microphone counter over the rounds that used it:
// the saved (hand) count is the truth, `micCount` what the mic heard. Shown so
// the detector's real-world error is visible from ordinary practice instead of
// having to be recalled after the fact.
function micAccuracy(history: SwapAttempt[]) {
  const scored = history.filter(h => h.micCount != null);
  if (scored.length === 0) return null;
  const exact = scored.filter(h => h.micCount === h.count).length;
  const worst = scored.reduce((m, h) => Math.max(m, Math.abs(h.count - h.micCount!)), 0);
  return (
    <> · <IconMic size={12} /> mic exact on <strong>{exact}/{scored.length}</strong>
      {worst > 0 ? ` · worst miss ${worst}` : ''}</>
  );
}

function randomPair(repertoire: Chord[]): [Chord, Chord] {
  const i = Math.floor(Math.random() * repertoire.length);
  let j = Math.floor(Math.random() * repertoire.length);
  while (j === i) j = Math.floor(Math.random() * repertoire.length);
  return [repertoire[i], repertoire[j]];
}
