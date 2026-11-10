import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ensureSchemaAsync } from './schema';
import { ensureDefaultAdmin } from './common/auth';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as express from 'express';
import { databaseFile, dataDir } from './db';
import { renderLanding } from './common/landing';
import { NotFoundFilter } from './common/not-found.filter';
import { uiState } from './common/ui-state';

/**
 * Entry point of the internal API.
 *
 *  • Desktop: the Tauri shell starts `farday-api` and waits for the port.
 *  • Dev:     `npm run dev` (vite proxy forwards /api → 127.0.0.1:4317)
 */
/**
 * حالت نجات: `app.js --recovery …`
 *
 * پوسته‌ی Tauri هنگام بروز مشکل یک دکمه‌ی «ابزار نجات» نشان می‌دهد که
 * همین فرآیند را با `--recovery` اجرا می‌کند (و پنجره‌ی کنسول باز می‌ماند).
 * بدون این، اگر رمز مدیر فراموش می‌شد تنها راه «نصب مجدد و از دست دادن
 * داده» بود — روی یک برنامه‌ی آفلاین که هیچ پشتیبانی آنلاینی ندارد.
 */
async function runRecovery() {
  await import('./cli/recovery');
}

async function bootstrap() {
  await ensureSchemaAsync();
  await ensureDefaultAdmin();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.set('trust proxy', true);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));
  app.enableCors({ origin: true });
  app.useGlobalFilters(new NotFoundFilter());

  // Single-origin serving: the built React app (apps/web/dist) is served by the
  // very same local process, so the desktop window only talks to one address.
  const candidates = [
    process.env.FD_WEB_DIST,
    join(__dirname, 'web'),            // packaged: <api>/web
    join(__dirname, '..', '..', 'web', 'dist'), // dev: apps/api/dist → apps/web/dist
    join(__dirname, '..', 'web', 'dist'),
  ].filter(Boolean) as string[];
  const devMode = process.env.FD_DEV_MODE === '1';
  const devUiUrl = `http://localhost:${process.env.FD_WEB_PORT || 5173}/`;
  /* در حالت توسعه، رابط کاربری را Vite می‌سازد؛ build قدیمی را سرو نمی‌کنیم تا
     کاربر نسخه کهنه نبیند و به‌جای آن به آدرس Vite هدایت می‌شود. */
  const webDist = devMode ? undefined : candidates.find((c) => existsSync(join(c, 'index.html')));
  if (devMode) {
    const bare: any = app.getHttpAdapter().getInstance();
    bare.get('/', (req: any, res: any) => {
      if (!String(req.headers?.accept || '').includes('text/html')) {
        return res.json({ ok: true, dev: true, ui: devUiUrl, api: '/api' });
      }
      res.redirect(302, devUiUrl);
    });
  } else if (webDist) {
    // register the static handler on the underlying express instance so it is
    // not affected by Nest's global prefix / router ordering
    const expressApp: any = app.getHttpAdapter().getInstance();
    expressApp.use(express.static(webDist, { index: false, fallthrough: true }));
    app.use((req: any, res: any, next: any) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      // never answer API/asset paths with the HTML shell
      if (/\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
      res.sendFile(join(webDist, 'index.html'));
    });
    console.log(`FARDAY_WEB_READY ${webDist}`);
  } else {
    console.warn('FARDAY_WEB_MISSING  رابط کاربری ساخته نشده — npm run build -w @farday/web');
    // No UI build: make "/" explain the situation instead of 404-ing.
    const bare: any = app.getHttpAdapter().getInstance();
    bare.get('/', (req: any, res: any) => {
      if (!String(req.headers?.accept || '').includes('text/html')) {
        return res.json({ ok: false, uiReady: false, message: 'UI not built', api: '/api', health: '/api/health' });
      }
      res
        .status(503)
        .type('html')
        .set('Cache-Control', 'no-store')
        .send(renderLanding({ uiReady: false, requestedPath: '/', database: databaseFile() }));
    });
  }
  uiState.uiReady = Boolean(webDist);

  const host = process.env.FD_HOST || '127.0.0.1';
  /* FD_PORT=0 یعنی «هر پورت آزادی» — پوسته‌ی Tauri وقتی ۴۳۱۷ اشغال باشد
     همین را می‌فرستد (باگی که برنامه را روی بعضی کمپیوترها بی‌استفاده
     می‌کرد). در غیر این صورت همان پورت ثابت. */
  const requested = Number(process.env.FD_PORT ?? 4317);
  const port = await listenWithFallback(app, host, Number.isFinite(requested) ? requested : 4317);

  /*
   * پورت واقعی را **همیشه** اعلام می‌کنیم: پوسته‌ی Tauri همین خط را از
   * `api.log` می‌خواند و پنجره را به همان آدرس می‌برد. یک منبع حقیقت.
   */
  console.log(`FARDAY_PORT ${port}`);
  // Always tell the human where the app is. In dev the Vite server serves the UI;
  // otherwise this very process serves the built app.
  if (process.env.FD_DEV_MODE === '1') {
    console.log(`FARDAY_OPEN_UI http://localhost:${process.env.FD_WEB_PORT || 5173}/`);
  } else if (webDist) {
    console.log(`FARDAY_OPEN_UI http://${host}:${port}/`);
  }
  // Printed on purpose: the Tauri shell reads this line to know we are ready.
  console.log(`FARDAY_API_READY http://127.0.0.1:${port}/api  db=${databaseFile()}  data=${dataDir()}`);
}

/**
 * Listen with a graceful fallback when the port is taken.
 *
 * باگ (بازرسی بسته‌بندی): اگر پورت ۴۳۱۷ توسط برنامه‌ی دیگری گرفته می‌شد،
 * فرآیند با EADDRINUSE می‌مرد و کاربر فقط «برنامه باز نشد» می‌دید. حالا:
 *   • پورت ۰ → خود سیستم‌عامل یک پورت آزاد می‌دهد (حالت معمول دسکتاپ)
 *   • پورت مشخص ولی اشغال → ۲۰ پورت بعدی امتحان می‌شود
 * و در هر دو حالت یک خط «کدام پورت» لاگ می‌شود.
 */
async function listenWithFallback(
  app: NestExpressApplication,
  host: string,
  requested: number,
): Promise<number> {
  const tryListen = (p: number) =>
    app.listen(p, host).then(() => (app.getHttpServer().address() as any)?.port ?? p);

  if (requested === 0) return tryListen(0);

  try {
    return await tryListen(requested);
  } catch (err: any) {
    if (err?.code !== 'EADDRINUSE') throw err;
    console.warn(`FARDAY_PORT_BUSY ${requested} — جستجوی پورت آزاد بعدی…`);
    for (let p = requested + 1; p <= requested + 20; p++) {
      try {
        return await tryListen(p);
      } catch (e: any) {
        if (e?.code !== 'EADDRINUSE') throw e;
      }
    }
    console.error(`FARDAY_PORT_BUSY_ALL پورت‌های ${requested}..${requested + 20} اشغال‌اند.`);
    throw err;
  }
}

const entry = process.argv.includes('--recovery') ? runRecovery() : bootstrap();
entry.catch((err) => {
  console.error('FARDAY_API_FATAL', err);
  process.exit(1);
});
