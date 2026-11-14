import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// npm run prova può scegliere altre porte se quelle abituali sono occupate da un altro programma.
const portaServer = process.env.MEMORIAE_SERVER_PORT ?? '3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.MEMORIAE_WEB_PORT ?? 5173),
    strictPort: true,
    // Con npm run prova nessun ricaricamento automatico della pagina: ricaricare chiude la cassaforte
    // (la chiave vive solo in memoria) e a chi prova sembra che l'app si sia chiusa da sola.
    hmr: process.env.MEMORIAE_PROVA ? false : undefined,
    // In sviluppo le chiamate al server passano dallo stesso indirizzo dell'app (cookie e passkey sullo stesso dominio).
    proxy: {
      '/v1': `http://localhost:${portaServer}`,
      '/health': `http://localhost:${portaServer}`,
    },
  },
  // Dipendenze preparate all'avvio, così Vite non deve ricaricare la pagina a metà sessione.
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
  build: { target: 'es2022', sourcemap: true },
});
