import { Navigate, Route, Routes } from 'react-router-dom';
import { AppNav } from './components/AppNav';
import { PaintLayer } from './components/PaintLayer';
import Home from './routes/Home';
import Exercise from './routes/Exercise';
import Chords from './routes/Chords';
import ChordPage from './routes/ChordPage';
import { ChordViewOverlay } from './components/ChordView';
import Songs from './routes/Songs';
import Roadmap from './routes/Roadmap';
import Videos from './routes/Videos';
import ChordQuizRoutine from './routines/ChordQuizRoutine';
import NewChordRoutine from './routines/NewChordRoutine';
import SwapRoutine from './routines/SwapRoutine';
import StrumRoutine from './routines/StrumRoutine';
import PickRoutine from './routines/PickRoutine';
import PickIndex from './routes/PickIndex';
import MicTest from './routes/MicTest';
import PickLab from './routes/PickLab';
import CalibrationStudio from './routes/CalibrationStudio';

export default function App() {
  return (
    <div className="app">
      {/* Texture only — rendered once for the whole app. */}
      <PaintLayer />
      <AppNav />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/exercise" element={<Exercise />} />
          {/* One library; owning a chord is a state of its card, not a tab. */}
          <Route path="/chords" element={<Chords />} />
          {/* The same ChordView the ?chord= overlay renders, as a real page. */}
          <Route path="/chords/:chordId" element={<ChordPage />} />
          {/* Songs owns both your playlists and the catalog browser, as ?tab=. */}
          <Route path="/songs" element={<Songs />} />
          {/* The learning path; the video list hangs off it, not off the nav. */}
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/videos" element={<Videos />} />
          {/* No Calibrate tab: the Studio is reached from a chord's mic ring,
              which is on every chord card and in the chord view. */}
          <Route path="/calibrate/:chordId" element={<CalibrationStudio />} />

          <Route path="/routine/quiz" element={<ChordQuizRoutine />} />
          <Route path="/routine/new" element={<NewChordRoutine />} />
          <Route path="/routine/swap" element={<SwapRoutine />} />
          <Route path="/routine/strum" element={<StrumRoutine />} />
          {/* The picking ladder is a catalog; each exercise gets its own screen. */}
          <Route path="/routine/pick" element={<PickIndex />} />
          <Route path="/routine/pick/:exerciseId" element={<PickRoutine />} />
          <Route path="/mic-test" element={<MicTest />} />{/* debug/calibration, URL-only */}
          <Route path="/pick-test" element={<PickLab />} />{/* single-pluck bench, URL-only */}

          {/* Pre-restructure URLs — keep old bookmarks landing on the right sub-tab. */}
          <Route path="/repertoire" element={<Navigate to="/chords" replace />} />
          <Route path="/browse" element={<Navigate to="/songs?tab=browse" replace />} />
          <Route path="/playlists" element={<Navigate to="/songs" replace />} />
          <Route path="/progress" element={<Navigate to="/" replace />} />
          <Route path="/calibrate" element={<Navigate to="/chords" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {/* Any page can open a chord in place via ?chord= — see ChordLink. */}
      <ChordViewOverlay />
    </div>
  );
}
