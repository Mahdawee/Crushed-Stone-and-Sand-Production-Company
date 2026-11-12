/**
 * پشتیبان‌گیری و بازگردانی در **پایین‌ترین لایه** — بدون Prisma، بدون HTTP.
 *
 * چرا جدا شد: هم `resetSystem` (که خودش جدول‌ها را پاک می‌کند) هم مسیر
 * **بروزرسانی ساختار** (`schema.ts`) باید بتوانند قبل از هر تغییر برگشت‌ناپذیر
 * پشتیبان بگیرند. اگر هر کدام نسخه‌ی خودش را می‌داشت، دو نسخه‌ی جدا از هم
 * می‌شدند و یکی از آنها دیر یا زود عقب می‌ماند (همان اشتباهی که در
 * `timeline` و `SOFT_TABLES` افتاد).
 *
 * قاعده‌ها:
 *   • پشتیبان فقط با `fs.copyFileSync` و همراه `-wal`/`-shm` — تا کاپی
 *     نیمه‌کاره نشود.
 *   • پشتیبان صفر‌بایتی = شکست، نه پشتیبان.
 *   • بازگردانی **فقط** با اتصال بسته. با اتصال باز، WAL کهنه دوباره روی فایل
 *     تازه نوشته می‌شود و بازگردانی بی‌اثر است.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** نام فایل پشتیبان با مهر زمانیِ مرتب‌شدنی و پیشوند دلیل. */
