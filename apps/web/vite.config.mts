import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Tauri window loads the built files; during development the same React app
// is served by Vite and proxies /api to the local NestJS process.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.FD_WEB_PORT || 5173),
    strictPort: true,
    // allow the sandbox preview host (and any LAN host name)
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
    proxy: {
      '/api': { target: process.env.FD_API_BASE || 'http://127.0.0.1:4317', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    /*
     * تفکیک وابستگی‌های سنگین از کد برنامه.
     *
     * recharts (و d3 زیرش) فقط در دو صفحه‌ی گزارش لازم است؛ با جدا کردنش،
     * باز شدن صفحه‌ی ورود/داشبورد منتظر ~۴۰۰KB نمودار نمی‌ماند. react هم
     * جدا می‌شود تا در آپدیت‌های بعدی کش آن بماند.
     */
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'charts';
          if (id.includes('react-router')) return 'router';
          if (id.includes('react-dom') || id.includes('/react/')) return 'react';
          return undefined;
        },
      },
    },
  },
  base: './',
});
