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
     * ── تفکیک باندل (بازنویسی دور ۴۰) ───────────────────────────────────
     * هدف: صفحه‌ی ورود/داشبورد نباید منتظر ۳۵۰KB نمودار بماند.
     *
     * اول با `manualChunks` به اسم «charts» تلاش شد، ولی نتیجه‌اش بدتر بود:
     * باندلر مجبور می‌شد helperهای مشترک interop را در همان چانک بگذارد و
     * باندل اصلی یک `import` ثابت از آن می‌گرفت؛ یعنی ۴۱۳KB نمودار در **هر**
     * بارگذاری دانلود می‌شد (در `index.html` هم `modulepreload` می‌گرفت).
     *
     * حالا فقط react جدا می‌شود و بقیه به تقسیم‌بندی خودکار باندلر سپرده
     * می‌شود. نتیجه‌ی اندازه‌گیری‌شده:
     *   • بارگذاری اولیه: react (~۲۱۴KB) + index (~۱۱۱KB) — نمودار نیست
     *   • چانک نمودار (~۳۵۲KB) فقط با باز شدن داشبورد/راپور می‌آید
     */
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          /* فقط ری‌اکت جدا می‌شود؛ بقیه را به خودِ باندلر می‌سپاریم */
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  base: './',
});
