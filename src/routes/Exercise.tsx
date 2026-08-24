import { useMemo } from 'react';
import { IconPicking, IconQuiz, IconStrumming, IconSwap } from '../components/icons';
import { Link } from 'react-router-dom';
import { useRepertoire, useRoutineLog } from '../state/store';
import { DayActivityGrid, buildDayCells } from '../components/DayActivityGrid';
import { PageHeader } from '../components/PageHeader';

export default function Exercise() {
  const [repertoire] = useRepertoire();
  const [log] = useRoutineLog();

  const days = useMemo(() => buildDayCells(log, 7), [log]);

  const canSwap = repertoire.length >= 2;

  return (
    <div>
      <PageHeader title="Exercise" />

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Link to="/routine/quiz" className={`card routine-card${repertoire.length === 0 ? ' unavailable' : ''}`}>
          <div className="routine-icon"><IconQuiz size={40} /></div>
          <h2>Quiz</h2>
          <div className="muted">
            {repertoire.length === 0 ? 'Add a chord first' : 'Name only — you play, then reveal'}
          </div>
        </Link>
        <Link to={canSwap ? '/routine/swap' : '/routine/new'}
          className={`card routine-card${canSwap ? '' : ' unavailable'}`}>
          <div className="routine-icon"><IconSwap size={40} /></div>
          <h2>Chord swap</h2>
          <div className="muted">
            {canSwap ? '1-minute drill between two chords' : 'Add 2+ chords first'}
          </div>
        </Link>
        <Link to="/routine/strum" className="card routine-card">
          <div className="routine-icon"><IconStrumming size={40} /></div>
          <h2>Strumming</h2>
          <div className="muted">Metronome + progression practice</div>
        </Link>
        <Link to="/routine/pick" className="card routine-card">
          <div className="routine-icon"><IconPicking size={40} /></div>
          <h2>Fingerpicking</h2>
          <div className="muted">Coming soon</div>
        </Link>
      </div>

      <div className="card" style={{ marginTop: 'var(--s4)' }}>
        <div className="row">
          <h3>This week</h3>
          <div className="spacer" />
          <Link to="/" className="button">Full activity</Link>
        </div>
        <div style={{ marginTop: 'var(--s3)' }}>
          <DayActivityGrid days={days} compact />
        </div>
      </div>
    </div>
  );
}
