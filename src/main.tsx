import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ensureSeeded } from './db/seed';

// Seed the demo dataset on a brand new device before the first render, so the
// app never opens on an empty, unexplainable screen.
void ensureSeeded().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
