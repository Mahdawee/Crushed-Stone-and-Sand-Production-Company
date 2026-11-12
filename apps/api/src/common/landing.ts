import { databaseFile } from '../db';

/**
 * Addresses of the internal service — shown on the landing page.
 */
export const ROUTES: Array<[string, string]> = [
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

export type LandingOptions = {
  /** true when the built React app is being served at "/" */
  uiReady: boolean;
  /** the path the visitor actually asked for (shown when it does not exist) */
  requestedPath?: string;
  calendar?: string;
  user?: string;
  database?: string;
};

/**
 * A single Persian page used for every "you opened the wrong address" case:
 *
 *  • /api          — the internal service root
 *  • /             — when the UI build is missing
 *  • /api/whatever — an address that does not exist
 *
 * Without it the browser shows raw `{"message":"Cannot GET /"}` JSON, which
 * looks like a broken program while everything is actually fine.
 */
export function renderLanding(opts: LandingOptions): string {
  const uiReady = opts.uiReady;
  const missing = opts.requestedPath && opts.requestedPath !== '/';
  const db = opts.database || databaseFile();
  const user = opts.user || 'admin / admin123';

  const headline = missing
    ? 'این آدرس وجود ندارد'
    : uiReady
      ? 'سرویس داخلی شرکت فردای روشن'
      : 'شرکت فردای روشن';

  const note = missing
    ? `آدرس <code dir="ltr">${escapeHtml(opts.requestedPath || '')}</code> در این برنامه پیدا نشد.
       اگر خود برنامه را می‌خواهید، دکمه زیر را بزنید.`
    : uiReady
      ? `آدرسی که باز کرده‌اید <code dir="ltr">/api</code> است و <b>سرویس داخلی</b> برنامه می‌باشد، نه رابط کاربری.
         برای دیدن خود برنامه، دکمه زیر را بزنید.`
      : `رابط کاربری (فایل‌های <code dir="ltr">apps/web/dist</code>) ساخته نشده است، بنابراین آدرس
         <code dir="ltr">/</code> چیزی برای نمایش ندارد — ولی خود برنامه سالم است.
         برای ساخت رابط: <code dir="ltr">npm run build -w @farday/web</code> و بعد برنامه را دوباره باز کنید.
         <br>در حالت توسعه، رابط روی آدرس <code dir="ltr">http://localhost:5173</code> است.`;

  const rows = ROUTES.map(([p, d]) => `<tr><td class="p">${p}</td><td>${d}</td></tr>`).join('');

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${headline}</title>
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
          padding: 9px 18px; border-radius: 10px; font-weight: 700; font-size: .9rem; margin-inline-end: 8px; }
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
  <h1>${headline}</h1>
  <p class="small">این صفحه فقط برای اطلاع است — برنامه در حال کار است.</p>
  <div class="note">${note}</div>
  ${uiReady ? '<a class="btn" href="/">رفتن به برنامه ←</a>' : ''}
  <a class="btn" href="/api/health" style="background:#3f5a68">بررسی سلامت سرویس</a>
  <p class="small" style="margin-top:16px">کاربر پیش‌فرض: <code>${user}</code><br>
  فایل دیتابیس: <span dir="ltr" class="p">${escapeHtml(db)}</span>
  ${opts.calendar ? `<br>تقویم: <code>${opts.calendar === 'gregorian' ? 'میلادی' : 'هجری شمسی'}</code>` : ''}</p>
  <h1 style="font-size:1rem;margin-top:22px">آدرس‌های سرویس</h1>
  <table>${rows}</table>
  <p class="small" style="margin-top:14px">آدرس خود برنامه: <code dir="ltr">/</code> — در حالت توسعه: <code dir="ltr">http://localhost:5173</code></p>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
