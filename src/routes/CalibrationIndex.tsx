import { Link } from 'react-router-dom';
import { ChordCard } from '../components/ChordCard';
import { CHORD_LIBRARY } from '../data/chordLibrary';
import { cardFromChord, cardFromLibrary, type CardChord } from '../data/chordResolve';
import { profileScore, CAL_MIN_SCORE } from '../audio/calibration';
import { useChordProfiles, useRepertoire } from '../state/store';

// Opened without a specific chord, this is a PRIORITY worklist for your
// repertoire: not-yet-calibrated chords first, then lowest calibration score
// first (most in need). Library chords not in the repertoire sit in a secondary
// section so they stay reachable.

// The score is passed down rather than left to the card to look up: this page
// already computes every score in order to SORT by it, so passing it keeps the
// sort and the chip from ever disagreeing (and avoids a second lookup per card).
function ScoreCard({ card, score }: { card: CardChord; score: number }) {
  return (
    <ChordCard
      chord={card}
      score={score}
      to={`/calibrate/${encodeURIComponent(card.id)}`}
    />
  );
}

export default function CalibrationIndex() {
  const [repertoire] = useRepertoire();
  const [profiles] = useChordProfiles();

  // Repertoire, prioritized: ascending score puts uncalibrated (0) first, then
  // least-calibrated first. Stable sort keeps repertoire order within ties.
  const repItems = repertoire
    .map(c => ({ card: cardFromChord(c), name: c.name, id: c.id, score: profileScore(profiles[c.id]?.samples ?? []) }))
    .sort((a, b) => a.score - b.score);

  const repIds = new Set(repertoire.map(c => c.id));
  const libItems = CHORD_LIBRARY
    .filter(c => !repIds.has(c.id))
    .map(c => ({ card: cardFromLibrary(c), name: c.name, id: c.id, score: profileScore(profiles[c.id]?.samples ?? []) }));

  const nextUp = repItems.find(r => r.score < CAL_MIN_SCORE);

  return (
    <div>
      <div className="row">
        <Link to="/" className="button">← Home</Link>
        <h1 style={{ margin: 0 }}>Calibrate chords</h1>
      </div>
      <p className="muted">
        Teach the app how each chord sounds on your guitar — a higher score means more reliable
        recognition in the mic exercises. Your repertoire is listed by priority (least calibrated first).
      </p>

      {repItems.length > 0 ? (
        <>
          {nextUp && (
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="muted">Next up:</span>
              <Link to={`/calibrate/${encodeURIComponent(nextUp.id)}`} className="button primary">🎯 {nextUp.name}</Link>
            </div>
          )}
          <h3 style={{ marginBottom: 8 }}>Your repertoire</h3>
          <div className="grid">
            {repItems.map(it => <ScoreCard key={it.id} card={it.card} score={it.score} />)}
          </div>
        </>
      ) : (
        <div className="card">
          <p>Your repertoire is empty. <Link to="/routine/new">Learn a chord</Link> — or calibrate any library chord below.</p>
        </div>
      )}

      {libItems.length > 0 && (
        <>
          <h3 style={{ margin: '20px 0 8px' }}>Other chords <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(library)</span></h3>
          <div className="grid">
            {libItems.map(it => <ScoreCard key={it.id} card={it.card} score={it.score} />)}
          </div>
        </>
      )}
    </div>
  );
}
