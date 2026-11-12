/**
 * نگهبان «راهنمای نجات داده» — پیشنهاد D3، دور ۴۰.
 *
 *   node scripts/ui-check/recovery-doc.test.mjs
 *
 * چرا این تست لازم است: راهنمای بازیابی فقط وقتی ارزش دارد که با رفتار
 * **واقعی** محصول بخواند. اگر روزی نام فایل پشتیبان، مسیر پوشه‌ی داده، یا
 * معنای `-wal` عوض شود و سند عقب بماند، سند در بحرانی‌ترین لحظه کاربر را
 * به مسیر غلط می‌فرستد — و این بدتر از نداشتن سند است.
 *
 * پس هر «حقیقت» نام‌برده در سند با کد واقعی مقایسه می‌شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const doc = read('docs/RECOVERY.md');
const dbTs = read('apps/api/src/db.ts');
const backupTs = read('apps/api/src/common/backup.ts');
const upgradeTs = read('apps/api/src/common/upgrade.ts');
const resetTs = read('apps/api/src/common/reset.ts');
const sysCtl = read('apps/api/src/modules/system.controller.ts');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— راهنمای نجات داده با واقعیت کد می‌خواند؟ —');

/* ۱) نام فایل دیتابیس و پوشه‌ی پشتیبان */
ok('سند نام farday.db را درست می‌گوید', dbTs.includes("'farday.db'") && doc.includes('farday.db'));
ok('سند پوشه‌ی backups را درست می‌گوید',
  dbTs.includes("'backups'") && doc.includes('backups/'));

/* ۲) فایل‌های WAL/SHM */
ok('سند -wal و -shm را نام می‌برد', doc.includes('farday.db-wal') && doc.includes('farday.db-shm'));
ok('کد هم همان‌ها را مدیریت می‌کند',
  backupTs.includes("'-wal'") && backupTs.includes("'-shm'"));

/* ۳) نرم بودن حذف — ادعای مرکزی سند */
ok('سند «حذف نرم» و سطل بازیافت را توضیح می‌دهد',
  doc.includes('حذف در این برنامه نرم است') && doc.includes('سطل بازیافت'));
ok('سند نام ستون deletedAt را درست می‌گوید', doc.includes('deletedAt'));
ok('کد soft-delete هم با deletedAt کار می‌کند',
  fs.existsSync(path.join(root, 'apps/api/src/common/soft-delete.ts')));

/* ۴) پشتیبان صفر‌بایتی = شکست (قاعده‌ی مهم) */
ok('سند می‌گوید پشتیبان صفر‌بایتی شکست است', /صفر بایت|صفر‌بایت/.test(doc));
ok('کد هم دقیقاً همین را چک می‌کند', /size === 0/.test(backupTs));

/* ۵) پیشوند نام‌های پشتیبان */
for (const prefix of ['pre-reset', 'pre-upgrade-v', 'before-restore']) {
  ok(`پیشوند ${prefix} در سند آمده`, doc.includes(prefix));
}
ok('pre-reset در reset.ts واقعاً استفاده می‌شود', resetTs.includes("'pre-reset'"));
ok('pre-upgrade-v در schema واقعاً استفاده می‌شود',
  read('apps/api/src/schema.ts').includes('pre-upgrade-v${dbVersion}'));
ok('before-restore در کد وجود دارد', sysCtl.includes('before-restore-'));

/* ۶) فایل‌های لاگ نام‌برده */
ok('upgrade-history.log در سند آمده و در کد هم هست',
  doc.includes('upgrade-history.log') && upgradeTs.includes('UPGRADE_LOG'));
ok('reset-history.log در سند آمده', doc.includes('reset-history.log'));

/* ۷) پیام خطای ساختار جدیدتر */
ok('FARDAY_DB_NEWER در سند آمده و در کد هم هست',
  doc.includes('FARDAY_DB_NEWER') && read('apps/api/src/schema.ts').includes('FARDAY_DB_NEWER'));

/* ۸) ابزار نجات */
ok('مسیر tools/reset-ui/start.cmd در سند آمده', doc.includes('tools\\reset-ui\\start.cmd'));
ok('آن فایل واقعاً وجود دارد', fs.existsSync(path.join(root, 'tools/reset-ui/start.cmd')));

/* ۹) مسیر «درباره و بررسی سلامت» که در D2 اضافه شد */
ok('سند به کارت «بررسی سلامت» ارجاع می‌دهد', doc.includes('بررسی سلامت'));
ok('آن کارت واقعاً در تنظیمات هست',
  read('apps/web/src/pages/Settings.tsx').includes('AboutCard'));

/* ۱۰) قاعده‌ی «قبل از هر کاری کپی بگیر» در ابتدای سند است */
const firstThird = doc.slice(0, Math.floor(doc.length / 3));
ok('قاعده‌ی «اول کپی بگیر» در سوم اول سند است',
  /قبل از هر کاری، یک کپی/.test(firstThird));

/* ۱۱) سند نباید ادعای «به اینترنت وصل می‌شود» بکند */
ok('سند صریحاً می‌گوید کار محلی است', /به اینترنت\s*\n?نیاز ندارد|هیچ‌جا فرستاده نمی‌شود/.test(doc));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
