import { Controller, Get, Header, Req } from '@nestjs/common';
import { Public } from '../common/auth';
import { databaseFile } from '../db';
import { settingsService } from '../common/settings';

const ROUTES = [
  ['GET  /api/health', 'بررسی سلامت سرویس'],
  ['POST /api/auth/login', 'ورود (username / password)'],
  ['GET  /api/company', 'مشخصات شرکت'],
  ['GET  /api/employees', 'کارمندان'],
  ['GET  /api/attendance?month=1405-08', 'حضور و غیاب ماهانه'],
  ['GET  /api/customers', 'مشتریان + باقی مانده بدهی'],
  ['GET  /api/sales', 'فروشات'],
  ['GET  /api/receipts', 'رسیدات'],
  ['GET  /api/expenses', 'مصارف'],
  ['GET  /api/salaries/sheet?month=1405-08', 'ورق معاش'],
  ['GET  /api/reports/dashboard', 'داشبورد'],
  ['GET  /api/reports/daily', 'راپور روزانه'],
  ['GET  /api/reports/monthly', 'راپور ماهانه'],
  ['GET  /api/reports/yearly', 'راپور سالانه'],
  ['GET  /api/system/health', 'وضعیت دیتابیس'],
];

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
      message: 'این آدرس، سرویس داخلی برنامه است و به‌تنهایی صفحه‌ای برای نمایش ندارد. خود برنامه را از آدرس / باز کنید.',
      openApp: '/',
      login: 'POST /api/auth/login  { "username": "admin", "password": "admin123" }',
      defaultUser: 'admin / admin123',
      calendar,
      database: databaseFile(),
      version: '0.1.0',
      routes: Object.fromEntries(ROUTES.map(([path, desc]) => [path, desc])),
    };

    // A browser asks for HTML; API clients get JSON.
    const wantsHtml = String(req.headers?.accept || '').includes('text/html');
    if (!wantsHtml) return info;

    const rows = ROUTES.map(([p, d]) => `<tr><td class="p">${p}</td><td>${d}</td></tr>`).join('');
    return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>سرویس داخلی فردای روشن</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f4f6f8; color: #16232e;
         margin: 0; padding: 28px 16px; line-height: 1.9; }
  .card { max-width: 820px; margin: 0 auto; background: #fff; border: 1px solid #e2e8ee;
          border-radius: 16px; padding: 24px 26px; box-shadow: 0 12px 40px -24px rgba(16,32,46,.4); }
  h1 { font-size: 1.2rem; margin: 0 0 6px; }
  .logo { width: 46px; height: 46px; border-radius: 13px; background: linear-gradient(135deg,#14b8a6,#0b4f4a);
          color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 20px; margin-bottom: 12px; }
  .note { background: #ccfbf1; border: 1px solid #99f6e4; color: #0b5b55; padding: 12px 14px;
          border-radius: 11px; font-size: .9rem; margin: 14px 0 18px; }
  a.btn { display: inline-block; background: #0f766e; color: #fff; text-decoration: none;
          padding: 9px 18px; border-radius: 10px; font-weight: 700; font-size: .9rem; }
  table { width: 100%; border-collapse: collapse; font-size: .82rem; margin-top: 8px; }
  td { border-bottom: 1px solid #eef2f5; padding: 6px 8px; }
  td.p { font-family: ui-monospace, Consolas, monospace; direction: ltr; text-align: left; color: #0f766e; white-space: nowrap; }
  code { background: #f1f5f8; padding: 1px 5px; border-radius: 5px; font-size: .8rem; }
  .small { font-size: .8rem; color: #6b7a88; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1418; color: #e7eef3; } .card { background: #131e25; border-color: #23323d; }
    .note { background: #103c3a; border-color: #14524c; color: #8ff0e2; }
    table td { border-color: #23323d; } code { background: #182530; } .small { color: #8b98a5; }
  }
</style></head>
<body><div class="card">
  <div class="logo">ف</div>
  <h1>سرویس داخلی شرکت فردای روشن</h1>
  <p class="small">این صفحه فقط برای اطلاع است — همه چیز درست کار می‌کند.</p>
  <div class="note">
    آدرسی که باز کرده‌اید <code>/api</code> است و <b>سرویس داخلی</b> برنامه می‌باشد، نه رابط کاربری.
    برای دیدن خود برنامه، دکمه زیر را بزنید (یا در پنجره برنامه، از منو استفاده کنید).
  </div>
  <a class="btn" href="/">رفتن به برنامه ←</a>
  <p class="small" style="margin-top:16px">کاربر پیش‌فرض: <code>admin</code> — رمز: <code>admin123</code><br>
  فایل دیتابیس: <span dir="ltr" class="p">${databaseFile()}</span></p>
  <h1 style="font-size:1rem;margin-top:22px">آدرس‌های سرویس</h1>
  <table>${rows}</table>
</div></body></html>`;
  }
}
