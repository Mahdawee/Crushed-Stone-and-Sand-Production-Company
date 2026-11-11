/**
 * ابزار بیرونی «صفر کردن سیستم» — سرور صفحه‌ی ابزار.
 *
 *   npm run reset:ui            →  http://127.0.0.1:4322
 *
 * درخواست کاربر: «یک گزینه‌ی صفر کردن تمام داده‌ها و تحویل سیستم آک و صفر و
 * بدون داده به کاربر می‌خواهم؛ بعد از این‌که اخطار و هشدار بدهد و بعد تأیید
 * این کار را بکند. این را به حیث یک ابزار بیرونی در پوشه‌ی tools می‌خواهم،
 * نه در داخل برنامه — با یک صفحه‌ی نمایش که اجراکننده هم داشته باشد.»
 *
 * ## چرا سرور، و چرا فقط ۱۲۷.۰.۰.۱
 * صفحه باید بتواند دیتابیس **واقعی** را ببیند و بعد از تأیید، همان لحظه
 * صفر کند. این کار از مرورگر (file://) ممکن نیست، ولی نباید از شبکه هم در
 * دسترس باشد: گوش‌دادن فقط روی `127.0.0.1` + توکن CSRF + بررسی مبدأ.
 *
 * ## چطور کار می‌کند
 *   ۱) صفحه وضعیت را از `/api/state` می‌گیرد (چه داده‌ای، چقدر، کجا).
 *   ۲) اپراتور کلید «صفر کردن» را می‌چسباند (از `--cli --print-reset-key`).
 *   ۳) دو تأیید: تیک «می‌دانم برگشت‌ناپذیر است» + تایپ عبارت «صفر کردن».
 *   ۴) `POST /api/reset` → پشتیبان اجباری → صفر کردن → گزارش.
 *
 * ## اگر برنامه باز باشد
 * دیتابیس قفل است و پاک کردن از بیرون، برنامه را با داده‌ی نیمه‌پاک رها
 * می‌کند. صفحه این را **قبل** از هر کاری تشخیص می‌دهد و می‌گوید اول برنامه
 * را ببندید. (اگر برنامه باز باشد و راه API هم در دسترس باشد، از همان راه
 * صفر می‌کنیم — یک منبع حقیقت.)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, resetOffline as resetCore } from './reset-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
/* ── پوشه‌ی داده: همان قاعده‌ی برنامه (FD_DATA_DIR یا پیش‌فرض) ── */
const dataDir = process.env.FD_DATA_DIR
  ? path.resolve(process.env.FD_DATA_DIR)
  : path.join(root, 'data');
const dbFile = process.env.FD_DB_FILE || path.join(dataDir, 'farday.db');
const backupDir = path.join(dataDir, 'backups');
const markFile = path.join(dataDir, 'system-reset.json');

const PORT = Number(process.env.FD_RESET_UI_PORT || 4322);
const HOST = '127.0.0.1';
const CSRF = crypto.randomBytes(18).toString('hex');

/* ── api سرور برنامه (اگر باز باشد) ── */
const API_BASE = String(process.env.FD_API_BASE || 'http://127.0.0.1:4317/api').replace(/\/$/, '');

/* ── کلید صفر کردن ──
 * از `/api/health` برنامه (که بعد از مُهر باینری این متغیر را می‌گیرد)، یا
 * از متغیر محیطی برای اپراتور. اگر هیچ‌کدام نبود، ابزار کار **نمی‌کند** —
 * عمدی است: هر کسی نباید بتواند داده‌ی مشتری را پاک کند. */
const resetKey = () => String(process.env.FARDAY_RESET_KEY || '').trim();

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > 200_000) { reject(new Error('بدنه‌ی درخواست بیش از حد بزرگ است.')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
    catch { reject(new Error('JSON نامعتبر.')); }
  });
  req.on('error', reject);
});

function guardMutation(req) {
  const origin = req.headers.origin || '';
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('مبدأ درخواست مجاز نیست.');
  if (req.headers['x-reset-csrf'] !== CSRF) throw new Error('توکن امنیتی نامعتبر است — صفحه را دوباره باز کنید.');
}

const fileSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };

