import { useEffect, useMemo, useRef, useState } from 'react';
import { chordTemplate, cosineSim } from '../audio/chroma';
import type { ListenerState, StrumEvent } from '../audio/chordListener';
import { chordTargetFromProfile, profileScore, totalWeight, CAL_MIN_SCORE } from '../audio/calibration';

// A profile can exist for a chord that isn't one of the current targets, so we
// have no shape to rebuild its template from. The learned numbers below come from
// the samples, not the shape, so an all-muted placeholder is enough.
const EMPTY_SHAPE: ChordShape = { frets: ['x', 'x', 'x', 'x', 'x', 'x'], fingers: [null, null, null, null, null, null] };
import { useChordProfiles, useMicSettings, type ChordShape } from '../state/store';
import { MicInputTuning } from './MicInputTuning';

// The /mic-test diagnostic panels, extracted so the exercises can show the exact
// same thing behind the "🔬 Detection details" toggle. Two-column layout: a main
// column (sensitivity control → live chroma → auto-calibration table) and a tall
// events log on the side. Manages its own polling; the caller only feeds `log`.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Live-chroma display tuning. Bars are EMA-smoothed and scaled by how far the
// current input level sits ABOVE the activation threshold — so they lie flat in
// silence / below the threshold and only rise with real playing.
const CHROMA_POLL_MS = 50;          // 20 Hz — smoother than the old 10 Hz
const CHROMA_SMOOTH_ALPHA = 0.35;   // per-poll EMA toward the target height
const CHROMA_DISPLAY_GAIN = 1.8;    // unit-norm bins (~0.3–0.6) → readable heights

export type MicLogEntry = {
  at: number;
  kind: 'strum' | 'knock' | 'double-knock';
  detail: string;
};

// Single source of truth for the strum log line so all three call sites match.
export function strumLogDetail(e: StrumEvent): string {
  return `${e.matches.map(m => `${m.id} ${m.similarity.toFixed(3)}`).join(' · ')} → best ${e.best ?? '(unsure)'} · verdict ${e.verdict} · sustain ${e.sustain.toFixed(2)} · pcs ${e.activePc}`
    + (e.cleanliness
      ? ` · clean ${e.cleanliness.score} (comp ${e.cleanliness.completeness.toFixed(2)} pur ${e.cleanliness.purity.toFixed(2)} ton ${e.cleanliness.tonality.toFixed(2)} sus ${e.cleanliness.sustain.toFixed(2)})`
      : '');
}

export function MicDiagnostics({ getLiveChroma, getLevel, state, targets, log, names, getSpectrum, getSpectrumMeta }: {
  getLiveChroma: () => Float32Array;
  getLevel: () => number;
  state: ListenerState;
  targets: { id: string; shape: ChordShape }[];
  log: MicLogEntry[];
  names?: Map<string, string>;
  getSpectrum?: () => Float32Array;
  getSpectrumMeta?: () => { sampleRate: number; fftSize: number };
}) {
  const [profiles, setProfiles] = useChordProfiles();
  const [micSettings] = useMicSettings();
  const threshold = micSettings.activationThreshold ?? 0;
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  const [liveChroma, setLiveChroma] = useState<Float32Array>(new Float32Array(12));
  const [barHeights, setBarHeights] = useState<number[]>(() => new Array(12).fill(0));
  const smoothedRef = useRef<Float32Array>(new Float32Array(12));

  // Poll chroma + level → scale bars by activation-above-threshold → EMA-smooth.
  useEffect(() => {
    if (state !== 'listening') {
      smoothedRef.current = new Float32Array(12);
      setBarHeights(new Array(12).fill(0));
      return;
    }
    const id = window.setInterval(() => {
      const chroma = getLiveChroma();
      const level = getLevel();
      const thr = thresholdRef.current;
      // 0 in silence / at-or-below threshold; ramps to 1 as level clears it.
      const barScale = thr >= 1 ? 0 : Math.max(0, Math.min(1, (level - thr) / (1 - thr)));
      const s = smoothedRef.current;
      const out = new Array(12);
      for (let i = 0; i < 12; i++) {
        const target = Math.min(1, chroma[i] * CHROMA_DISPLAY_GAIN) * barScale;
        s[i] += CHROMA_SMOOTH_ALPHA * (target - s[i]);
        out[i] = Math.round(s[i] * 100);
      }
      setLiveChroma(chroma.slice());
      setBarHeights(out);
    }, CHROMA_POLL_MS);
    return () => window.clearInterval(id);
  }, [state, getLiveChroma, getLevel]);

  const templates = useMemo(
    () => targets.map(t => ({ id: t.id, tpl: chordTemplate(t.shape) })),
    [targets]
  );
  const liveSims = templates.map(t => ({ id: t.id, sim: cosineSim(liveChroma, t.tpl) }));
  const nameFor = (id: string) => names?.get(id) ?? id;

  return (
    <div className="mic-diag">
      <div className="mic-diag-main">
        <MicInputTuning getLevel={getLevel} state={state} getSpectrum={getSpectrum} getSpectrumMeta={getSpectrumMeta} />

        {state === 'listening' && (
          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Live chroma</h3>
            <div className="chroma-bars">
              {NOTE_NAMES.map((n, i) => (
                <div key={n} className="chroma-bar">
                  <div className="chroma-bar-track">
                    <div className="chroma-bar-fill" style={{ height: `${barHeights[i]}%` }} />
                  </div>
                  <div className="chroma-bar-label">{n}</div>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              {liveSims.map(s => (
                <div key={s.id} className="muted">
                  live sim <strong>{nameFor(s.id)}</strong>: {s.sim.toFixed(3)}
                </div>
              ))}
            </div>
          </div>
        )}

        {Object.keys(profiles).length > 0 && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row">
              <h3 style={{ margin: 0 }}>🎯 Calibration profiles</h3>
              <div className="spacer" />
              <button
                className="button danger"
                onClick={() => {
                  // Far more valuable than the old passive samples were — every one
                  // of these is a chord the user deliberately sat down and played.
                  if (confirm('Delete EVERY chord calibration profile? This cannot be undone.')) setProfiles({});
                }}
              >Reset all</button>
            </div>
            <div className="col" style={{ marginTop: 8 }}>
              {Object.entries(profiles).map(([id, profile]) => {
                const samples = profile?.samples ?? [];
                const score = profileScore(samples);
                const t = chordTargetFromProfile(id, targets.find(x => x.id === id)?.shape ?? EMPTY_SHAPE, samples);
                return (
                  <div key={id} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                    <div style={{ fontWeight: 700, minWidth: 80 }}>{nameFor(id)}</div>
                    <div className="muted" style={{ fontFamily: 'monospace', fontSize: 13 }}>
                      <span style={{ color: score >= CAL_MIN_SCORE ? 'var(--good)' : 'var(--warn)' }}>{score}/100</span>
                      {' · '}{samples.length} sample{samples.length === 1 ? '' : 's'} (Σw {totalWeight(samples).toFixed(1)})
                      {t.matchThreshold != null
                        ? ` · match ≥ ${t.matchThreshold.toFixed(3)} · unsure ≥ ${(t.unsureThreshold ?? 0).toFixed(3)} · typical ${(t.typicalSim ?? 0).toFixed(3)}`
                        : ' · not enough evidence yet'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <aside className="mic-diag-events card">
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
      </aside>
    </div>
  );
}
