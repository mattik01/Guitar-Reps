import type { ReactNode } from 'react';
import { DetectionDetails } from './DetectionDetails';
import type { MicLogEntry } from './detectionLog';
import { MicSettingsToggles } from './MicSettingsToggles';
import type { useChordListener } from '../audio/useChordListener';
import type { ChordShape, MicSettings } from '../state/store';

// THE mic block for an exercise, in one piece so every routine shows the same
// thing in the same place: the mic switch row, then <DetectionDetails> — the same
// panel /mic-test and the Calibration Studio show, collapsed to a single
// sensitivity row until you open it.
export function MicPanel({
  mic, micSettings, setMicSettings, micLabel, micTitle, active, targets, log, names, expectedId, children,
}: {
  mic: ReturnType<typeof useChordListener>;
  micSettings: MicSettings;
  setMicSettings: (v: MicSettings | ((prev: MicSettings) => MicSettings)) => void;
  micLabel: string;
  micTitle?: string;
  active: boolean;                       // the mic is actually open for this phase
  targets: { id: string; shape: ChordShape }[];
  log: MicLogEntry[];
  names?: Map<string, string>;
  expectedId?: string;                   // the chord due right now
  children?: ReactNode;                  // routine-specific status (e.g. cleanliness)
}) {
  return (
    <>
      <div className="mic-strip">
        {children}
        <MicSettingsToggles micSettings={micSettings} setMicSettings={setMicSettings}
          micLabel={micLabel} micTitle={micTitle} />
      </div>

      {micSettings.enabled && (
        <DetectionDetails
          mic={{ ...mic, error: active ? mic.error : null }}
          targets={targets} log={log} names={names} expectedId={expectedId}
        />
      )}
    </>
  );
}
