import { useMemo } from 'react';
import { evaluateCalibrationGate, type CalibrationGate } from './calibration';
import { useChordProfiles } from '../state/store';

// React face of the calibration gate. Read-only by construction — it never writes
// to a store, so it can't re-trigger the "setState during render" fan-out that
// useLocalStore defers around.
//
// Pass the chords the exercise is about to listen for, plus (optionally) the shape
// each one will actually use, so a profile recorded against a different shape or
// fingering is caught. Nullish ids are dropped, so callers can pass a not-yet-
// chosen chord without branching.
export function useCalibrationGate(
  chordIds: (string | null | undefined)[],
  shapeKeys: Record<string, string> = {},
): CalibrationGate {
  const [profiles] = useChordProfiles();
  const ids = chordIds.filter((id): id is string => !!id);
  const key = ids.join('|');
  const shapeSig = ids.map(id => shapeKeys[id] ?? '').join('|');
  return useMemo(
    () => evaluateCalibrationGate(profiles, ids, shapeKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profiles, key, shapeSig]
  );
}
