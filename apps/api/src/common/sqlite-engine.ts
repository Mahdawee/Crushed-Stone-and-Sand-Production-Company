/**
 * موتور SQLite — «همیشه» باید پیدا شود.
 *
 * ── مشکل واقعی (گزارش کاربر، ویندوز) ─────────────────────────────────────
 *
 * صفحه‌ی شروع می‌گفت: «موتور دیتابیس — missing (@libsql/win32-x64-msvc)»،
 * در حالی که فایل باینری کنار برنامه بود. چرا؟
 *
 * `libsql` (پکیج js) باینری بومی را با یک `require` **پویا** صدا می‌زند:
 *
 *     return require(`@libsql/${target}`);        // libsql/index.js
 *
 * Node این درخواست را از محل پکیج `libsql` حل می‌کند. اما:
 *   • نصب‌کننده‌ی NSIS مسیر برنامه را داخل `C:\Program Files\...` می‌گذارد؛
 *     بعضی نسخه‌ها و آنتی‌ویروس‌ها فایل `index.node` را با تأخیر/قفل
 *     در دسترس می‌گذارند؛
 *   • در بسته‌ی portable، کاربر پوشه را جابه‌جا می‌کند و ساختار
 *     `node_modules` که در زمان *ساخت* فرض شده بود عوض می‌شود؛
 *   • npm در زمان نصب، پکیج‌های `os`/`cpu` غیرمنطبق را حذف می‌کند؛ اگر
 *     نصب روی لینوکس انجام شده باشد و باینری ویندوزی فقط «کاپی» شده باشد،
 *     `require('@libsql/win32-x64-msvc')` با وجود فایل کار نمی‌کند.
 *
 * ── راه‌حل ───────────────────────────────────────────────────────────────
 *
 * پیش از هر استفاده از دیتابیس، این ماژول «مکانیزم بارگذاری» را تعیین می‌کند:
 *
 *   ۱) مسیر عادی: `require('libsql')` کار می‌کند → هیچ کاری نمی‌کنیم.
 *   ۲) اگر کار نکرد: هر مسیر ممکنِ `@libsql/<target>/index.node` را
 *      می‌گردیم و آن را **مستقیم** با `process.dlopen` بار می‌کنیم و در
 *      `require.cache` می‌گذاریم؛ بعد `require('libsql')` را دوباره
 *      امتحان می‌کنیم.
 *   ۳) اگر باز هم نشد: پیام واضح می‌دهیم — با **مسیرهایی که نگاه کردیم** —
 *      تا کاربر/پشتیبان بداند چه چیزی کم است (نه یک «missing» خشک).
 *
 * نکته‌ی مهم: هیچ‌کدام از این کارها به نصب اضافه نیاز ندارد؛ فقط از فایل‌هایی
 * استفاده می‌کند که از قبل کنار برنامه هستند.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Module from 'node:module';

/** نام پکیج بومی برای این پلتفرم (همان چیزی که `libsql` می‌خواهد). */
export function nativePackageName(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32') return `@libsql/win32-${a}-msvc`;
  if (p === 'darwin') return `@libsql/darwin-${a}`;
  if (p === 'linux') return `@libsql/linux-${a}-gnu`;
  return `@libsql/${p}-${a}`;
}

/**
 * همه‌ی جاهایی که ممکن است `node_modules` باشد.
 *
 * ترتیب مهم است: اول نزدیک‌ترین به کد (بسته‌ی نصب‌شده)، بعد ریشه، بعد cwd،
 * و بالاخره پوشه‌ی خود فایل اجرایی (node.exe) — چون در portable، کاربر
 * `node.exe` را کنار `api/` می‌گذارد.
 */
