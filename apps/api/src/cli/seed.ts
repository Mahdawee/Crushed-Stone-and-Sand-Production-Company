/**
 * Seed / demo data.
 *
 *   node dist/cli/seed.js             → lookups + admin only (safe for production)
 *   node dist/cli/seed.js --demo      → همان «نصب داده‌ی نمونه» خود برنامه
 *
 * داده‌ی نمونه از نسخه‌ی ۲۱ به بعد **یک** مسیر دارد: `common/demo.ts`.
 * قبلاً این فایل نسخه‌ی جداگانه‌ای می‌ساخت که پرچم `isDemo` نداشت، پس از
 * داخل برنامه قابل حذف نبود — یعنی «گزینه‌ی موقتِ نصب و حذف داده‌ی نمونه»
 * برای دیتابیسی که با CLI ساخته شده بود کار نمی‌کرد.
 */
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { ensureDefaultAdmin } from '../common/auth';
import { settingsService } from '../common/settings';
import { installDemo } from '../common/demo';
import { ensureDefaultLookups } from '../common/defaults';

async function main() {
  const demo = process.argv.includes('--demo');
  const force = process.argv.includes('--force');
  await ensureSchemaAsync(true);
  await settingsService.ensureDefaults();
  const admin = await ensureDefaultAdmin();
  if (admin.created) console.log('✔ کاربر پیش‌فرض ساخته شد: admin / admin123');

  const p = db();
  /*
   * فهرست‌های پیش‌فرض از یک منبع مشترک (`common/defaults`) ساخته می‌شوند —
   * همان تابعی که «نصب داده‌ی نمونه» در خود برنامه استفاده می‌کند، تا
   * دیگر دو نسخه‌ی جدا از هم نداشته باشیم.
   */
  await ensureDefaultLookups();
  console.log('✔ فهرست‌های کشویی، ماشینری و مشخصات شرکت آماده شد.');

  if (!demo) {
    console.log('تمام. برای معلومات نمونه: node dist/cli/seed.js --demo');
    return;
  }

  /*
   * داده‌ی نمونه‌ی CLI حالا همان `installDemo` برنامه است.
   * قبلاً نسخه‌ی جداگانه‌ای این‌جا بود که: پرچم `isDemo` نمی‌گذاشت، سطل
   * بازیافت را نمی‌شناخت، و ارقامش با سرویس داخل برنامه فرق داشت. حالا هر
   * ردیف نمونه از CLI هم در صفحه‌ی «داده‌ی نمونه» قابل حذف است.
   */
  const r = await installDemo({ months: 2, username: 'cli' });
  if (!r.ok) {
    console.log('ℹ داده‌ی نمونه از قبل موجود است — رد شد. (برای حذف: از صفحه‌ی «سابقه فعالیت» → تب «داده‌ی نمونه».)');
    return;
  }
  console.log(`✔ ${r.total} ردیف داده‌ی نمونه ساخته شد (قابل حذف از برنامه).`);
  console.log('تمام ✔  حالا وارد سیستم شوید: admin / admin123');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