export function backupName(prefix: string, when: Date = new Date()): string {
  const stamp = when.toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}.db`;
}

/**
 * کاپی کامل دیتابیس (با WAL/SHM). مسیر فایل پشتیبان را برمی‌گرداند.
 * اگر فایل مبدأ نباشد یا کاپی خالی شود، استثنا می‌دهد — فراخوان باید
 * عملیات را متوقف کند.
 */
export function makeBackup(dbFile: string, dir: string, prefix: string): string {
  if (!fs.existsSync(dbFile)) throw new Error('فایل دیتابیس پیدا نشد؛ پشتیبان‌گیری ممکن نیست.');
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, backupName(prefix));
  fs.copyFileSync(dbFile, dst);
  /*
   * ⚠ فقط اگر WAL واقعاً داده دارد کاپی می‌شود. فایل `-wal` خالی (بعد از
   * checkpoint) اگر کنار پشتیبان گذاشته شود، پشتیبان را «مشکوک» می‌کند و
   * در فهرست پشتیبان‌ها یک ردیف اضافه‌ی بی‌معنا می‌سازد.
   */
  for (const suffix of ['-wal', '-shm']) {
    try {
      if (fs.existsSync(dbFile + suffix) && fs.statSync(dbFile + suffix).size > 0) {
        fs.copyFileSync(dbFile + suffix, dst + suffix);
      }
    } catch { /* ignore */ }
  }
  if (fs.statSync(dst).size === 0) {
    try { fs.rmSync(dst, { force: true }); } catch { /* ignore */ }
    throw new Error('پشتیبان خالی ساخته شد؛ عملیات متوقف شد.');
  }
  return dst;
}

/**
 * بازگرداندن فایل پشتیبان روی دیتابیس زنده.
 * `closeConnection` باید **قبل** از کاپی صدا زده شود (بستن اتصال libSQL).
 */
export function restoreFromBackup(backupFile: string, dbFile: string): boolean {
  try {
    if (!backupFile || !fs.existsSync(backupFile)) return false;
    fs.copyFileSync(backupFile, dbFile);
    const walBak = backupFile + '-wal';
    if (fs.existsSync(walBak)) fs.copyFileSync(walBak, dbFile + '-wal');
    else fs.rmSync(dbFile + '-wal', { force: true });
    fs.rmSync(dbFile + '-shm', { force: true });
    return true;
  } catch {
    return false;
  }
}

/** نگه‌داشتن آخرین `keep` پشتیبان — قدیمی‌ترها پاک می‌شوند (جا اشغال نکنند). */
export function pruneBackups(dir: string, keep = 30, match = /\.db$/): number {
  try {
    if (!fs.existsSync(dir)) return 0;
    const all = fs.readdirSync(dir).filter((f) => match.test(f)).sort();
    let removed = 0;
    while (all.length > keep) {
      const old = all.shift();
      if (!old) break;
      try {
        fs.rmSync(path.join(dir, old), { force: true });
        for (const s of ['-wal', '-shm']) fs.rmSync(path.join(dir, old + s), { force: true });
        removed++;
      } catch { /* ignore */ }
    }
    return removed;
  } catch {
    return 0;
  }
}

/* ==================================================================== */
/* پشتیبان فشرده — پیشنهاد B4، دور ۴۰                                  */
/* ==================================================================== */

/** سرآیند هر فایل SQLite سالم — ۱۶ بایت اول. */
const SQLITE_MAGIC = 'SQLite format 3\u0000';

/**
 * پشتیبان «فشرده»: به‌جای کاپی بایت‌به‌بایتِ فایل، فقط داده‌ی زنده.
 *
 * ── اندازه‌گیری واقعی که این تابع را لازم کرد ──────────────────────────
 * با `copyFileSync`، فایل پشتیبان **کوچک نمی‌شود** وقتی داده حذف شده:
 *
 *   | حالت                       | copyFileSync  | VACUUM INTO   |
 *   | -------------------------- | ------------- | ------------- |
 *   | ۲۰۰٬۰۰۰ ردیف، دست‌نخورده   | ۴۳.۵MB / ۶۶ms | ۴۳MB          |
 *   | بعد از حذف نیمی از ردیف‌ها | ۴۳.۵MB / ۶۶ms | **۲۱.۸MB**    |
 *
 * یعنی هر «صفر کردن» و پاک‌کردن اسناد، فضای مرده‌ی دائمی در پشتیبان‌ها
 * می‌گذارد. `VACUUM INTO` یک کاپی **سازگار و تراکنشی** می‌سازد و فضای مرده
 * را دور می‌ریزد.
 *
 * ── قاعده‌های ایمنی (هیچ‌کدام قابل کوتاه‌شدن نیستند) ───────────────────
 *   ۱) **پشتیبان سالم هرگز قبل از آماده شدن جانشین پاک نمی‌شود.** اگر
 *      فشرده‌سازی شکست بخورد، همان پشتیبان کاپی‌شده سر جایش می‌ماند و
 *      `null` برمی‌گردد. برعکسش (اول پاک‌کردن، بعد ساختن) یعنی در بدترین
 *      لحظه هیچ راه برگشتی نمانَد.
 *   ۲) فایل نیمه‌کاره پاک می‌شود و خروجی `null` است — هیچ «سبزِ دروغین».
 *   ۳) فایل خروجی باید سرآیند SQLite داشته باشد و خالی نباشد.
 *   ۴) `VACUUM INTO` از **اتصال زنده** اجرا می‌شود، پس داده‌ی commit‌شده‌ی
 *      داخل WAL را هم می‌بیند (خطر کاپیِ خام فایل را ندارد).
 *
 * @param source مسیر پشتیبان کاپی‌شده (خروجی `makeBackup`)
 * @param exec   اجراکننده‌ی SQL روی اتصال زنده — در عمل `p.$executeRawUnsafe`
 * @returns اطلاعات پشتیبان فشرده، یا `null` اگر نشد (پشتیبان اصلی سالم است)
 */
export async function compactBackup(
  source: string,
  exec: (sql: string) => Promise<unknown>,
): Promise<{ file: string; bytes: number; beforeBytes: number } | null> {
  const tmp = `${source}.compact`;
  try {
    if (!fs.existsSync(source)) return null;
    const beforeBytes = fs.statSync(source).size;

    /*
     * `VACUUM INTO` فایل مقصدِ موجود را بازنویسی نمی‌کند، پس اگر از اجرای
     * قبلی چیزی مانده باشد اول پاک می‌شود (وگرنه خطا می‌دهد و ما فکر می‌کنیم
     * مشکل جدی است).
     */
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }

    /* مسیر در دستور SQL داخل کوتیشن تک می‌رود؛ کوتیشن داخل مسیر باید دوبار شود. */
    const literal = tmp.replace(/'/g, "''");
    await exec(`VACUUM INTO '${literal}'`);

    if (!fs.existsSync(tmp)) return null;
    const bytes = fs.statSync(tmp).size;
    if (bytes === 0) { fs.rmSync(tmp, { force: true }); return null; }

    const head = Buffer.alloc(16);
    const fd = fs.openSync(tmp, 'r');
    try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
    if (head.toString('latin1') !== SQLITE_MAGIC) {
      fs.rmSync(tmp, { force: true });
      return null;
    }

    /*
     * فقط از این‌جا به بعد فایل اصلی عوض می‌شود — و به شکل «جابه‌جایی»، نه
     * پاک‌کردن. اگر `renameSync` شکست بخورد، فایل اصلی دست‌نخورده است.
     */
    fs.renameSync(tmp, source);

    /*
     * فایل‌های `-wal`/`-shm` پشتیبان قدیمی حالا بی‌ربط‌اند: محتوایشان در
     * فایل فشرده هست و ماندنشان پشتیبان را «مشکوک» نشان می‌دهد.
     */
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(source + suffix, { force: true }); } catch { /* ignore */ }
    }

    return { file: source, bytes, beforeBytes };
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return null;
  }
}
