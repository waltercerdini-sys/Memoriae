import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // In sviluppo le chiamate al server passano dallo stesso indirizzo dell'app (cookie e passkey sullo stesso dominio).
    proxy: {
      '/v1': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
