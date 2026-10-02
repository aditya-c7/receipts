import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    // NOTE: add an `ocr` manualChunk for tesseract.js once the UI lazily
    // imports lib/ocr/engine.ts (keeps first-load JS < 150 kB gz).
  },
});
