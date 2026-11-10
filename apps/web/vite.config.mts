import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Tauri window loads the built files; during development the same React app
// is served by Vite and proxies /api to the local NestJS process.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // allow the sandbox preview host (and any LAN host name)
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  base: './',
});
