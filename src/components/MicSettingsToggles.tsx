import type { MicSettings } from '../state/store';

// The two opt-in microphone checkboxes shared by the swap and quiz routines.
// The 🔬 Detection-details toggle is identical everywhere; only the primary 🎙
// toggle's wording changes per routine (counting vs auto-reveal), so it's passed
// in. Debug is gated on `enabled`.
//
// There is deliberately no "auto-calibrate" toggle: calibration is a focused,
// per-chord activity in the Calibration Studio (/calibrate), not something
// collected passively while you practise.
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
      <label className="toggle" title="Show the /mic-test diagnostics (live chroma, thresholds, raw events) during the exercise">
        <input type="checkbox" checked={!!micSettings.debug} disabled={!micSettings.enabled}
          onChange={e => setMicSettings(prev => ({ ...prev, debug: e.target.checked }))} />
        🔬 Detection details
      </label>
    </>
  );
}
