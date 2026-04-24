import { NavLink, Route, Routes } from 'react-router-dom';
import Home from './routes/Home';
import Repertoire from './routes/Repertoire';
import Progress from './routes/Progress';
import Songs from './routes/Songs';
import ChordQuizRoutine from './routines/ChordQuizRoutine';
import NewChordRoutine from './routines/NewChordRoutine';
import SwapRoutine from './routines/SwapRoutine';
import StrumRoutine from './routines/StrumRoutine';

export default function App() {
  return (
    <div className="app">
      <nav className="topnav">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/repertoire">Repertoire</NavLink>
        <NavLink to="/songs">Songs</NavLink>
        <NavLink to="/progress">Progress</NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/repertoire" element={<Repertoire />} />
          <Route path="/songs" element={<Songs />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/routine/quiz" element={<ChordQuizRoutine />} />
          <Route path="/routine/new" element={<NewChordRoutine />} />
          <Route path="/routine/swap" element={<SwapRoutine />} />
          <Route path="/routine/strum" element={<StrumRoutine />} />
        </Routes>
      </main>
    </div>
  );
}
