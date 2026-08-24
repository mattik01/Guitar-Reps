// Placeholder — the fingerpicking routine itself isn't designed yet.
import { RoutineHeader } from '../components/RoutineHeader';
import { IconPicking } from '../components/icons';

export default function PickRoutine() {
  return (
    <div>
      <RoutineHeader title="Fingerpicking" backLabel="Exercise" backTo="/exercise" />
      <div className="card placeholder">
        <div className="routine-icon"><IconPicking size={40} /></div>
        <h2>Not built yet</h2>
        <div className="muted">This routine is a placeholder — the exercise still needs designing.</div>

      </div>
    </div>
  );
}
