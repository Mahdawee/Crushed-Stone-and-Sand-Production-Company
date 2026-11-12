import path from 'node:path';
import { projectRoot } from '../../scripts/lib/project-root.mjs';
import react from '@vitejs/plugin-react';

/* همان کمکی که doctor استفاده می‌کند — `new URL().pathname` روی ویندوز
   `C:\C:\...` می‌سازد. */
const root = projectRoot(import.meta.url, 2);

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
