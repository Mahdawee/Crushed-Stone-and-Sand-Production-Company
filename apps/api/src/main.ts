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
  const webDist = candidates.find((c) => existsSync(join(c, 'index.html')));
  if (webDist) {
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

  const port = Number(process.env.FD_PORT || 4317);
  // loopback only — the office PC is the only machine that may reach the API
  await app.listen(port, process.env.FD_HOST || '127.0.0.1');
  // Printed on purpose: the Tauri shell reads this line to know we are ready.
  console.log(`FARDAY_API_READY http://127.0.0.1:${port}/api  db=${databaseFile()}  data=${dataDir()}`);
}

bootstrap().catch((err) => {
  console.error('FARDAY_API_FATAL', err);
  process.exit(1);
});
