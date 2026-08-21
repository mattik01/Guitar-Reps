import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MicMeter } from '../components/MicMeter';
import { MicDiagnostics, strumLogDetail, type MicLogEntry } from '../components/MicDiagnostics';
import { CHORD_LIBRARY, libraryPrimaryShape } from '../data/chordLibrary';
import { useChordListener } from '../audio/useChordListener';
import type { StrumEvent } from '../audio/chordListener';
import { chordTargetFromProfile } from '../audio/calibration';
import { useChordProfiles, useMicSettings } from '../state/store';

// Debug/calibration page (URL-only: /mic-test). This is where the detection
// constants in src/audio/chroma.ts + chordListener.ts get tuned against a real
// guitar, mic, and room. Keep it around — it's also the fastest way to diagnose
// "the mic feature stopped working on my laptop". The panels below are shared
// with the exercises' "🔬 Detection details" toggle via <MicDiagnostics>.

export default function MicTest() {
  const [running, setRunning] = useState(false);
  const [targetA, setTargetA] = useState(CHORD_LIBRARY[0]?.id ?? '');
  const [targetB, setTargetB] = useState(CHORD_LIBRARY[1]?.id ?? '');
  const [log, setLog] = useState<MicLogEntry[]>([]);
  const [profiles] = useChordProfiles();
  const [micSettings] = useMicSettings();

  const names = useMemo(() => new Map(CHORD_LIBRARY.map(c => [c.id, c.name])), []);

  const targets = useMemo(() => {
    return [targetA, targetB]
      .map(id => CHORD_LIBRARY.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map(c => {
        // /mic-test is a raw-engine bench, so it still feeds the listener directly —
        // but with the numbers LEARNED in the Calibration Studio.
        const shape = libraryPrimaryShape(c);
        const t = chordTargetFromProfile(c.id, shape, profiles[c.id]?.samples ?? []);
        return {
          id: c.id,
          shape,
          matchThreshold: t.matchThreshold,
          unsureThreshold: t.unsureThreshold,
          typicalSim: t.typicalSim,
        };
      });
  }, [targetA, targetB, profiles]);

  function pushLog(entry: MicLogEntry) {
    setLog(prev => [entry, ...prev].slice(0, 80));
  }

  const { state, error, getLevel, getLiveChroma, getSpectrum, getSpectrumMeta } = useChordListener({
    enabled: running,
    targets,
    activationThreshold: micSettings.activationThreshold,
    filters: micSettings.filters,
    filterHpHz: micSettings.filterHpHz,
    filterLpHz: micSettings.filterLpHz,
    onStrum: (e: StrumEvent) => pushLog({ at: e.at, kind: 'strum', detail: strumLogDetail(e) }),
    onKnock: e => pushLog({ at: e.at, kind: 'knock', detail: 'percussive onset' }),
    onDoubleKnock: e => pushLog({ at: e.at, kind: 'double-knock', detail: '🥁 double knock' }),
  });

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

      <MicDiagnostics getLiveChroma={getLiveChroma} getLevel={getLevel} state={state} targets={targets} log={log} names={names} getSpectrum={getSpectrum} getSpectrumMeta={getSpectrumMeta} />
    </div>
  );
}
