// Caratteri ospitati da noi: nessuna richiesta a Google quando si apre l'app.
import '@fontsource/domine/400.css';
import '@fontsource/domine/700.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
