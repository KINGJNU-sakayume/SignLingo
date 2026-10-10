import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // Relative assets work at /SignLingo/, custom domains, and local previews.
  base: process.env.VITE_BASE_PATH || './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1400 },
});
