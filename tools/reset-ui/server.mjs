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
 *   ۲) اپراتور تیک «می‌دانم برگشت‌ناپذیر است» را می‌زند و عبارت «صفر کردن» را
 *      تایپ می‌کند؛ همین دو کافی است — **کلید لازم نیست**.
 *   ۳) `POST /api/reset` → پشتیبان اجباری → صفر کردن → گزارش.
 *
 * ## چرا کلید برداشته شد (درخواست صریح کاربر)
 *   «برای reset کردن سیستم توسط این ابزار باید کلید نیاز نباشد و فقط با
 *   تایید متنی … بتوانم برنامه را reset کنم.»
 *   ابزار فقط روی `127.0.0.1` گوش می‌دهد و همان کمپیوتر مالک داده است؛ کلید
 *   فقط یک مانع اضافه بود که کاربر با کاپی‌کردن متن از خط فرمان دور می‌زد.
 *   اکنون محافظ‌ها: فقط همین کمپیوتر (۱۲۷.۰.۰.۱ + بررسی مبدأ + توکن CSRF)،
 *   عبارت تأیید متنی، تیک برگشت‌ناپذیری، و **پشتیبان اجباری قبل از هر کاری**.
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
import { inventory, preflight as preflightCore, resetOffline as resetCore, runtimeInfo } from './reset-core.mjs';
import { resolveDataDir } from './data-dir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
/*
 * ── پوشه‌ی داده (شکار باگ دور ۳۴) ───────────────────────────────────────
 * پیش‌تر فقط `FD_DATA_DIR` یا `data/` کنار مخزن. روی کمپیوتر مشتری برنامه
 * **نصب‌شده** است و داده در `%APPDATA%\af.farday.roshan` — یعنی ابزار همان
 * جایی را که باید، نمی‌گشت و صفحه می‌گفت «داده‌ای نیست» در حالی که مشتری
 * یک سال داده داشت. حالا `data-dir.mjs` نسخه‌ی نصب‌شده را خودش پیدا می‌کند
 * (و `--data-dir` / `FD_RESET_DATA_DIR` هم پذیرفته می‌شود).
 */
const resolved = resolveDataDir({ root });
const dataDir = resolved.dataDir;
const dbFile = resolved.dbFile;
const backupDir = path.join(dataDir, 'backups');
const markFile = path.join(dataDir, 'system-reset.json');

const PORT = Number(process.env.FD_RESET_UI_PORT || 4322);
const HOST = '127.0.0.1';
const CSRF = crypto.randomBytes(18).toString('hex');

/* ── api سرور برنامه (اگر باز باشد) ── */
const API_BASE = String(process.env.FD_API_BASE || 'http://127.0.0.1:4317/api').replace(/\/$/, '');

/*
 * ── حذف «کلید صفر کردن» ──────────────────────────────────────────────
 *
 * قبلاً این ابزار بدون کلیدِ مُهرشده در باینری کار نمی‌کرد و اپراتور باید
 * `Farday Roshan.exe --cli --print-reset-key` را اجرا و خروجی را کاپی می‌کرد.
 * درخواست کاربر: «کلید نیاز نباشد و فقط با تایید متنی … reset کنم».
 * کلید حذف شد؛ عوضش چیزی که واقعاً امنیت می‌دهد تقویت شد:
 *   • گوش‌دادن فقط روی ۱۲۷.۰.۰.۱ (از شبکه در دسترس نیست)
 *   • بررسی مبدأ (Origin) + توکن CSRF برای هر POST
 *   • عبارت تأیید متنی «صفر کردن» + تیک برگشت‌ناپذیری
 *   • پشتیبان اجباری قبل از پاک‌سازی
 * اگر کسی این صفحه را روی همان کمپیوتر باز کند، مالکِ داده است — کلید
 * مانع مهاجم نمی‌شد، فقط اپراتور را اذیت می‌کرد.
 */

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

