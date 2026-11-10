import { Controller, Get, Header, Req } from '@nestjs/common';
import { Public } from '../common/auth';
import { databaseFile } from '../db';
import { settingsService } from '../common/settings';
import { ROUTES, renderLanding } from '../common/landing';
import { uiState } from '../common/ui-state';

/**
 * Friendly landing page for the API root.
 *
 * Opening http://127.0.0.1:4317/api in a browser used to show a raw
 * "Cannot GET /api" error. Now it explains — in Dari — that this address is
 * the internal service and that the program itself lives at "/".
 */
@Controller()
export class RootController {
  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async root(@Req() req: any) {
    let calendar = 'jalali';
    try { calendar = await settingsService.calendar(); } catch { /* ignore */ }

    const info = {
      ok: true,
      name: 'FARDAY ROSHAN — local API',
      message:
        'این آدرس، سرویس داخلی برنامه است و به‌تنهایی صفحه‌ای برای نمایش ندارد. خود برنامه را از آدرس / باز کنید.',
      openApp: '/',
      login: 'POST /api/auth/login  { "username": "admin", "password": "admin123" }',
      defaultUser: 'admin / admin123',
      calendar,
      uiReady: uiState.uiReady,
      database: databaseFile(),
      version: '0.1.0',
      routes: Object.fromEntries(ROUTES.map(([path, desc]) => [path, desc])),
    };

    // A browser asks for HTML; API clients get JSON.
    const wantsHtml = String(req.headers?.accept || '').includes('text/html');
    if (!wantsHtml) return info;

    return renderLanding({
      uiReady: info.uiReady,
      calendar,
      requestedPath: '/api',
      database: databaseFile(),
    });
  }
}
