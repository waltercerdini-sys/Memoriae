// Caratteri ospitati da noi: nessuna richiesta a Google quando si apre l'app.
import '@fontsource/domine/400.css';
import '@fontsource/domine/700.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './pianoScelto';
import { App } from './App';
import { CartaToccata } from './CartaMemoriae';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/c' ? (
      // Carta MEMORIAE avvicinata a un telefono: pagina pubblica, senza accesso.
      <div className="pagina">
        <header className="testata">
          <span className="marchio">MEMORIAE</span>
        </header>
        <main className="contenuto">
          <CartaToccata />
        </main>
      </div>
    ) : (
      <App />
    )}
  </StrictMode>,
);