/*
 * خواندن بدنه، با سقفِ حجم.
 *
 * ── باگ (شکار باگ دور ۳۰) ────────────────────────────────────────────────
 * در نسخه‌ی قبلی بعد از رد کردن بدنه‌ی بزرگ فقط `req.destroy()` صدا زده
 * می‌شد و پرامیس **هیچ‌وقت** settle نمی‌شد: پاسخ HTTP فرستاده نمی‌شد، اتصال
 * نیمه‌باز می‌ماند و در بدترین حالت یک درخواست بزرگ، سرور را در حالت معلق
 * نگه می‌داشت. حالا پرامیس رد می‌شود، خواندن متوقف می‌شود (نه کشتن
 * سوکت) تا سرور بتواند پاسخ ۴۰۰ را بفرستد.
 */
const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  let settled = false;
  const chunks = [];
  const fail = (msg) => {
    if (settled) return;
    settled = true;
    chunks.length = 0;
    try { req.pause(); } catch { /* ignore */ }
    reject(new Error(msg));
  };
  req.on('data', (c) => {
    if (settled) return;
    size += c.length;
    /* سقف ۲۰۰ کیلوبایت — بدنه‌های این ابزار چند صد بایت‌اند */
    if (size > 200_000) { fail('بدنه‌ی درخواست بیش از حد بزرگ است.'); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (settled) return;
    settled = true;
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
    catch { reject(new Error('JSON نامعتبر.')); }
  });
  req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
  req.on('aborted', () => { if (!settled) { settled = true; reject(new Error('درخواست نیمه‌کاره قطع شد.')); } });
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
  /* بررسی آمادگی دیتابیس **قبل** از نمایش دکمه‌ی «صفر کردن». اگر ابزار
     بگذارد کاربر تأیید کند و بعد وسط کار بشکند، داده پاک شده و کاربر مانده
     (همان باگ `isWalkIn`). حالا از اول معلوم است. */
  let pre = { ok: true, problems: [] };
  if (inv.exists) {
    try { pre = await preflightCore({ dbFile }); }
    catch (e) { pre = { ok: false, problems: [String(e?.message || e)] }; }
  }
  return {
    ...inv,
    preflight: pre,
    /* کجاها گشته شد — اپراتور باید ببیند، نه این‌که کورکورانه اعتماد کند */
    dataSource: resolved.source,
    dataDirExplicit: resolved.explicit,
    searched: resolved.searched,
    note: resolved.note || '',
    available: inv.exists,
    /* دیگر کلیدی در کار نیست — برای سازگاری با UI قدیمی همیشه true */
    resetKeyPresent: true,
    keyRequired: false,
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
  /*
   * باگ (شکار باگ دور ۳۰): در خطا فقط `message` برگردانده می‌شد و
   * `rolledBack`/`backupFile` — که سرور برنامه حالا می‌فرستد — دور ریخته
   * می‌شد. اپراتور نمی‌فهمید داده سالم برگشته یا باید پشتیبان را دستی
   * بازگرداند. حالا کل بدنه پاس داده می‌شود.
   */
  if (!r.ok) {
    return {
      ...body,
      ok: false,
      mode: 'api',
      message: body?.message || 'صفر کردن از راه برنامه ناموفق بود.',
    };
  }
  return { ...body, mode: 'api' };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = fs.readFileSync(path.join(here, 'ui.html'), 'utf8')
        .replace('__CSRF__', CSRF);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && p === '/api/state') {
      const app = await appStatus();
      const st = await offlineState();
      /* نسخه‌ی Node و کارکردن `node:sqlite` — باگ دور ۳۴: نسخه‌ی ناقص نباید
         مثل «سیستم آک» به نظر برسد */
      st.runtime = await runtimeInfo();
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

      /* ── حفاظ ۳: نسخه‌ی Node سالم باشد ──
         اگر `node:sqlite` کار نکند، صفر کردن آفلاین ممکن نیست. پیش‌تر
         نتیجه یک خطای مبهم وسط کار بود (یا بدتر: صفر ردیف و پیام «آک است»). */
      const rt = await runtimeInfo();
      if (!rt.ok) {
        json(res, 500, {
          ok: false,
          message: `این نسخه‌ی Node نمی‌تواند دیتابیس را باز کند: ${rt.message}\nهیچ داده‌ای تغییر نکرد.`,
        });
        return;
      }

      /* ── دیگر کلیدی لازم نیست (درخواست کاربر) ──
         تأیید متنی + تیک + پشتیبان اجباری، محافظ‌های واقعی‌اند. */
      const app = await appStatus();

      const opts = {
        confirm: 'صفر کردن',
        reason: String(body.reason || '').slice(0, 300),
        operator: String(body.operator || '').slice(0, 80) || 'reset-tool',
        backup: true,
        keepAdmin: body.keepAdmin !== false,
        wipeBackups: body.wipeBackups !== false,
      };

      /*
       * ── حفاظ ۳: آمادگی دیتابیس، قبل از هر تغییری ────────────────────────
       * دقیقاً همان باگی که کاربر گزارش داد (`table Customer has no column
       * named isWalkIn`) بعد از **خالی شدن** جدول‌ها رخ می‌داد و دیتابیس را
       * نیمه‌کاره رها می‌کرد. حالا در حالت آفلاین، پیش‌بررسی پیش از `reset`
       * اجرا می‌شود؛ اگر دیتابیس آماده نباشد، هیچ ردیفی پاک نمی‌شود.
       */
      let result;
      if (!app.open && fs.existsSync(dbFile)) {
        const pre = await preflightCore({ dbFile });
        if (!pre.ok) {
          json(res, 409, {
            ok: false,
            problems: pre.problems,
            message: `صفر کردن انجام نشد — دیتابیس آماده نیست:\n• ${pre.problems.join('\n• ')}\nهیچ داده‌ای تغییر نکرد.`,
          });
          return;
        }
      }
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

/*
 * ── باگ (شکار باگ دور ۳۰) ────────────────────────────────────────────────
 * اگر پورت اشغال بود (ابزار از قبل باز است، یا برنامه‌ی دیگری آن را گرفته)،
 * Node یک استک‌تریس انگلیسی `EADDRINUSE` می‌ریخت و پنجره‌ی کنسول بسته
 * می‌شد — کاربر هیچ نمی‌فهمید چه شد. حالا پیام فارسی با راه‌حل.
 */
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`\n⛔ پورت ${PORT} در حال استفاده است.`);
    console.error('   یعنی ابزار از قبل باز است (یکی از پنجره‌های قبلی) یا برنامه‌ی دیگری این پورت را گرفته.');
    console.error(`   • اگر ابزار باز است، همان صفحه‌ی مرورگر را استفاده کنید: http://${HOST}:${PORT}`);
    console.error('   • یا با یک پورت دیگر اجرا کنید:  FD_RESET_UI_PORT=' + (PORT + 1));
    console.error('   برای بستن نسخه‌ی قبلی، پنجره‌ی کنسول آن را ببندید.\n');
    process.exit(1);
  }
  console.error('\n⛔ سرور ابزار بالا نیامد:', e?.message || e, '\n');
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`\n🧹 ابزار «صفر کردن سیستم» → http://${HOST}:${PORT}\n`);
  console.log(`   داده: ${dbFile}`);
  console.log(`   منبع: ${resolved.source}${resolved.dbExists ? '' : '  (⚠ دیتابیس در این مسیر نیست)'}`);
  if (!resolved.dbExists) {
    console.log('   مسیرهای گشته‌شده:');
    for (const c of resolved.searched || []) console.log(`     ${c.hasDb ? '✔' : '·'} ${c.dir}  [${c.source}]`);
    console.log('   مسیر درست را با --data-dir بدهید:  node server.mjs --data-dir "<مسیر>"');
  }
  console.log('   تأیید: تیک «برگشت‌ناپذیر» + تایپ عبارت «صفر کردن» (کلید لازم نیست)');
  console.log('   برای بستن: Ctrl+C\n');
});
