import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export default {
  root, configFile: false, logLevel: 'silent',
  build: {
    outDir: path.join(root, 'scripts/ui-check/.out-theme'), emptyOutDir: true, minify: false,
    lib: { entry: path.join(root, 'scripts/ui-check/theme-entry/session.tsx'), formats: ['es'], fileName: () => 'session.mjs' },
    rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime'] },
  },
};