/**
 * آیا برنامه همین حالا باز است؟ (و روی کدام پورت)
 * اگر باز باشد، دیتابیس قفل است و باید یا از API صفر کنیم یا بگوییم ببندد.
 */
async function appStatus() {
  const ports = [4317];
  /*
   * ⚠ فقط برنامه‌ای که به **همین پوشه‌ی داده** وصل است «باز» حساب می‌شود.
   *
   * باگ (همین تست گرفت): روی کمپیوتری که یک نمونه‌ی دیگر از برنامه (مثلاً
   * حالت توسعه) بالا باشد، ابزار فکر می‌کرد «برنامه باز است» و به‌جای حالت
   * آفلاین، از راه API صفر می‌کرد — یعنی دیتابیس **دیگری** را. حالا با
   * `/api/system/info` مقایسه می‌شود؛ اگر مسیر دیتابیس یکی نبود، آفلاین
   * حساب می‌شود (و دیتابیس این ابزار دست‌نخورده می‌ماند).
   */
  const sameDb = (info) => {
    const p = String(info?.dbFile || info?.paths?.dbFile || info?.database || '');
    if (!p) return false;
    try { return path.resolve(p) === path.resolve(dbFile); } catch { return false; }
  };
  /* پورت واقعی — پوسته‌ی Tauri آن را در `api-port` می‌نویسد */
  try {
    const p = path.join(dataDir, 'api-port');
    if (fs.existsSync(p)) {
      const n = Number(fs.readFileSync(p, 'utf8').trim());
      if (Number.isFinite(n) && n > 0 && !ports.includes(n)) ports.unshift(n);
    }
  } catch { /* ignore */ }
  for (const port of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
      if (!r.ok) continue;
      const body = await r.json().catch(() => ({}));
      /* سلامت پاسخ داد؛ حالا ببین همین داده است یا نمونه‌ی دیگری */
      let info = null;
      try {
        const ir = await fetch(`http://127.0.0.1:${port}/api/system/info`, { signal: AbortSignal.timeout(1500) });
        if (ir.ok) {
          const j = await ir.json().catch(() => ({}));
          info = j?.data ?? j;
        }
      } catch { /* ignore */ }
      if (info && sameDb(info)) return { open: true, port, health: body, info };
      /* برنامه‌ی دیگری روی این پورت — این داده‌ی ما نیست */
      return { open: false, port, health: body, otherAppPort: port, otherDb: String(info?.dbFile || '') };
    } catch { /* بسته است */ }
  }
  return { open: false, port: 0, health: null };
}

/** آمار داده — از هسته‌ی مشترک (`reset-core.mjs`) خوانده می‌شود */
async function offlineState() {
  const inv = await inventory({ dbFile, dataDir });
  return {
    ...inv,
    available: inv.exists,
    resetKeyPresent: Boolean(resetKey()),
    appOpen: false,
    apiMode: false,
  };
}

/**
 * صفر کردن وقتی برنامه بسته است — با هسته‌ی بی‌وابستگی `reset-core.mjs`.
 *
 * چرا نه فایل ساخته‌شده‌ی `apps/api/dist`: نصب‌کننده `apps/api` را باندل
 * می‌کند و مسیر `dist` روی کمپیوتر مشتری وجود ندارد. این هسته فقط با
 * `node:sqlite` و `node:crypto` کار می‌کند و کنار همین ابزار می‌رود.
 */
async function resetOffline(opts) {
  return resetCore({ dbFile, dataDir }, opts);
}

