/**
 * ── بروزرسانی ایمن ─────────────────────────────────────────────────────
 *
 * درخواست مالک: «من از این نسخه بین شرکت‌ها توزیع کرده‌ام؛ بروزرسانی‌های آینده
 * نباید داده‌ی کاربران را خراب کند و باید همه بتوانند بروزرسانی بگیرند.»
 *
 * قاعده‌ای که این فایل پیاده می‌کند:
 *
 *   **۱) هر چه نسخه‌ی ساختار بالاتر، اول پشتیبان.**
 *      قبل از اولین تغییر ساختار روی یک دیتابیس (اضافه‌شدن جدول/ستون)، یک
 *      پشتیبان کامل در `backups/` گرفته می‌شود. اگر بروزرسانی نصفه بماند،
 *      کاربر یک فایل سالم دارد که ابزار نجات با یک دستور برمی‌گرداند.
 *
 *   **۲) نسخه‌ی ساختار از نسخه‌ی برنامه جدا است.**
 *      `SHAPE_VERSION` فقط وقتی بالا می‌رود که **شکل** دیتابیس عوض شود؛ نسخه‌ی
 *      نمایشی برنامه (`appVersion`) می‌تواند هر روز عوض شود بدون اینکه چیزی
 *      روی دیتابیس دست بخورد.
 *
 *   **۳) مهر در خود دیتابیس است، نه در فایل کنارش.**
 *      `PRAGMA user_version` همراه دیتابیس کاپی/بازگردانی می‌شود، پس «بررسی
 *      مهاجرت» روی هر کاپی یک بار انجام می‌شود و روی دیتابیس تازه هرگز.
 *
 *   **۴) هر اجرای مهاجرت ثبت می‌شود** (`upgrade-history.log`) تا وقتی مشتری
 *      می‌گوید «بعد از بروزرسانی چنین شد»، بدانیم کدام نسخه/ساختار روی
 *      دیتابیسش اجرا شده و آیا پشتیبان گرفته شده.
 *
 *   **۵) مهاجرت‌ها فقط اضافه می‌کنند.**
 *      هیچ ستون/جدولی در مهاجرت حذف یا تغییر نوع نمی‌شود. تنها کار مجاز:
 *      `CREATE TABLE IF NOT EXISTS`، `ALTER TABLE … ADD COLUMN`، ساخت ایندکس،
 *      و پُرکردن مقدار پیش‌فرض. این تنها راهی است که «بروزرسانی داده را
 *      خراب نمی‌کند» را می‌شود تضمین کرد.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * نسخه‌ی **شکل** دیتابیس.
 *
 * ⚠ قاعده‌ی بروزرسانی: هر بار که به `TABLES` یا `UPGRADES` در `schema.ts` چیزی
 * اضافه کردید، این عدد را **یک** بالا ببرید. هیچ‌وقت پایین نیاورید.
 *
 * | نسخه | چه چیزی اضافه شد |
 * | ----- | ---------------- |
 * | ۶ | ستون‌های حذف نرم، `isWalkIn`، `isDemo`، مهر صفر کردن |
 * | ۷ | پشتیبان اجباری قبل از مهاجرت + تاریخچه‌ی بروزرسانی + بررسیِ پس از مهاجرت |
 */
export const SHAPE_VERSION = 7;

/**
 * نسخه‌ی نمایشی برنامه (نه ساختار). از `package.json` خوانده می‌شود تا یک
 * منبع حقیقت باشد؛ در بسته‌بندی، همان نسخه در `tauri.conf.json` هم می‌آید.
 */
export function appVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require(path.join(__dirname, '..', '..', '..', 'package.json'));
    return String(pkg?.version || '0.0.0');
  } catch {
    return String(process.env.npm_package_version || '0.0.0');
  }
}

export type UpgradeRecord = {
  at: string;
  from: number;
  to: number;
  appVersion: string;
  backupFile: string;
  ms: number;
  ok: boolean;
  note?: string;
};

export const UPGRADE_LOG = 'upgrade-history.log';

/**
 * ثبت یک اجرای مهاجرت. خطا در نوشتن هرگز کار برنامه را متوقف نمی‌کند —
 * تاریخچه کمک است، نه شرط.
 */
export function logUpgrade(dataDir: string, rec: UpgradeRecord): void {
  const line =
    `${rec.at} · از ساختار ${rec.from} به ${rec.to} · نسخه‌ی برنامه ${rec.appVersion}` +
    ` · پشتیبان: ${rec.backupFile || '—'} · ${rec.ok ? 'موفق' : 'ناموفق'}` +
    `${rec.note ? ` · ${rec.note}` : ''} · ${rec.ms}ms\n`;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(path.join(dataDir, UPGRADE_LOG), line, 'utf8');
  } catch { /* ignore */ }
}

/** آخرین ردیف‌های تاریخچه‌ی بروزرسانی (برای نشان‌دادن در برنامه). */
export function recentUpgrades(dataDir: string, limit = 20): string[] {
  try {
    const file = path.join(dataDir, UPGRADE_LOG);
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

/**
 * آیا این دیتابیس از این نسخه‌ی برنامه **جدیدتر** است؟
 *
 * حالت واقعی: مشتری نسخه‌ی ۱٫۲ نصب کرده، بعد یک کاپی از پوشه‌ی داده را به
 * کمپیوتری برده که برنامه‌ی قدیمی‌تر (۱٫۱) رویش است. اگر برنامه‌ی قدیمی
 * بی‌خبر روی دیتابیس تازه‌تر مهاجرت/نوشتن کند، داده ممکن است بی‌سروصدا
 * ناسازگار شود. در این حالت فقط **هشدار** می‌دهیم (بازداشتن کامل، برنامه را
 * برای کاربر قفل می‌کرد و راه برگشتی هم نداشت) ولی در لاگ و در صفحه‌ی
 * «درباره‌ی برنامه» واضح نوشته می‌شود.
 */
export function isNewerDatabase(dbVersion: number): boolean {
  return Number(dbVersion) > SHAPE_VERSION;
}
