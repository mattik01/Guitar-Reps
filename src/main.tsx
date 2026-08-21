import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { retirePassiveCalibration } from './state/store';
import './styles.css';

// Runs at module scope, before the first render — a store write during render
// would fan setState out to sibling subscribers.
retirePassiveCalibration();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
