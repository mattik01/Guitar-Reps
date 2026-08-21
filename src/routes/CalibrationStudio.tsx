import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChordCard } from '../components/ChordCard';
import { CleanlinessBadge } from '../components/CleanlinessBadge';
import { MicInputTuning } from '../components/MicInputTuning';
import { useChordListener } from '../audio/useChordListener';
import type { StrumEvent } from '../audio/chordListener';
import { type Cleanliness } from '../audio/chroma';
import { chordTargetFromProfile, profilePrototype, profileScore, samplesLeftToMinScore, shapeKey, CAL_MIN_SCORE } from '../audio/calibration';
// The Studio talks to the mic ONLY through the signal contract (checkSignal etc.),
// never StrumEvent internals — so the detection engine stays swappable behind it.
import { checkSignal, chordTargetFromShape, signalFromStrum, signalWarningText, type SignalWarning } from '../audio/signalContract';
import { resolveChord } from '../data/chordResolve';
import { clearChordProfile, recordChordSample, useChordProfiles, useFingeringChoice, useMicSettings, useRepertoire } from '../state/store';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export default function CalibrationStudio() {
  const { chordId = '' } = useParams();
  const [repertoire] = useRepertoire();
  const [profiles] = useChordProfiles();
  const [micSettings] = useMicSettings();
  const [fingeringChoice] = useFingeringChoice();

  // Resolve through the shared resolver so the Studio calibrates EXACTLY the shape
  // the exercises will show and listen for — including the user's saved fingering
  // choice. (It used to take the library's primary shape, so picking fingering #2
  // meant calibrating one voicing and being quizzed on another.)
  const resolved = useMemo(
    () => resolveChord(chordId, repertoire, fingeringChoice),
    [chordId, repertoire, fingeringChoice]
  );

  // The check target for this chord (theoretical template + expected notes).
  const target = useMemo(
    () => (resolved ? chordTargetFromShape(chordId, resolved.shape) : null),
    [resolved, chordId]
  );

  const samples = profiles[chordId]?.samples ?? [];
  const score = profileScore(samples);
  const prototype = useMemo(() => profilePrototype(samples), [samples]);
  // In Test mode we check against exactly what the EXERCISES will use — same
  // adapter, so the thresholds are measured on the same similarity scale as the
  // reference they're applied to. (Building this by hand here is how Test mode
  // ended up mixing a centered-reference score with template-scale thresholds.)
  const testTarget = useMemo(
    () => (resolved ? chordTargetFromProfile(chordId, resolved.shape, samples) : null),
    [resolved, chordId, samples]
  );

  const [mode, setMode] = useState<'calibrate' | 'test'>('calibrate');
  const [listening, setListening] = useState(false);
  const [lastClean, setLastClean] = useState<Cleanliness | null>(null);
  const [lastCaptured, setLastCaptured] = useState<boolean | null>(null);
  const [warnings, setWarnings] = useState<SignalWarning[]>([]);
  const [flash, setFlash] = useState(0);
  const [testResult, setTestResult] = useState<{ verdict: string; sim: number; tplSim: number } | null>(null);
  const [liveChroma, setLiveChroma] = useState<Float32Array>(new Float32Array(12));

  const targets = useMemo(
    () => (resolved ? [{ id: chordId, shape: resolved.shape }] : []),
    [resolved, chordId]
  );

  function handleStrum(e: StrumEvent) {
    setLastClean(e.cleanliness); // full breakdown, for the badge display only
    if (!target) return;
    const signal = signalFromStrum(e);
    if (mode === 'test') {
      // Recognize against the learned reference (proves calibration helped),
      // and compare with the theoretical-template-only match.
      if (!testTarget) return;
      const learned = checkSignal(signal, testTarget);
      const tplOnly = checkSignal(signal, target);
      setWarnings(learned.warnings);
      setTestResult({ verdict: learned.verdict, sim: learned.similarity, tplSim: tplOnly.similarity });
      setFlash(f => f + 1);
      return;
    }
    // Calibrate mode: capture clean strums via the contract's quality gate.
    const check = checkSignal(signal, target);
    setWarnings(check.warnings);
    if (check.quality <= 0) { setLastCaptured(false); return; }
    recordChordSample(chordId, target.expectedPcs, {
      chroma: Array.from(e.chroma), sim: check.similarity, weight: check.quality, source: 'single', at: e.at,
    // Stamp WHICH shape these samples describe, so the calibration gate can spot a
    // later shape edit or fingering switch and ask for a recalibration.
    }, resolved ? shapeKey(resolved.shape) : undefined);
    setLastCaptured(true);
    setFlash(f => f + 1);
  }

  const mic = useChordListener({
    enabled: listening && !!resolved,
    targets,
    activationThreshold: micSettings.activationThreshold,
    filters: micSettings.filters,
    filterHpHz: micSettings.filterHpHz,
    filterLpHz: micSettings.filterLpHz,
    onStrum: handleStrum,
  });

  useEffect(() => {
    if (mic.state !== 'listening') return;
    const id = window.setInterval(() => setLiveChroma(mic.getLiveChroma().slice()), 80);
    return () => window.clearInterval(id);
  }, [mic.state, mic.getLiveChroma]);

  if (!resolved) {
    return (
      <div>
        <div className="row">
          <Link to="/calibrate" className="button">← All chords</Link>
          <h1 style={{ margin: 0 }}>Calibrate</h1>
        </div>
        <div className="card"><p>Unknown chord “{chordId}”. <Link to="/calibrate">Pick one to calibrate.</Link></p></div>
      </div>
    );
  }

  const calibrated = score >= CAL_MIN_SCORE;
  const left = samplesLeftToMinScore(samples);
  const protoArr = prototype ? Array.from(prototype) : null;

  return (
    <div>
      <div className="row">
        <Link to="/calibrate" className="button">← All chords</Link>
        <h1 style={{ margin: 0 }}>Calibrate {resolved.name}</h1>
        <div className="spacer" />
        <div className={`cal-score ${calibrated ? 'good' : ''}`}>{score}/100{calibrated ? ' ✓' : ''}</div>
      </div>
      <p className="muted">
        Play <strong>{resolved.name}</strong> cleanly a few times — I’ll keep the good strums and learn how it sounds on your guitar.
        {calibrated ? ' Calibrated — keep going to sharpen it.' : ` About ${left} more clean strum${left === 1 ? '' : 's'} to go.`}
      </p>

      <div className="pair">
        {/* The page header already shows this chord's score, larger — no chip here. */}
        <ChordCard variant="feature" chord={resolved} diagram="shape" calibration={false} />
        <div className="card">
          <div className="row" style={{ justifyContent: 'center', marginBottom: 8 }}>
            <div className="seg">
              <button className={`seg-btn ${mode === 'calibrate' ? 'on' : ''}`} onClick={() => { setMode('calibrate'); setTestResult(null); }}>🎯 Calibrate</button>
              <button className={`seg-btn ${mode === 'test' ? 'on' : ''}`} disabled={samples.length === 0}
                onClick={() => { setMode('test'); setLastCaptured(null); }} title={samples.length === 0 ? 'Calibrate first' : 'Test recognition'}>🔎 Test</button>
            </div>
          </div>
          <MicInputTuning getLevel={mic.getLevel} state={mic.state} compact />
          <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
            <button className={`button big ${listening ? '' : 'primary'}`} onClick={() => setListening(l => !l)}>
              {listening ? '■ Stop' : '🎙 Start'}
            </button>
          </div>
          {mic.state === 'listening' && mode === 'test' && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <div key={flash} style={{ minHeight: 26 }}>
                {testResult ? (
                  <span className={`verdict-banner ${testResult.verdict === 'match' ? 'match' : testResult.verdict === 'nomatch' ? 'nomatch' : ''}`}>
                    {testResult.verdict === 'match' && 'Recognized ✓'}
                    {testResult.verdict === 'unsure' && 'Unsure'}
                    {testResult.verdict === 'nomatch' && 'Not recognized'}
                  </span>
                ) : <span className="muted">strum to test recognition…</span>}
              </div>
              {testResult && (
                <div className="muted" style={{ marginTop: 6, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                  title={'These are two different measures, so don\'t compare them directly. Learned is a centered correlation against how YOU play this chord (wrong chords should drop sharply, even below 0). Template is a plain cosine against the theoretical shape.'}>
                  learned <strong>{testResult.sim.toFixed(2)}</strong> · template <strong>{testResult.tplSim.toFixed(2)}</strong>
                  <span style={{ opacity: 0.7 }}> (different scales)</span>
                </div>
              )}
              <div style={{ marginTop: 4 }}><CleanlinessBadge clean={lastClean} /></div>
            </div>
          )}
          {mic.state === 'listening' && mode === 'calibrate' && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <div key={flash} className={lastCaptured ? 'cal-capture' : ''} style={{ minHeight: 22 }}>
                {lastCaptured === true && <span style={{ color: 'var(--good)', fontWeight: 700 }}>✓ captured</span>}
                {lastCaptured === false && <span style={{ color: 'var(--warn)' }}>skipped</span>}
                {lastCaptured == null && <span className="muted">strum when ready…</span>}
              </div>
              <div style={{ marginTop: 4 }}><CleanlinessBadge clean={lastClean} /></div>
              {warnings.map(w => (
                <div key={w} className="muted" style={{ marginTop: 4, fontSize: 12, color: 'var(--warn)' }}>
                  ⚠ {signalWarningText(w, resolved.name)}
                </div>
              ))}
            </div>
          )}
          {(mic.state === 'denied' || mic.state === 'error') && (
            <p className="muted" style={{ textAlign: 'center' }}>🎙 {mic.error ?? 'Mic unavailable'}.</p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <h3 style={{ margin: 0 }}>Progress</h3>
          <div className="spacer" />
          <span className="muted">{samples.length} sample{samples.length === 1 ? '' : 's'}</span>
          <button className="button" onClick={() => clearChordProfile(chordId)} disabled={samples.length === 0}>Reset</button>
        </div>
        <div className="cal-bar"><div className="cal-bar-fill" style={{ width: `${score}%`, background: calibrated ? 'var(--good)' : 'var(--accent)' }} /></div>

        {mic.state === 'listening' && (
          <>
            <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
              Live vs learned — the more consistent your playing, the more they line up.
            </div>
            <ChromaCompare live={liveChroma} proto={protoArr} />
          </>
        )}
      </div>
    </div>
  );
}

// Two rows of 12 bars: what the mic hears right now vs the learned prototype.
function ChromaCompare({ live, proto }: { live: Float32Array; proto: number[] | null }) {
  const liveMax = Math.max(...Array.from(live), 1e-6);
  const protoMax = proto ? Math.max(...proto, 1e-6) : 1;
  const Row = ({ label, vals, max, color }: { label: string; vals: number[] | null; max: number; color: string }) => (
    <div style={{ marginTop: 8 }}>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div className="chroma-bars" style={{ height: 60 }}>
        {NOTE_NAMES.map((n, i) => (
          <div key={n} className="chroma-bar">
            <div className="chroma-bar-track">
              <div className="chroma-bar-fill" style={{ height: vals ? `${Math.round((vals[i] / max) * 100)}%` : '0%', background: color }} />
            </div>
            <div className="chroma-bar-label">{n}</div>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <Row label="Live" vals={Array.from(live)} max={liveMax} color="var(--accent)" />
      <Row label={proto ? 'Learned' : 'Learned (no samples yet)'} vals={proto} max={protoMax} color="var(--good)" />
    </>
  );
}
