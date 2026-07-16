import { useEffect, useRef } from 'react';
import type { ListenerState } from '../audio/chordListener';
import { useMicSettings } from '../state/store';
import { FilterSpectrum } from './FilterSpectrum';

// Shared "Mic Input Tuning" — the per-rig input controls: a Discord-style
// activation-sensitivity gate you drag directly on the live level bar, a noise-
// filter toggle, and (non-compact) tunable filter cutoffs. Backed by the global
// micSettings, so the SAME control governs detection everywhere it's shown:
// every exercise and (later) the Calibration Studio. Pass the mic hook's
// getLevel + state. `compact` hides the helper text + advanced filter tuning.
export function MicInputTuning({ getLevel, state, compact = false, getSpectrum, getSpectrumMeta }: {
  getLevel: () => number;
  state: ListenerState;
  compact?: boolean;
  getSpectrum?: () => Float32Array;
  getSpectrumMeta?: () => { sampleRate: number; fftSize: number };
}) {
  const [micSettings, setMicSettings] = useMicSettings();
  const threshold = micSettings.activationThreshold ?? 0;
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;
  const hp = micSettings.filterHpHz ?? 75;
  const lp = micSettings.filterLpHz ?? 7000;

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

  return (
    <div className={`card mic-tuning${compact ? ' compact' : ''}`}>
      <div className="row" style={{ marginBottom: 8 }}>
        <strong>🎚 Sensitivity</strong>
        {!compact && <span className="muted">drag the line — sounds below it don’t register</span>}
        <div className="spacer" />
        <label className="toggle" title="High-pass + low-pass filter: cuts rumble, handling noise and hiss (keeps the guitar)">
          <input
            type="checkbox"
            checked={!!micSettings.filters}
            onChange={e => setMicSettings(prev => ({ ...prev, filters: e.target.checked }))}
          />
          🧹 Filters
        </label>
        <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {threshold === 0 ? 'off' : threshold.toFixed(2)}
        </span>
      </div>

      <div className="threshold-track draggable" ref={trackRef} onPointerDown={onTrackPointerDown}>
        <div className="threshold-fill" ref={meterFillRef} />
        <div className="threshold-marker" style={{ left: `${threshold * 100}%` }} />
      </div>

      {!compact && micSettings.filters && (
        <div className="filter-tune">
          <div className="row" style={{ marginTop: 12 }}>
            <span className="muted">Filter tuning</span>
            <div className="spacer" />
            <button className="button small" onClick={() => setMicSettings(prev => ({ ...prev, filterHpHz: 75, filterLpHz: 7000 }))}>
              Reset
            </button>
          </div>
          {getSpectrum && getSpectrumMeta ? (
            <>
              <div className="muted" style={{ margin: '6px 0 2px', fontSize: 12 }}>
                Blue = live (raw, pre-filter). The <strong style={{ color: 'var(--warn)' }}>orange line</strong> jumps up when you
                strum and settles slowly — wherever it <em>stays</em> elevated after you stop is steady noise. Set
                <strong> HP</strong> / <strong>LP</strong> just inside where it stays raised at the edges.
                Now: HP <strong>{hp} Hz</strong> · LP <strong>{lp >= 1000 ? (lp / 1000).toFixed(1) + 'k' : lp} Hz</strong>
              </div>
              <FilterSpectrum
                getSpectrum={getSpectrum}
                getSpectrumMeta={getSpectrumMeta}
                state={state}
                hp={hp}
                lp={lp}
                onChange={(nhp, nlp) => setMicSettings(prev => ({ ...prev, filterHpHz: nhp, filterLpHz: nlp }))}
              />
            </>
          ) : (
            <>
              <label className="tune-row">
                <span>High-pass <strong>{hp} Hz</strong> <span className="muted">— cuts rumble below</span></span>
                <input
                  type="range" className="threshold-slider" min={20} max={200} step={1} value={hp}
                  onChange={e => setMicSettings(prev => ({ ...prev, filterHpHz: parseInt(e.target.value, 10) }))}
                />
              </label>
              <label className="tune-row">
                <span>Low-pass <strong>{lp} Hz</strong> <span className="muted">— cuts hiss above</span></span>
                <input
                  type="range" className="threshold-slider" min={2000} max={12000} step={100} value={lp}
                  onChange={e => setMicSettings(prev => ({ ...prev, filterLpHz: parseInt(e.target.value, 10) }))}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
