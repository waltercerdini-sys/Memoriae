import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// npm run prova può scegliere altre porte se quelle abituali sono occupate da un altro programma.
const portaServer = process.env.MEMORIAE_SERVER_PORT ?? '3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.MEMORIAE_WEB_PORT ?? 5173),
    strictPort: true,
    // In sviluppo le chiamate al server passano dallo stesso indirizzo dell'app (cookie e passkey sullo stesso dominio).
    proxy: {
      '/v1': `http://localhost:${portaServer}`,
      '/health': `http://localhost:${portaServer}`,
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
