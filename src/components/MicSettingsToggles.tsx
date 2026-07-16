import type { MicSettings } from '../state/store';

// The three opt-in microphone checkboxes shared by the swap and quiz routines.
// The 🎯 Auto-calibrate and 🔬 Detection-details toggles are identical everywhere;
// only the primary 🎙 toggle's wording changes per routine (counting vs auto-reveal),
// so it's passed in. Calibrate/debug are gated on `enabled`.
export function MicSettingsToggles({ micSettings, setMicSettings, micLabel, micTitle }: {
  micSettings: MicSettings;
  setMicSettings: (v: MicSettings | ((prev: MicSettings) => MicSettings)) => void;
  micLabel: string;  // e.g. "🎙 Count with microphone"
  micTitle?: string;
}) {
  return (
    <>
      <label className="toggle" title={micTitle}>
        <input type="checkbox" checked={micSettings.enabled}
          onChange={e => setMicSettings(prev => ({ ...prev, enabled: e.target.checked }))} />
        {micLabel}
      </label>
      <label className="toggle" title="Learn per-chord thresholds from strums confirmed as correct">
        <input type="checkbox" checked={!!micSettings.calibrate} disabled={!micSettings.enabled}
          onChange={e => setMicSettings(prev => ({ ...prev, calibrate: e.target.checked }))} />
        🎯 Auto-calibrate
      </label>
      <label className="toggle" title="Show the /mic-test diagnostics (live chroma, thresholds, raw events) during the exercise">
        <input type="checkbox" checked={!!micSettings.debug} disabled={!micSettings.enabled}
          onChange={e => setMicSettings(prev => ({ ...prev, debug: e.target.checked }))} />
        🔬 Detection details
      </label>
    </>
  );
}
