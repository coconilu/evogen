import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Fixed port so the Tauri devUrl is stable across machines.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
