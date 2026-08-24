import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  IconCollapsed, IconDetails, IconExpanded, IconFilters, IconKnock,
  IconMic, IconSensitivity, IconStrum, IconTarget,
} from './icons';
import { chordTemplate, cosineSim } from '../audio/chroma';
import type { ListenerState } from '../audio/chordListener';
import { chordTargetFromProfile, profileScore, totalWeight, CAL_MIN_SCORE } from '../audio/calibration';
import { useChordProfiles, useMicSettings, type ChordShape } from '../state/store';
import { FilterSpectrum } from './FilterSpectrum';
import type { MicLogEntry } from './detectionLog';

// THE detection panel. One component, reused everywhere the mic is used — every
// exercise, /mic-test and the Calibration Studio — so "how is the mic hearing me?"
// is answered by the same controls in the same place on every screen.
//
//   Zone A  (always) one dense row: sensitivity gate on the live level bar,
//           the filters switch, mic status, and the expander.
//   Zone A' (filters on) the HP/LP spectrum, dragged directly on the trace.
//   Zone B  (expanded) live-vs-expected chroma + live sims, and the event log.
//           `profiles` additionally shows the calibration-profiles table.
//
// Expansion is micSettings.debug — one persisted flag, so expanding here leaves
// it expanded on the next screen. Manages its own polling; the caller feeds `log`.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// A profile can exist for a chord that isn't one of the current targets, so we
// have no shape to rebuild its template from. The learned numbers come from the
// samples, not the shape, so an all-muted placeholder is enough.
const EMPTY_SHAPE: ChordShape = { frets: ['x', 'x', 'x', 'x', 'x', 'x'], fingers: [null, null, null, null, null, null] };

// Live-chroma display tuning. Bars are EMA-smoothed and scaled by how far the
// current input level sits ABOVE the activation threshold — so they lie flat in
// silence / below the threshold and only rise with real playing.
const CHROMA_POLL_MS = 50;          // 20 Hz
const CHROMA_SMOOTH_ALPHA = 0.35;   // per-poll EMA toward the target height
const CHROMA_DISPLAY_GAIN = 1.8;    // unit-norm bins (~0.3–0.6) → readable heights

// What the mic hook hands us. Taken structurally rather than as
// ReturnType<typeof useChordListener> so this file doesn't depend on the hook.
export type DetectionMic = {
  state: ListenerState;
  error?: string | null;
  getLevel: () => number;
  getLiveChroma: () => Float32Array;
  getSpectrum: () => Float32Array;
  getSpectrumMeta: () => { sampleRate: number; fftSize: number };
};

