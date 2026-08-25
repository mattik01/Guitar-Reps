import { useMemo, useState } from 'react';
import { BackLink } from '../components/BackLink';
import { IconMic, IconStop } from '../components/icons';
import { DetectionDetails } from '../components/DetectionDetails';
import { PickStrip, type PickState } from '../components/PickStrip';
import { ChordDiagram } from '../components/ChordDiagram';
import { CHORD_LIBRARY } from '../data/chordLibrary';
import { resolveChord } from '../data/chordResolve';
import { usePluckListener } from '../audio/usePluckListener';
import { midiName, STRING_NAMES, stringPitches } from '../audio/pluck';
import { pickSignalFromPluck, type PickSignal } from '../audio/signalContract';
import { useFingeringChoice, useMicSettings, useRepertoire } from '../state/store';

// Pick Lab (URL-only: /pick-test) — the bench where the single-pluck constants in
// src/audio/pluck.ts get tuned against a real guitar, mic and room. The chord
// engine has /mic-test; this is its picking sibling, and it exists for the same
// reason: a synthetic signal can only prove the wiring, never the tuning.
//
// The point of the page is GROUND TRUTH. Turn it on and each detected pick waits
// for you to tap the string you actually picked, which turns one real-guitar
// session into a confusion matrix instead of an impression. That matrix is what
// decides whether PLUCK_SUBOCTAVE_PENALTY / PLUCK_AMBIGUOUS_MARGIN need moving.
//
// Note there is deliberately no calibration gate here: this path matches
// absolute frequencies against the held shape's own harmonics and never reads
// reps.chordProfiles, so a chord's calibration score is irrelevant to it.

// In-band delta bins only (to 5 kHz), and only for the most recent few picks —
// a full spectrum per pick would be megabytes after a minute of playing.
const CAPTURE_DEPTH = 24;

type Entry = {
  n: number;
  signal: PickSignal;
  gapMs: number | null;
  truth: number | null;
  delta: number[] | null;   // dropped beyond CAPTURE_DEPTH
};

