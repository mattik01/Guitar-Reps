import { Link } from 'react-router-dom';
import { IconGuitar } from '../components/icons';
import { dayKey, useRepertoire, useRoutineLog } from '../state/store';
import { PageHeader } from '../components/PageHeader';
import ActivityPanel from './ActivityPanel';

/**
 * Home is the activity dashboard: what you did today, then the week grid, the
 * recent log and your swap pairs (ActivityPanel — it used to be Progress's
 * first sub-tab). The routine launcher lives at /exercise.
 */
export default function Home() {
  const [repertoire] = useRepertoire();
  const [log] = useRoutineLog();

  const todayKey = dayKey(Date.now());
  const todayCount = log.filter(l => dayKey(l.at) === todayKey).length;

  return (
    <div>
      <PageHeader title="Guitar Reps" />

      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ lineHeight: 0, marginBottom: 4 }}><IconGuitar size={40} /></div>
        <h2 style={{ margin: '4px 0' }}>
          {todayCount === 0 ? 'Nothing practised yet today' : `${todayCount} routine${todayCount === 1 ? '' : 's'} today`}
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {repertoire.length} chord{repertoire.length === 1 ? '' : 's'} in your repertoire
        </p>
        <Link to="/exercise" className="button primary big">Start practising</Link>
      </div>

      {/* The week grid, the recent log and the swap-pair table. */}
      <div style={{ marginTop: 16 }}>
        <ActivityPanel />
      </div>
    </div>
  );
}
