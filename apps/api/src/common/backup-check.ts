/**
 * بررسی سلامت یک فایل پشتیبان **پیش از** بازگردانی.
 *
 * ── باگ جدی که این ماژول حل می‌کند (شکار باگ دور ۲۸) ────────────────────
 *
 * `POST /system/restore` فایل انتخابی را بدون هیچ بررسی‌ای روی دیتابیس
 * زنده کپی می‌کرد. اگر فایل خراب/ناقص/اشتباه بود (کاپی نیمه‌کاره، فایل
 * صفر بایتی، یا چیزی که اصلاً دیتابیس نبود)، نتیجه این بود:
 *
 *   • دیتابیس سالم **بازنویسی** می‌شد و از بین می‌رفت؛
 *   • از آن لحظه هر درخواستی «۵۰۰ Internal server error» می‌داد
 *     (`SQLITE_NOTADB: file is not a database`)، از جمله صفحه‌ی تنظیمات و
 *     بازیابی بعدی — یعنی کاربر از داخل برنامه راه برگشت نداشت.
 *
 * اندازه‌ی فایل هم ملاک نیست: یک فایل ناقص می‌تواند اندازه‌ی درست داشته
 * باشد. پس این‌جا واقعاً فایل را **باز می‌کنیم** (با `node:sqlite` که همراه
 * خود Node است و هیچ وابستگی اضافه ندارد) و ساختارش را می‌خوانیم.
 */
import { DatabaseSync } from 'node:sqlite';

/** جدول‌هایی که یک پشتیبان معتبر باید داشته باشد (حداقلِ لازم برای بوت). */
const REQUIRED = ['User', 'Customer', 'Sale'];

export type BackupCheck = {
  ok: boolean;
  /** پیام فارسی برای کاربر (وقتی ok=false) */
  message: string;
  size: number;
  tables: string[];
  /** شمارش ردیف‌های مهم — برای نمایش «این پشتیبان چه دارد؟» */
  counts: Record<string, number>;
};

/**
 * فایل را باز و بررسی می‌کند. هرگز استثنا نمی‌دهد (خروجی `ok=false`).
 * فایل فقط خوانده می‌شود (`readOnly`) پس این بررسی خودش چیزی را خراب نمی‌کند.
 */
export function checkBackupFile(file: string, size: number): BackupCheck {
  const base: BackupCheck = { ok: false, message: '', size, tables: [], counts: {} };
  if (!size || size < 1024) {
    return { ...base, message: 'فایل پشتیبان خالی یا بسیار کوچک است (کمتر از ۱ کیلوبایت) — احتمالاً کاپی نیمه‌کاره است.' };
  }
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    /* «صفحه‌ی اول سالم است؟» — سریع‌ترین و قاطع‌ترین آزمون برای فایل غیر-SQLite */
    const check = db.prepare('PRAGMA quick_check').all() as any[];
    const verdict = String(check?.[0]?.quick_check ?? check?.[0]?.['quick_check(1)'] ?? '');
    if (verdict && verdict !== 'ok') {
      return { ...base, message: `فایل پشتیبان آسیب‌دیده است (نتیجه‌ی بررسی: ${verdict}).` };
    }
    const tables = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).all() as any[]).map((r) => String(r.name));

    if (!tables.length) {
      return { ...base, message: 'فایل پشتیبان هیچ جدولی ندارد — دیتابیس این برنامه نیست.' };
    }
    const missing = REQUIRED.filter((t) => !tables.includes(t));
    if (missing.length) {
      return {
        ...base,
        tables,
        message: `این فایل، پشتیبان این برنامه نیست: جدول ${missing.join('، ')} در آن نیست.`,
      };
    }
    const counts: Record<string, number> = {};
    for (const t of REQUIRED) {
      try {
        counts[t] = Number((db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as any)?.c ?? 0);
      } catch { counts[t] = 0; }
    }
    if (!counts.User) {
      return { ...base, tables, counts, message: 'این پشتیبان هیچ کاربری ندارد — با بازگردانی آن هیچ‌کس نمی‌تواند وارد شود.' };
    }
    return {
      ok: true,
      message: 'فایل پشتیبان سالم است.',
      size,
      tables,
      counts,
    };
  } catch (e: any) {
    return {
      ...base,
      message: `فایل قابل خواندن نیست (${e?.message || e}) — احتمالاً دیتابیس نیست یا خراب است.`,
    };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}