export function DetectionDetails({
  mic, targets, log, names, expectedId, profiles: showProfiles = false, children,
}: {
  mic: DetectionMic;
  targets: { id: string; shape: ChordShape }[];
  log: MicLogEntry[];
  names?: Map<string, string>;
  expectedId?: string;              // the chord expected RIGHT NOW
  profiles?: boolean;               // render the calibration-profiles table
  children?: ReactNode;             // caller-specific status (cleanliness, verdict…)
}) {
  const [profiles, setProfiles] = useChordProfiles();
  const [micSettings, setMicSettings] = useMicSettings();
  const { state, getLevel, getLiveChroma, getSpectrum, getSpectrumMeta } = mic;

  const expanded = !!micSettings.debug;
  const threshold = micSettings.activationThreshold ?? 0;
  const hp = micSettings.filterHpHz ?? 75;
  const lp = micSettings.filterLpHz ?? 7000;
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  const [liveChroma, setLiveChroma] = useState<Float32Array>(new Float32Array(12));
  const [barHeights, setBarHeights] = useState<number[]>(() => new Array(12).fill(0));
  const smoothedRef = useRef<Float32Array>(new Float32Array(12));

  // Live level fill via rAF + direct DOM writes — no re-render at audio rate.
  const meterFillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = meterFillRef.current;
    if (state !== 'listening') {
      if (el) el.style.width = '0%';
      return;
    }
    let raf = 0;
    const loop = () => {
      const f = meterFillRef.current;
      if (f) {
        const level = getLevel();
        f.style.width = `${Math.round(level * 100)}%`;
        f.style.background = level >= thresholdRef.current ? 'var(--good)' : 'var(--muted)';
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, getLevel]);

  // Poll chroma + level → scale bars by activation-above-threshold → EMA-smooth.
  // Only while the details are open; collapsed, nothing is drawn from it.
  useEffect(() => {
    if (state !== 'listening' || !expanded) {
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
  }, [state, expanded, getLiveChroma, getLevel]);

  const templates = useMemo(
    () => targets.map(t => ({ id: t.id, tpl: chordTemplate(t.shape) })),
    [targets]
  );
  const liveSims = templates.map(t => ({ id: t.id, sim: cosineSim(liveChroma, t.tpl) }));
  const nameFor = (id: string) => names?.get(id) ?? id;

  // The expected chroma for the chord due right now — the learned reference when
  // this chord has been calibrated, else its theoretical template. Normalised to
  // its own max, because the two sources are NOT on the same scale.
  const expected = useMemo(() => {
    if (!expectedId) return null;
    const shape = targets.find(t => t.id === expectedId)?.shape;
    if (!shape) return null;
    const t = chordTargetFromProfile(expectedId, shape, profiles[expectedId]?.samples ?? []);
    const vec = t.reference ?? t.template;
    if (!vec) return null;
    const max = Math.max(...Array.from(vec), 1e-6);
    return {
      source: t.reference ? 'learned' : 'template',
      heights: Array.from(vec, v => Math.round(Math.max(0, v / max) * 100)),
      // Which pitch classes the chord actually sounds. Taken from the target
      // rather than thresholded off the vector, because a LEARNED reference
      // spreads energy across every bin — a height cut-off would call almost
      // nothing off-chord exactly when you most want to see the strays.
      pcs: new Set(t.expectedPcs),
    };
  }, [expectedId, targets, profiles]);

  // Discord-style: set the threshold by dragging directly on the level bar.
  const trackRef = useRef<HTMLDivElement>(null);
  function setThresholdFromClientX(clientX: number) {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setMicSettings(prev => ({ ...prev, activationThreshold: Math.round(t * 100) / 100 }));
  }
  function onTrackPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    setThresholdFromClientX(e.clientX);
    const move = (ev: PointerEvent) => setThresholdFromClientX(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const unavailable = state === 'denied' || state === 'error';

  return (
    <div className={`det${expanded ? ' open' : ''}`}>
      {/* Zone A — the whole panel when collapsed. */}
      <div className="det-bar">
        <span className="det-label" title="Drag the line on the meter — sounds below it don't register">
          <IconSensitivity size={13} />
          <span className="mono">{threshold === 0 ? 'off' : threshold.toFixed(2)}</span>
        </span>

        <div className="threshold-track draggable" ref={trackRef} onPointerDown={onTrackPointerDown}>
          <div className="threshold-fill" ref={meterFillRef} />
          <div className="threshold-marker" style={{ left: `${threshold * 100}%` }} />
        </div>

        <label className="toggle" title="High-pass + low-pass filter: cuts rumble, handling noise and hiss (keeps the guitar)">
          <input
            type="checkbox"
            checked={!!micSettings.filters}
            onChange={e => setMicSettings(prev => ({ ...prev, filters: e.target.checked }))}
          />
          <IconFilters size={13} />
          {micSettings.filters ? <span className="mono">{hp}–{lp}</span> : 'Filters'}
        </label>

        {unavailable && <span className="det-status"><IconMic size={13} /> {mic.error ?? 'mic unavailable'}</span>}
        {children}

        <button
          className="det-expander"
          aria-expanded={expanded}
          title={expanded ? 'Hide detection details' : 'Show detection details (live chroma, thresholds, raw events)'}
          onClick={() => setMicSettings(prev => ({ ...prev, debug: !prev.debug }))}
        >
          <IconDetails size={13} />
          {expanded ? <IconExpanded size={13} /> : <IconCollapsed size={13} />}
        </button>
      </div>

      {/* Zone A' — filter tuning, inline, because it is set against what you hear. */}
      {micSettings.filters && (
        <div className="det-filters">
          <FilterSpectrum
            getSpectrum={getSpectrum}
            getSpectrumMeta={getSpectrumMeta}
            state={state}
            hp={hp}
            lp={lp}
            onChange={(nhp, nlp) => setMicSettings(prev => ({ ...prev, filterHpHz: nhp, filterLpHz: nlp }))}
          />
          <div className="det-filters-foot">
            <span className="muted" title="Blue is the live raw spectrum (pre-filter). The orange line jumps when you strum and settles slowly, so wherever it stays elevated after you stop is steady noise — drag HP/LP just inside it.">
              HP <strong className="mono">{hp}</strong> · LP <strong className="mono">{lp}</strong> Hz
            </span>
            <div className="spacer" />
            <button className="button small" onClick={() => setMicSettings(prev => ({ ...prev, filterHpHz: 75, filterLpHz: 7000 }))}>
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Zone B — the details themselves. */}
      {expanded && (
        <div className="det-body">
          <div className="det-chroma">
            <div className="det-head">
              <span className="muted">Live</span>
              {expected && (
                <span className="muted" title={expected.source === 'learned'
                  ? 'Ghost bars = how YOU actually play this chord, learned in the Calibration Studio'
                  : 'Ghost bars = the theoretical chord template. Calibrate this chord to compare against your own playing instead.'}>
                  vs expected <strong>{expectedId && nameFor(expectedId)}</strong> · {expected.source}
                </span>
              )}
            </div>
            <div className="chroma-bars">
              {NOTE_NAMES.map((n, i) => {
                const exp = expected?.heights[i] ?? 0;
                const inChord = expected?.pcs.has(i) ?? true;
                return (
                  <div key={n} className={`chroma-bar${expected && !inChord ? ' off-chord' : ''}`}>
                    <div className="chroma-bar-track">
                      {expected && <div className="chroma-bar-expected" style={{ bottom: `${exp}%` }} />}
                      <div className="chroma-bar-fill" style={{ height: `${barHeights[i]}%` }} />
                    </div>
                    <div className="chroma-bar-label">{n}</div>
                  </div>
                );
              })}
            </div>
            <div className="det-sims">
              {liveSims.map(s => (
                <span key={s.id} className="muted">
                  {nameFor(s.id)} <span className="mono">{s.sim.toFixed(3)}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="det-events">
            <div className="det-head"><span className="muted">Events (latest first)</span></div>
            {log.length === 0
              ? <p className="muted">Nothing detected yet.</p>
              : log.map((e, i) => (
                <div key={`${e.at}-${i}`} className="det-event">
                  <span className="det-event-kind">
                    {e.kind === 'strum'
                      ? <><IconStrum size={12} /> strum</>
                      : e.kind === 'knock' ? <><IconKnock size={12} /> knock</> : <><IconKnock size={12} /> double</>}
                  </span>
                  <span className="muted mono">{e.detail}</span>
                </div>
              ))}
          </div>

          {showProfiles && Object.keys(profiles).length > 0 && (
            <div className="det-profiles">
              <div className="det-head">
                <span className="muted"><IconTarget size={13} /> Calibration profiles</span>
                <div className="spacer" />
                <button
                  className="button small danger"
                  onClick={() => {
                    // Every one of these is a chord the user deliberately sat down and played.
                    if (confirm('Delete EVERY chord calibration profile? This cannot be undone.')) setProfiles({});
                  }}
                >Reset all</button>
              </div>
              {Object.entries(profiles).map(([id, profile]) => {
                const samples = profile?.samples ?? [];
                const score = profileScore(samples);
                const t = chordTargetFromProfile(id, targets.find(x => x.id === id)?.shape ?? EMPTY_SHAPE, samples);
                return (
                  <div key={id} className="det-event">
                    <span className="det-event-kind">{nameFor(id)}</span>
                    <span className="muted mono">
                      <span style={{ color: score >= CAL_MIN_SCORE ? 'var(--good)' : 'var(--warn)' }}>{score}/100</span>
                      {' · '}{samples.length} sample{samples.length === 1 ? '' : 's'} (Σw {totalWeight(samples).toFixed(1)})
                      {t.matchThreshold != null
                        ? ` · match ≥ ${t.matchThreshold.toFixed(3)} · unsure ≥ ${(t.unsureThreshold ?? 0).toFixed(3)} · typical ${(t.typicalSim ?? 0).toFixed(3)}`
                        : ' · not enough evidence yet'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
