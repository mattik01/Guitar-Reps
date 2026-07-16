import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChordDiagram } from '../components/ChordDiagram';
import { CleanlinessBadge } from '../components/CleanlinessBadge';
import { MicInputTuning } from '../components/MicInputTuning';
import { useChordListener } from '../audio/useChordListener';
import type { StrumEvent } from '../audio/chordListener';
import { type Cleanliness } from '../audio/chroma';
import { profilePrototype, profileScore, profileThresholds, samplesLeftToMinScore, CAL_MIN_SCORE } from '../audio/calibration';
// The Studio talks to the mic ONLY through the signal contract (checkSignal etc.),
// never StrumEvent internals — so the detection engine stays swappable behind it.
import { checkSignal, chordTargetFromShape, signalFromStrum, signalWarningText, type SignalWarning } from '../audio/signalContract';
import { libraryChordById, libraryPrimaryShape } from '../data/chordLibrary';
import { clearChordProfile, recordChordSample, useChordProfiles, useMicSettings, useRepertoire, type ChordShape } from '../state/store';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export default function CalibrationStudio() {
  const { chordId = '' } = useParams();
  const [repertoire] = useRepertoire();
  const [profiles] = useChordProfiles();
  const [micSettings] = useMicSettings();

  // Resolve the chord: repertoire first (owned, possibly edited shape), else library.
  const resolved = useMemo(() => {
    const rep = repertoire.find(c => c.id === chordId);
    if (rep) return { name: rep.name, shape: rep.shape as ChordShape };
    const lib = libraryChordById(chordId);
    if (lib) return { name: lib.name, shape: libraryPrimaryShape(lib) as ChordShape };
    return null;
  }, [chordId, repertoire]);

  // The check target for this chord (theoretical template + expected notes).
  const target = useMemo(
    () => (resolved ? chordTargetFromShape(chordId, resolved.shape) : null),
    [resolved, chordId]
  );

  const samples = profiles[chordId]?.samples ?? [];
  const score = profileScore(samples);
  const prototype = useMemo(() => profilePrototype(samples), [samples]);
  const thresholds = useMemo(() => profileThresholds(samples), [samples]);
  // In Test mode we check against the LEARNED reference + calibrated thresholds.
  const testTarget = useMemo(
    () => (resolved ? chordTargetFromShape(chordId, resolved.shape, {
      reference: prototype, matchThreshold: thresholds?.match, unsureThreshold: thresholds?.unsure,
    }) : null),
    [resolved, chordId, prototype, thresholds]
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
    });
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
        <div className="card" style={{ alignItems: 'center', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{resolved.name}</div>
          <ChordDiagram shape={resolved.shape} size={200} />
        </div>
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
                <div className="muted" style={{ marginTop: 6, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  learned <strong>{testResult.sim.toFixed(2)}</strong> · template <strong>{testResult.tplSim.toFixed(2)}</strong>
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