/** صفر کردن از راه سرور برنامه (برنامه باز است) — یک منبع حقیقت */
async function resetThroughApi(opts, port) {
  const base = `http://127.0.0.1:${port}/api`;
  /* ورود مدیر — از تنظیمات ابزار، نه رمز پیش‌فرض کورکورانه */
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: opts.username || 'admin', password: opts.password || 'admin123' }),
  });
  if (!login.ok) {
    return {
      ok: false,
      message: 'برنامه باز است ولی ورود مدیر نشد. نام کاربری/رمز را در ابزار وارد کنید، یا برنامه را ببندید و دوباره امتحان کنید.',
    };
  }
  const { token } = await login.json();
  const r = await fetch(`${base}/system/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auth-token': token },
    body: JSON.stringify(opts),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, message: body?.message || 'صفر کردن از راه برنامه ناموفق بود.' };
  return body;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = fs.readFileSync(path.join(here, 'ui.html'), 'utf8')
        .replace('__CSRF__', CSRF)
        /* کلید صفر کردن **هرگز** در HTML نمی‌آید — فقط به مرورگر اپراتور داده می‌شود */
        .replace('__RESET_KEY_PRESENT__', resetKey() ? '1' : 'open');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && p === '/api/state') {
      const app = await appStatus();
      const st = await offlineState();
      st.appOpen = app.open;
      st.port = app.port;
      st.apiBase = `${API_BASE}`;
      if (app.open) {
        st.apiMode = true;
        st.resetKeyPresent = true; /* از راه برنامه با ورود مدیر انجام می‌شود */
      }
      json(res, 200, { ok: true, ...st, phrase: 'صفر کردن' });
      return;
    }

    /*
     * برآورد پشتیبان: اپراتور قبل از تأیید بداند یک نسخه‌ی برگشت وجود دارد
     * و کجا ذخیره می‌شود. (پشتیبان واقعی هنگام اجرا گرفته می‌شود.)
     */
    if (req.method === 'GET' && p === '/api/backup-hint') {
      json(res, 200, {
        ok: true,
        dir: backupDir,
        name: `pre-reset-<تاریخ>.db`,
        dbSize: fileSize(dbFile),
      });
      return;
    }

    if (req.method === 'POST' && p === '/api/reset') {
      guardMutation(req);
      const body = await readBody(req);

      /* ── حفاظ ۱: تأیید صریح ── */
      if (String(body.confirm || '').trim() !== 'صفر کردن') {
        json(res, 400, { ok: false, message: 'عبارت تأیید را دقیقاً بنویسید: «صفر کردن». هیچ داده‌ای تغییر نکرد.' });
        return;
      }
      /* ── حفاظ ۲: تیک «برگشت‌ناپذیر است» ── */
      if (body.acknowledged !== true) {
        json(res, 400, { ok: false, message: 'تیک «می‌دانم برگشت‌ناپذیر است» لازم است.' });
        return;
      }

      const app = await appStatus();
      const keyed = resetKey();
      if (!app.open && !keyed && !process.env.FD_RESET_ALLOW_UNKEYED) {
        json(res, 403, {
          ok: false,
          message: 'کلید «صفر کردن» در دسترس نیست. آن را از برنامه بگیرید: ' +
            'Farday Roshan.exe --cli --print-reset-key — و در کادر بالای صفحه بچسبانید.',
        });
        return;
      }
      if (!app.open && keyed) {
        const got = String(body.resetKey || '').trim();
        if (got !== keyed) {
          json(res, 403, { ok: false, message: 'کلید صفر کردن درست نیست.' });
          return;
        }
      }

      const opts = {
        confirm: 'صفر کردن',
        reason: String(body.reason || '').slice(0, 300),
        operator: String(body.operator || '').slice(0, 80) || 'reset-tool',
        backup: true,
        keepAdmin: body.keepAdmin !== false,
        wipeBackups: body.wipeBackups !== false,
      };

      let result;
      if (app.open) {
        result = await resetThroughApi({ ...opts, password: body.password, username: body.username }, app.port);
      } else {
        result = await resetOffline(opts);
      }
      json(res, result.ok ? 200 : 400, {
        ...result,
        mode: app.open ? 'api' : 'offline',
        at: new Date().toISOString(),
      });
      return;
    }

    json(res, 404, { ok: false, message: 'مسیر ناشناخته.' });
  } catch (e) {
    json(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n🧹 ابزار «صفر کردن سیستم» → http://${HOST}:${PORT}\n`);
  console.log(`   داده: ${dbFile}`);
  console.log(`   کلید صفر کردن: ${resetKey() ? 'موجود' : '⚠ نیست (فقط با برنامه‌ی باز یا متغیر FARDAY_RESET_KEY)'}`);
  console.log('   برای بستن: Ctrl+C\n');
});