/** همه‌ی `node_modules`های ممکن از یک نقطه به بالا (خالص و تست‌پذیر). */
export function rootsFrom(start: string, levels: number): string[] {
  const out: string[] = [];
  let dir = path.resolve(start);
  for (let i = 0; i <= levels; i++) {
    const nm = path.join(dir, 'node_modules');
    if (!out.includes(nm)) out.push(nm);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

export function searchRoots(): string[] {
  const out: string[] = [];
  const push = (p?: string) => {
    if (!p) return;
    const abs = path.resolve(p);
    if (!out.includes(abs)) out.push(abs);
  };
  /*
   * ⚠ باگ اصلی: کد قبلی فقط `__dirname/node_modules` و
   * `__dirname/../../node_modules` را می‌دید. در بسته‌ی نصب‌شده
   * `__dirname` = `<resources>\api\modules` است، پس:
   *     __dirname/node_modules      → <resources>\api\modules\node_modules ✗
   *     __dirname/../../node_modules → <resources>\node_modules           ✗
   * ولی فایل درست در `<resources>\api\node_modules` است
   * (= `__dirname/../node_modules`). نتیجه: «missing» دروغ، در حالی که
   * دیتابیس بی‌مشکل کار می‌کرد.
   *
   * حالا از هر پوشه‌ی والد (تا ۶ سطح) `node_modules` را امتحان می‌کنیم.
   */
  const from = (start: string | undefined, levels: number) => {
    if (!start) return;
    for (const nm of rootsFrom(start, levels)) push(nm);
  };
  try { from(__dirname, 6); } catch { /* ignore */ }
  try { from(process.cwd(), 3); } catch { /* ignore */ }
  try { from(path.dirname(process.execPath), 3); } catch { /* ignore */ }
  return out;
}

/** فایل‌های باینری موجود برای پکیج بومی، به ترتیب اولویت. */
export function nativeCandidates(pkg = nativePackageName()): string[] {
  const rel = pkg.split('/');
  const files: string[] = [];
  for (const root of searchRoots()) {
    /*
     * `require` باینری را با `main` پکیج حل می‌کند (`index.node`)، ولی اگر
     * `package.json` جا افتاده باشد، خود فایل هم مستقیماً قابل بارگذاری است.
     */
    files.push(path.join(root, ...rel, 'index.node'));
  }
  return files;
}

export type EngineStatus = {
  /** آیا موتور آماده است؟ */
  ok: boolean;
  /** نام پکیج بومی مورد نیاز */
  package: string;
  /** مسیر فایلی که واقعاً بارگذاری شد */
  file: string | null;
  /** همه‌ی جاهایی که بررسی شد (برای پیام خطای مفید) */
  checked: string[];
  /** توضیح کوتاه برای UI */
  detail: string;
};

let status: EngineStatus | null = null;

/**
 * تلاش برای بارگذاری کامل `libsql` (که خودش باینری بومی را صدا می‌زند).
 *
 * چرا چند «لنگر»: `require` از هر پوشه‌ای که لنگر بگیریم، `node_modules` را
 * به سمت بالا دنبال می‌کند. اگر فقط `process.cwd()` را لنگر بگیریم و
 * برنامه از `C:\Windows\System32` (میان‌بر دسکتاپ) اجرا شود، حل نمی‌شود.
 * ترتیب: کنار خود کد → cwd → کنار node.exe.
 */
function anchors(): string[] {
  const out: string[] = [];
  const push = (p?: string) => {
    if (!p) return;
    const abs = path.resolve(p);
    if (!out.includes(abs)) out.push(abs);
  };
  try { push(__dirname); } catch { /* ignore */ }
  try { push(process.cwd()); } catch { /* ignore */ }
  try { push(path.dirname(process.execPath)); } catch { /* ignore */ }
  return out;
}

function tryRequireLibsql(): { ok: boolean; error?: string } {
  let lastError = '';
  for (const dir of anchors()) {
    try {
      const req = Module.createRequire(path.join(dir, '__farday_probe__.js'));
      req('libsql');
      return { ok: true };
    } catch (e: any) {
      lastError = e?.message || String(e);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * باینری بومی را با `process.dlopen` بار می‌کند و در کش `require` می‌گذارد
 * تا `require('@libsql/<target>')` بعدی آن را پیدا کند.
 *
 * چرا dlopen و نه `require(absolutePath)`: روی بعضی نسخه‌های Node/ویندوز،
 * `require` با مسیر مطلقِ .node به مسیرهای طولانی گیر می‌کند؛ dlopen مستقیم
 * فقط به فایل نیاز دارد. هر دو مسیر امتحان می‌شود.
 */
function loadNative(file: string): boolean {
  const fakeId = file;
  const m = new Module(fakeId, undefined);
  m.filename = file;
  m.paths = (Module as any)._nodeModulePaths(path.dirname(file));
  try {
    (process as any).dlopen(m, file);
  } catch {
    try {
      /* eslint-disable-next-line @typescript-eslint/no-var-requires */
      const req = Module.createRequire(file);
      req(file);
    } catch {
      return false;
    }
  }
  m.loaded = true;
  (Module as any)._cache[fakeId] = m;
  return true;
}

/**
 * موتور را آماده می‌کند (یک بار). اگر `libsql` سرِ خودش کار کند، هیچ تغییری
 * در رفتار برنامه ایجاد نمی‌شود — این تابع فقط «تور نجات» است.
 */
export function ensureSqliteEngine(): EngineStatus {
  if (status) return status;

  const pkg = nativePackageName();
  const checked = nativeCandidates(pkg);

  /*
   * فقط برای تست/پشتیبانی: اجازه می‌دهد مسیر «موتور نیست» را در یک نصب سالم
   * بازتولید کنیم تا پیام خطا و رفتار برنامه سنجیده شود.
   */
  if (process.env.FD_ENGINE_FORCE_MISSING === '1') {
    status = {
      ok: false,
      package: pkg,
      file: null,
      checked,
      detail: `missing (${pkg}) — شبیه‌سازی برای آزمون`,
    };
    return status;
  }

  const first = tryRequireLibsql();
  if (first.ok) {
    status = { ok: true, package: pkg, file: null, checked, detail: 'ok' };
    return status;
  }

  for (const file of checked) {
    if (!fs.existsSync(file)) continue;
    if (loadNative(file)) {
      const again = tryRequireLibsql();
      if (again.ok) {
        status = {
          ok: true,
          package: pkg,
          file,
          checked,
          detail: 'ok (بارگذاری دستی)',
        };
        return status;
      }
    }
  }

  /*
   * آخرین تلاش: شاید پکیج `libsql` نبوده و مشکل چیز دیگری است. پیام را بر
   * اساس همان خطای اصلی می‌سازیم تا گمراه‌کننده نباشد.
   */
  const msg = first.error || 'ناشناخته';
  status = {
    ok: false,
    package: pkg,
    file: null,
    checked,
    detail: `missing (${pkg}) — ${msg}`,
  };
  return status;
}

/**
 * مثل `ensureSqliteEngine` ولی اگر موتور نباشد **خطا می‌دهد**.
 * برای جاهایی که بدون دیتابیس نمی‌شود ادامه داد (بوت API).
 */
export function requireSqliteEngine(): EngineStatus {
  const s = ensureSqliteEngine();
  if (!s.ok) {
    const list = s.checked.length
      ? s.checked.map((p) => `     • ${p}`).join('\n')
      : '     (هیچ مسیری بررسی نشد)';
    throw new Error(
      `موتور دیتابیس پیدا نشد: ${s.package}\n` +
        `  این فایل‌ها بررسی شدند:\n${list}\n` +
        `  راه‌حل: برنامه را یک بار دوباره نصب کنید (نصب‌کننده فایل را همراه دارد).`,
    );
  }
  return s;
}

/** فقط برای تست‌ها: کش وضعیت را پاک می‌کند. */
export function resetEngineCache(): void {
  status = null;
}
