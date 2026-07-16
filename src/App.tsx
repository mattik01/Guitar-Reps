import { NavLink, Route, Routes } from 'react-router-dom';
import Home from './routes/Home';
import Chords from './routes/Chords';
import Roadmap from './routes/Roadmap';
import Videos from './routes/Videos';
import Repertoire from './routes/Repertoire';
import Progress from './routes/Progress';
import Browse from './routes/Browse';
import Playlists from './routes/Playlists';
import ChordQuizRoutine from './routines/ChordQuizRoutine';
import NewChordRoutine from './routines/NewChordRoutine';
import SwapRoutine from './routines/SwapRoutine';
import StrumRoutine from './routines/StrumRoutine';
import MicTest from './routes/MicTest';
import CalibrationIndex from './routes/CalibrationIndex';
import CalibrationStudio from './routes/CalibrationStudio';

export default function App() {
  return (
    <div className="app">
      <nav className="topnav">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/chords">Chords</NavLink>
        <NavLink to="/roadmap">Roadmap</NavLink>
        <NavLink to="/videos">Videos</NavLink>
        <NavLink to="/repertoire">Repertoire</NavLink>
        <NavLink to="/songs">Songs</NavLink>
        <NavLink to="/browse">Browse</NavLink>
        <NavLink to="/progress">Progress</NavLink>
        <NavLink to="/calibrate">Calibrate</NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chords" element={<Chords />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/videos" element={<Videos />} />
          <Route path="/repertoire" element={<Repertoire />} />
          {/* The playlists page IS the Songs page now (the old standalone Songs list was removed). */}
          <Route path="/songs" element={<Playlists />} />
          <Route path="/playlists" element={<Playlists />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/routine/quiz" element={<ChordQuizRoutine />} />
          <Route path="/routine/new" element={<NewChordRoutine />} />
          <Route path="/routine/swap" element={<SwapRoutine />} />
          <Route path="/routine/strum" element={<StrumRoutine />} />
          <Route path="/mic-test" element={<MicTest />} />{/* debug/calibration, URL-only */}
          <Route path="/calibrate" element={<CalibrationIndex />} />
          <Route path="/calibrate/:chordId" element={<CalibrationStudio />} />
        </Routes>
      </main>
    </div>
  );
}
