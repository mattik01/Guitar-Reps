import type { MicSettings } from '../state/store';
import { IconMic } from './icons';

// The opt-in microphone checkbox shared by the swap and quiz routines. Only the
// wording changes per routine (counting vs auto-reveal), so it's passed in — the
// mic icon itself belongs to the toggle, not to each caller's label.
//
// Detection details is NOT here: <DetectionDetails> owns its own expander, so the
// concept has exactly one control (docs/ui.md §1.1).
//
// There is deliberately no "auto-calibrate" toggle: calibration is a focused,
// per-chord activity in the Calibration Studio (/calibrate), not something
// collected passively while you practise.
export function MicSettingsToggles({ micSettings, setMicSettings, micLabel, micTitle }: {
  micSettings: MicSettings;
  setMicSettings: (v: MicSettings | ((prev: MicSettings) => MicSettings)) => void;
  micLabel: string;  // e.g. "Count with microphone" — the mic icon is added here
  micTitle?: string;
}) {
  return (
    <>
      <label className="toggle" title={micTitle}>
        <input type="checkbox" checked={micSettings.enabled}
          onChange={e => setMicSettings(prev => ({ ...prev, enabled: e.target.checked }))} />
        <IconMic size={13} /> {micLabel}
      </label>
    </>
  );
}
