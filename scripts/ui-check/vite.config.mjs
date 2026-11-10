import path from 'node:path';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export default {
  root,
  configFile: false,
  logLevel: 'silent',
  plugins: [react()],
  resolve: {
    /* در تست، lib/session را با نسخه ساختگی عوض می‌کنیم تا Layout بدون شبکه mount شود */
    alias: [
      { find: /^.*\/lib\/session$/, replacement: path.join(root, 'scripts/ui-check/session-mock.tsx') },
    ],
  },
  build: {
    outDir: path.join(root, 'scripts/ui-check/.out-sidebar'),
    emptyOutDir: true,
    minify: false,
    lib: { entry: path.join(root, 'scripts/ui-check/entry.tsx'), formats: ['es'], fileName: () => 'bundle.mjs' },
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react-router-dom', 'recharts'] },
  },
};
