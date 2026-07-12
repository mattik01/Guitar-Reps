import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MicMeter } from '../components/MicMeter';
import { CHORD_LIBRARY, libraryPrimaryShape } from '../data/chordLibrary';
import { calibratedThresholds, chordTemplate, cosineSim, totalSampleWeight, typicalSimilarity } from '../audio/chroma';
import { useChordListener } from '../audio/useChordListener';
import type { StrumEvent } from '../audio/chordListener';
import { useMicCalibration } from '../state/store';

// Debug/calibration page (URL-only: /mic-test). This is where the detection
// constants in src/audio/chroma.ts + chordListener.ts get tuned against a real
// guitar, mic, and room. Keep it around — it's also the fastest way to diagnose
// "the mic feature stopped working on my laptop".

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

type LogEntry = {
  at: number;
  kind: 'strum' | 'knock' | 'double-knock';
  detail: string;
};

export default function MicTest() {
  const [running, setRunning] = useState(false);
  const [targetA, setTargetA] = useState(CHORD_LIBRARY[0]?.id ?? '');
  const [targetB, setTargetB] = useState(CHORD_LIBRARY[1]?.id ?? '');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [liveChroma, setLiveChroma] = useState<Float32Array>(new Float32Array(12));
  const [calibration, setCalibration] = useMicCalibration();

  const targets = useMemo(() => {
    return [targetA, targetB]
      .map(id => CHORD_LIBRARY.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map(c => {
        const sims = calibration[c.id]?.sims ?? [];
        const th = calibratedThresholds(sims);
        return {
          id: c.id,
          shape: libraryPrimaryShape(c),
          matchThreshold: th?.match,
          unsureThreshold: th?.unsure,
          typicalSim: typicalSimilarity(sims) ?? undefined,
        };
      });
  }, [targetA, targetB, calibration]);

  const templates = useMemo(
    () => targets.map(t => ({ id: t.id, tpl: chordTemplate(t.shape) })),
    [targets]
  );

  function pushLog(entry: LogEntry) {
    setLog(prev => [entry, ...prev].slice(0, 12));
  }

  const { state, error, getLevel, getLiveChroma } = useChordListener({
    enabled: running,
    targets,
    onStrum: (e: StrumEvent) => pushLog({
      at: e.at,
      kind: 'strum',
      detail: `${e.matches.map(m => `${m.id} ${m.similarity.toFixed(3)}`).join(' · ')} → best ${e.best ?? '(unsure)'} · verdict ${e.verdict} · sustain ${e.sustain.toFixed(2)} · pcs ${e.activePc}`
        + (e.cleanliness
          ? ` · clean ${e.cleanliness.score} (comp ${e.cleanliness.completeness.toFixed(2)} pur ${e.cleanliness.purity.toFixed(2)} ton ${e.cleanliness.tonality.toFixed(2)} sus ${e.cleanliness.sustain.toFixed(2)})`
          : ''),
    }),
    onKnock: e => pushLog({ at: e.at, kind: 'knock', detail: 'percussive onset' }),
    onDoubleKnock: e => pushLog({ at: e.at, kind: 'double-knock', detail: '🥁 double knock' }),
  });

  // 10 Hz chroma refresh — plenty for eyeballing, cheap enough for a debug page.
  useEffect(() => {
    if (state !== 'listening') return;
    const id = window.setInterval(() => setLiveChroma(getLiveChroma().slice()), 100);
    return () => window.clearInterval(id);
  }, [state, getLiveChroma]);

  const liveSims = templates.map(t => ({ id: t.id, sim: cosineSim(liveChroma, t.tpl) }));
  const maxBin = Math.max(...Array.from(liveChroma), 1e-6);

  return (
    <div>
      <div className="row">
        <Link to="/" className="button">← Home</Link>
        <h1 style={{ margin: 0 }}>Mic test / calibration</h1>
        <div className="spacer" />
        <button className={`button ${running ? '' : 'primary'}`} onClick={() => setRunning(r => !r)}>
          {running ? '■ Stop' : '🎙 Start listening'}
        </button>
      </div>
      <p className="muted">
        Strum chords, pluck single notes, knock on the guitar body — and check the events
        below do what you expect. Tuning constants live in <code>src/audio/chroma.ts</code>.
      </p>

      <div className="card">
        <div className="row">
          <label>
            Target A
            <select value={targetA} onChange={e => setTargetA(e.target.value)} style={{ marginLeft: 6 }}>
              {CHORD_LIBRARY.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            Target B
            <select value={targetB} onChange={e => setTargetB(e.target.value)} style={{ marginLeft: 6 }}>
              {CHORD_LIBRARY.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="spacer" />
          <MicMeter getLevel={getLevel} state={state} error={error} />
        </div>
      </div>

      {state === 'listening' && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Live chroma</h3>
          <div className="chroma-bars">
            {NOTE_NAMES.map((n, i) => (
              <div key={n} className="chroma-bar">
                <div className="chroma-bar-track">
                  <div className="chroma-bar-fill" style={{ height: `${Math.round((liveChroma[i] / maxBin) * 100)}%` }} />
                </div>
                <div className="chroma-bar-label">{n}</div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            {liveSims.map(s => (
              <div key={s.id} className="muted">
                live sim <strong>{s.id}</strong>: {s.sim.toFixed(3)}
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(calibration).length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row">
            <h3 style={{ margin: 0 }}>🎯 Auto-calibration</h3>
            <div className="spacer" />
            <button className="button" onClick={() => setCalibration({})}>Reset all</button>
          </div>
          <div className="col" style={{ marginTop: 8 }}>
            {Object.entries(calibration).map(([id, entry]) => {
              const th = calibratedThresholds(entry.sims);
              const typ = typicalSimilarity(entry.sims);
              const name = CHORD_LIBRARY.find(c => c.id === id)?.name ?? id;
              return (
                <div key={id} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                  <div style={{ fontWeight: 700, minWidth: 80 }}>{name}</div>
                  <div className="muted" style={{ fontFamily: 'monospace', fontSize: 13 }}>
                    {entry.sims.length} sample{entry.sims.length === 1 ? '' : 's'} (Σw {totalSampleWeight(entry.sims).toFixed(1)})
                    {th
                      ? ` · match ≥ ${th.match.toFixed(3)} · unsure ≥ ${th.unsure.toFixed(3)} · typical ${typ?.toFixed(3)}`
                      : ' · not enough evidence yet'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Events (latest first)</h3>
        {log.length === 0 ? (
          <p className="muted">Nothing detected yet.</p>
        ) : (
          <div className="col">
            {log.map((e, i) => (
              <div key={`${e.at}-${i}`} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                <div style={{ fontWeight: 700, minWidth: 110 }}>
                  {e.kind === 'strum' ? '🎸 strum' : e.kind === 'knock' ? '👊 knock' : '🥁 double'}
                </div>
                <div className="muted" style={{ fontFamily: 'monospace', fontSize: 13 }}>{e.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
