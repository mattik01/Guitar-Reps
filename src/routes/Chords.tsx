import { LibraryChordGrid } from '../components/LibraryChordGrid';
import { CHORD_LIBRARY } from '../data/chordLibrary';

export default function Chords() {
  return (
    <div>
      <div className="row">
        <h1>Chords</h1>
      </div>
      <p className="muted">
        Chord categories, ordered from easiest to most advanced, following the guitar roadmap.
      </p>

      <LibraryChordGrid chords={CHORD_LIBRARY} showEmptyCategories />
    </div>
  );
}
