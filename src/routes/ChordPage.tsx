import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChordView } from '../components/ChordView';

// /chords/:chordId — the same ChordView the ?chord= overlay renders, as a real
// page. This is the deep-link/back-link target (bookmarks, the calibration
// studio, anything outside the SPA); in-app clicks use the overlay so you never
// lose your place.
export default function ChordPage() {
  const { chordId } = useParams();
  const navigate = useNavigate();
  if (!chordId) return null;
  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Link to="/chords" className="button">← All chords</Link>
      </div>
      <div className="card">
        <ChordView chordId={decodeURIComponent(chordId)} showClose={false} onClose={() => navigate('/chords')} />
      </div>
    </div>
  );
}
