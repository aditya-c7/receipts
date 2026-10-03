import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // onnxruntime-web (lazy OCR chunk only) resolves its .wasm sibling via
    // import.meta.url. esbuild pre-bundling corrupts that in dev (the .wasm
    // URL serves HTML -> "expected magic word" at instantiate), so the dep
    // stays unbundled on the dev server. Production builds are unaffected
    // (rollup emits the real .wasm into dist/assets).
    exclude: ['onnxruntime-web'],
  },
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
