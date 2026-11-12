/**
 * راه‌اندازی مشترک ابزارهای بیرونی (لایسنس و صفر کردن).
 *
 * ── چرا این فایل ساخته شد (شکار باگ دور ۳۶) ─────────────────────────────
 * کاربر گزارش کرد «اجراکننده‌ها ابزار را باز نمی‌کنند». بخشی از مشکل در
 * `start.cmd` بود (پایان‌خط LF، تأخیر ثابت ۲ ثانیه‌ای، باز کردن مرورگر قبل از
 * آماده شدن سرور). ولی ریشه‌ی قابل‌اعتمادتر این است: **سرور خودش می‌داند چه
 * وقتی آماده است** و خودش می‌تواند بگوید پورت اشغال است. پس:
 *
 *   ۱) انتخاب پورت: اگر پورت پیش‌فرض اشغال بود، پورت بعدی آزاد امتحان می‌شود.
 *      قبلاً `EADDRINUSE` یعنی «ابزار باز نمی‌شود» — حتی وقتی فقط یک نسخه‌ی
 *      قدیمی از قبل باز بود و کاربر می‌خواست نسخه‌ی تازه را ببیند.
 *      ⚠ نکته‌ی مهم: اگر روی پورت مشغول **همین ابزار** نشسته باشد، پورت عوض
 *      نمی‌شود؛ همان صفحه باز می‌شود (نه دو نسخه با دو پورت مختلف).
 *   ۲) باز کردن مرورگر دقیقاً پس از `listening` — نه با تأخیر حدسی.
 *      `FD_NO_BROWSER=1` این کار را خاموش می‌کند (برای تست و CI).
 *
 * چرا این‌جا و نه در `start.cmd`: منطق در یک جا، برای هر دو ابزار، و قابل
 * تست با Node در ساندباکسِ بدون ویندوز.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';

/**
 * آیا روی این پورت **همین** ابزار جواب می‌دهد؟
 * امضای ابزار در پاسخ `/__tool` است (پایین‌تر در هر دو سرور).
 *
 * @returns {Promise<boolean>}
 */
function isSameTool(port, host, toolId, timeoutMs = 700) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/__tool', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 512) req.destroy(); });
      res.on('end', () => {
        try { resolve(JSON.parse(body).tool === toolId); } catch { resolve(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/**
 * گوش دادن با انتخاب پورت آزاد.
 *
 * @param {object} o
 * @param {http.Server} o.server
 * @param {string} o.host
 * @param {number} o.port           پورت دلخواه
 * @param {string} o.toolId         شناسه‌ی ابزار ('reset-ui' | 'license')
 * @param {number} [o.tries=20]     چند پورت بعدی امتحان شود
 * @param {(port:number)=>void} o.onListening
 * @param {(err:Error)=>void} o.onFatal
 */
export async function listenWithFallback(o) {
  const { server, host, toolId, onListening, onFatal } = o;
  const first = Number(o.port) || 0;
  const tries = Number(o.tries) || 20;

  for (let i = 0; i < tries; i++) {
    const port = first + i;
    /* اگر همین ابزار از قبل روی این پورت است، همان را باز کن (نسخه‌ی دوم نساز) */
    if (await isSameTool(port, host, toolId)) {
      console.log(`\n   ℹ ابزار از قبل روی http://${host}:${port} باز است — همان صفحه را استفاده کنید.`);
      return { port, reused: true };
    }
    const result = await new Promise((resolve) => {
      const onError = (e) => {
        server.removeListener('listening', onOk);
        if (e && e.code === 'EADDRINUSE') resolve({ busy: true });
        else resolve({ error: e });
      };
      const onOk = () => {
        server.removeListener('error', onError);
        resolve({ ok: true });
      };
      server.once('error', onError);
      server.once('listening', onOk);
      server.listen(port, host);
    });
    if (result.error) { onFatal(result.error); return { error: result.error }; }
    if (result.ok) {
      if (i > 0) console.log(`   پورت ${first} اشغال بود — پورت ${port} استفاده می‌شود.`);
      onListening(port);
      return { port };
    }
    /* busy → پورت بعدی */
  }
  const e = new Error(`هیچ پورت آزادی بین ${first} و ${first + tries - 1} پیدا نشد.`);
  e.code = 'EADDRINUSE';
  onFatal(e);
  return { error: e };
}

/**
 * باز کردن مرورگر روی آدرس ابزار.
 *
 * ── باگ (دور ۳۶): این تابع می‌توانست سرور را بکشد ─────────────────────
 * `spawn('xdg-open', …)` وقتی اجراپذیر نبود، به‌جای پرتاب خطای همگام، یک
 * رویداد `error` **غیرهمگام** می‌دهد. `try/catch` آن را نمی‌گیرد و Node با
 * `Unhandled 'error' event … spawn xdg-open ENOENT` کل پروسه را می‌بندد.
 * یعنی «مرورگر باز نشد» به «ابزار کلاً باز نشد» تبدیل می‌شد. حالا هر فرزند
 * یک `on('error')` دارد و شکست باز کردن مرورگر هیچ‌وقت سرور را نمی‌کشد.
 *
 * @returns {boolean} آیا تلاش برای باز کردن انجام شد
 */
export function openBrowser(url) {
  if (String(process.env.FD_NO_BROWSER || '') === '1') return false;
  const attempt = (cmd, args) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      /* ⚠ لازم: بدون این، ENOENT کل پروسه را می‌کشد */
      child.on('error', () => { /* ابزاری برای باز کردن نیست — بی‌صدا رد شو */ });
      child.unref();
      return true;
    } catch {
      return false;
    }
  };

  if (process.platform === 'win32') {
    /*
     * `start` دستور داخلی cmd است و با spawn مستقیم اجرا نمی‌شود؛
     * `rundll32 url.dll,FileProtocolHandler` وابسته به quoting شکننده نیست.
     */
    return attempt('rundll32', ['url.dll,FileProtocolHandler', url]);
  }
  if (process.platform === 'darwin') return attempt('open', [url]);

  /* لینوکس/BSD — هر کدام که بود */
  for (const [cmd, args] of [['xdg-open', [url]], ['gio', ['open', url]], ['sensible-browser', [url]]]) {
    if (attempt(cmd, args)) return true;
  }
  return false;
}