export default function PickLab() {
  const [running, setRunning] = useState(false);
  const [chordId, setChordId] = useState(CHORD_LIBRARY[0]?.id ?? '');
  const [groundTruth, setGroundTruth] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const [repertoire] = useRepertoire();
  const [fingeringChoice] = useFingeringChoice();
  const [micSettings] = useMicSettings();

  const options = useMemo(() => {
    const ids = new Set([...repertoire.map(c => c.id), ...CHORD_LIBRARY.map(c => c.id)]);
    return [...ids]
      .map(id => resolveChord(id, repertoire, fingeringChoice))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [repertoire, fingeringChoice]);

  const chord = useMemo(
    () => resolveChord(chordId, repertoire, fingeringChoice),
    [chordId, repertoire, fingeringChoice],
  );
  const shape = chord?.shape ?? null;
  const pitches = useMemo(() => (shape ? stringPitches(shape) : [null, null, null, null, null, null]), [shape]);
  const notes = useMemo(() => pitches.map(m => (m == null ? null : midiName(m))), [pitches]);

  const mic = usePluckListener({
    enabled: running,
    shape,
    activationThreshold: micSettings.activationThreshold,
    filters: micSettings.filters,
    filterHpHz: micSettings.filterHpHz,
    filterLpHz: micSettings.filterLpHz,
    onPluck: e => {
      const signal = pickSignalFromPluck(e);
      const meta = mic.getSpectrumMeta();
      const kMax = Math.min(e.delta.length - 1, Math.floor(5000 / (meta.sampleRate / meta.fftSize)));
      const delta = Array.from(e.delta.slice(0, kMax + 1), v => Number(v.toPrecision(4)));
      setLog(prev => {
        // Gap to the previous REAL pick: a re-trigger must not become the
        // reference point, or every gap after one is nonsense.
        const prevPick = prev.find(x => x.signal.isPick);
        const gapMs = prevPick && signal.isPick ? Math.round(signal.at - prevPick.signal.at) : null;
        const next = [{ n: (prev[0]?.n ?? 0) + 1, signal, gapMs, truth: null, delta }, ...prev];
        return next.slice(0, 120).map((x, i) => (i < CAPTURE_DEPTH ? x : { ...x, delta: null }));
      });
    },
  });

  const latest = log.find(e => e.signal.isPick) ?? null;
  const awaitingTruth = groundTruth && latest != null && latest.truth == null;
  const picks = log.filter(e => e.signal.isPick).length;
  const retriggers = log.length - picks;

  function setTruth(stringIndex: number) {
    setLog(prev => {
      const i = prev.findIndex(e => e.signal.isPick);
      return i < 0 ? prev : prev.map((e, j) => (j === i ? { ...e, truth: stringIndex } : e));
    });
  }

  // Everything needed to re-run the decision offline against real audio.
  function capture() {
    const meta = mic.getSpectrumMeta();
    const blob = new Blob([JSON.stringify({
      chordId, shape, sampleRate: meta.sampleRate, fftSize: meta.fftSize,
      picks: log.filter(e => e.delta).map(e => ({
        n: e.n, truth: e.truth, gapMs: e.gapMs, signal: { ...e.signal }, delta: e.delta,
      })),
    })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `picklab-${chordId}-${log.length}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Row = the string you actually picked, column = what we said (last = unsure).
  const confusion = useMemo(() => {
    const m = Array.from({ length: 6 }, () => new Array(7).fill(0) as number[]);
    let judged = 0, right = 0, unsure = 0;
    for (const e of log) {
      if (e.truth == null) continue;
      judged++;
      const col = e.signal.stringIndex ?? 6;
      m[e.truth][col]++;
      if (e.signal.stringIndex == null) unsure++;
      else if (e.signal.stringIndex === e.truth) right++;
    }
    return { m, judged, right, unsure };
  }, [log]);

  const stripStates: PickState[] = pitches.map((p, i) => {
    if (p == null) return 'muted';
    if (awaitingTruth) return 'target';           // "tap the one you really picked"
    if (latest && latest.signal.stringIndex === i) return 'correct';
    return 'idle';
  });

  return (
    <div>
      <div className="row">
        <BackLink to="/" label="Home" />
        <h1 style={{ margin: 0 }}>Pick lab</h1>
        <div className="spacer" />
        <button
          className={`button ${running ? '' : 'primary'}`}
          title="Hold the chord below and pick ONE string at a time. Tuning constants live in src/audio/pluck.ts"
          onClick={() => setRunning(r => !r)}
        >
          {running ? <><IconStop size={14} /> Stop</> : <><IconMic size={14} /> Listen</>}
        </button>
      </div>

      <div className="card">
        <div className="row">
          <label className="toggle" title="The chord you are holding — its sounding strings are the only candidates">
            Chord
            <select value={chordId} onChange={e => setChordId(e.target.value)}>
              {options.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.owned ? ' ·' : ''}</option>
              ))}
            </select>
          </label>
          <div className="spacer" />
          <label className="toggle" title="After every pick, tap the string you actually picked — builds the confusion matrix below">
            <input type="checkbox" checked={groundTruth}
              onChange={e => setGroundTruth(e.target.checked)} />
            Ground truth
          </label>
        </div>

        {shape && (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <ChordDiagram shape={shape} size={140}
              highlightString={awaitingTruth ? null : latest?.signal.stringIndex ?? null} />
            <table className="pick-table">
              <thead>
                <tr><th>String</th><th>Note</th><th className="num">Hz</th></tr>
              </thead>
              <tbody>
                {STRING_NAMES.map((label, i) => (
                  <tr key={i}>
                    <td>{label}</td>
                    <td>{notes[i] ?? '—'}</td>
                    <td className="num">
                      {pitches[i] == null ? '' : (440 * Math.pow(2, (pitches[i]! - 69) / 12)).toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <PickStrip
          states={stripStates}
          notes={notes}
          onSelect={awaitingTruth ? setTruth : undefined}
          selectTitle="Which string did you actually pick?"
        />
      </div>

      {/* THE shared detection panel — same sensitivity gate, filters and live
          spectrum as every other mic screen. It has no chroma to show for this
          engine, so no targets are passed. */}
      <DetectionDetails
        mic={{ ...mic, error: running ? mic.error : null }}
        targets={[]}
        log={[]}
      />

      {confusion.judged > 0 && (
        <div className="card">
          <h2>Confusion — {confusion.right}/{confusion.judged} right, {confusion.unsure} unsure</h2>
          <table className="pick-table">
            <thead>
              <tr>
                <th>played ↓ / heard →</th>
                {STRING_NAMES.map(s => <th key={s} className="num">{s}</th>)}
                <th className="num">unsure</th>
              </tr>
            </thead>
            <tbody>
              {confusion.m.map((row, i) => (
                <tr key={i}>
                  <td>{STRING_NAMES[i]}</td>
                  {row.map((v, j) => (
                    <td key={j} className="num">{v || ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {latest && (
        <div className="card">
          <h2>Last pick — per candidate</h2>
          <table className="pick-table">
            <thead>
              <tr>
                <th>string</th><th>note</th><th className="num">comb</th>
                <th className="num">sub-oct</th><th className="num">score</th>
              </tr>
            </thead>
            <tbody>
              {latest.signal.ranked.map(r => (
                <tr key={r.stringIndex}>
                  <td>{STRING_NAMES[r.stringIndex]}</td>
                  <td>{midiName(r.midi)}</td>
                  <td className="num">{r.comb.toFixed(3)}</td>
                  <td className="num">{r.sub.toFixed(3)}</td>
                  <td className="num">{r.score.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Picks — {picks} real, {retriggers} re-triggered</h2>
        <table className="pick-table">
          <thead>
            <tr>
              <th className="num">#</th><th>heard</th><th className="num">margin</th>
              <th className="num">strength</th><th className="num">new</th><th className="num">Δ ms</th>
              {groundTruth && <th>played</th>}
            </tr>
          </thead>
          <tbody>
            {log.map(e => {
              const s = e.signal;
              const cls = !s.isPick ? 'unsure'
                : e.truth == null ? ''
                : s.stringIndex == null ? 'unsure'
                : s.stringIndex === e.truth ? '' : 'wrong';
              return (
                <tr key={e.n} className={cls}>
                  <td className="num">{e.n}</td>
                  <td>{!s.isPick
                    ? 're-trigger'
                    : s.stringIndex == null
                      ? 'unsure'
                      : `${STRING_NAMES[s.stringIndex]} ${s.midi != null ? midiName(s.midi) : ''}`}</td>
                  <td className="num">{s.margin.toFixed(2)}</td>
                  <td className="num">{s.strength.toFixed(2)}</td>
                  <td className="num">{s.newness.toFixed(2)}</td>
                  <td className="num">{e.gapMs ?? ''}</td>
                  {groundTruth && <td>{e.truth == null ? '' : STRING_NAMES[e.truth]}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {log.length > 0 && (
          <div className="row">
            <button className="button" onClick={capture}
              title="Download the last picks with their delta spectra, so the decision can be re-run offline against real audio">
              Capture JSON
            </button>
            <button className="button" onClick={() => setLog([])}>Clear</button>
          </div>
        )}
      </div>
    </div>
  );
}
