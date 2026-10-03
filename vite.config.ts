import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind IPv4 explicitly: on some hosts (Node 24) bare vite binds ::1
    // only, so 127.0.0.1-literal clients (playwright webServer url, the
    // /api proxy target) refuse to connect.
    host: '127.0.0.1',
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
