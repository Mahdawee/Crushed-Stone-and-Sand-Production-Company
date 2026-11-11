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
