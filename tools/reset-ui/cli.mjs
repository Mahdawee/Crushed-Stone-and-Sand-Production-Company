#!/usr/bin/env node
/**
 * اجراکننده‌ی خط فرمانِ ابزار «صفر کردن سیستم».
 *
 *   npm run reset -- --info
 *   npm run reset -- --confirm "صفر کردن" --reason "تحویل به مشتری ۲"
 *
 * چرا CLI هم هست: اپراتور گاهی به صفحه‌ی گرافیکی دسترسی ندارد (سرور بی‌نمایش،
 * اتصال ریموت، یا اسکریپت تحویل). منطق **همان** `tools/reset-ui/reset-core.mjs`
 * است — دو نسخه‌ی جدا از هم نداریم.
 *
 * ⚠ بدون `--confirm "صفر کردن"` هیچ کاری نمی‌کند (حتی با `--yes`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, resetOffline, RESET_PHRASE } from './reset-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const dataDir = process.env.FD_DATA_DIR ? path.resolve(process.env.FD_DATA_DIR) : path.join(root, 'data');
const dbFile = process.env.FD_DB_FILE || path.join(dataDir, 'farday.db');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const val = (name, fallback = '') => {
  const i = argv.findIndex((a) => a === `--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const fa = (n) => Number(n || 0).toLocaleString('fa-IR');

function usage() {
  console.log(`${bold('ابزار صفر کردن سیستم — فردای روشن')}

  ${bold('node tools/reset-ui/cli.mjs --info')}          وضعیت داده (بدون تغییر)
  ${bold('node tools/reset-ui/cli.mjs --yes --confirm "صفر کردن"')}
      ${dim('--reason "تحویل به مشتری"  --operator "نام شما"')}
      ${dim('--keep-admin / --no-admin        کاربر مدیر بازسازی شود یا نه')}
      ${dim('--keep-backups                  پشتیبان‌های قبلی پاک نشوند')}

  داده: ${dbFile}
  پوشه: ${dataDir}

${yellow('⚠')} بدون عبارت تأیید «${RESET_PHRASE}» هیچ کاری انجام نمی‌شود.
${yellow('⚠')} قبل از هر تغییر یک پشتیبان خودکار در پوشه‌ی ${bold('backups')} گرفته می‌شود.
`);
  return 0;
}

async function cmdInfo() {
  const inv = await inventory({ dbFile, dataDir });
  if (!inv.exists) {
    console.log(yellow('ℹ فایل دیتابیس نیست — این کمپیوتر داده‌ای ندارد.'));
    console.log(dim(`   مسیر بررسی‌شده: ${dbFile}`));
    return 0;
  }
  console.log(bold('وضعیت داده'));
  console.log(`  دیتابیس: ${dim(inv.database)}`);
  console.log(`  اندازه:  ${(inv.dbSize / 1024).toFixed(0)} KB`);
  console.log(`  پشتیبان: ${fa(inv.backups)}`);
  /*
   * معیار «آک بودن» عدد `total` است، نه خالی‌بودن همه‌ی جدول‌ها.
   *
   * باگ: قبلاً اگر هر ردیفی — حتی «مشتری گذری» یا کاربر مدیر — در دیتابیس
   * بود، فهرست چاپ می‌شد و CLI هیچ‌وقت نمی‌گفت «آک است». حالا ردیف‌های سیستمی
   * با علامت «سیستمی» از داده‌ی کاری جدا نشان داده می‌شوند.
   */
  const META = new Set(['LookupItem', 'User', 'Machinery', 'Company', 'Setting']);
  const rows = Object.entries(inv.counts).sort((a, b) => b[1] - a[1]);
  if (Number(inv.total) === 0) {
    console.log(green('  ✔ هیچ ردیف داده‌ی کاری نیست — سیستم آک است.'));
  } else {
    console.log(`  ردیف‌های کاری: ${bold(fa(inv.total))}`);
    for (const [t, n] of rows) {
      if (META.has(t)) continue;
      const shown = t === 'Customer' ? Math.max(0, n - Number(inv.walkIn || 0)) : n;
      if (shown > 0) console.log(`    • ${t}: ${fa(shown)}`);
    }
  }
  const sys = rows.filter(([t, n]) => META.has(t) && n > 0);
  if (sys.length) {
    console.log(dim(`  سیستمی (پاک نمی‌شود در شمارش «داده»): ${sys.map(([t, n]) => `${t} ${fa(n)}`).join(' · ')}`));
  }
  if (Number(inv.walkIn || 0) > 0) console.log(dim(`  «مشتری گذری»: ${fa(inv.walkIn)} (ردیف ثابت برنامه)`));
  if (inv.mark) {
    console.log(dim(`  آخرین صفر کردن: ${inv.mark.at} · ${inv.mark.operator || ''} · ${fa(inv.mark.total)} ردیف`));
  }
  return 0;
}

async function cmdReset() {
  if (!flag('yes')) {
    console.error(red('✘ برای اجرا --yes را هم بدهید (و --confirm «صفر کردن»).'));
    return 1;
  }
  /*
   * باگ (شکار باگ دور ۳۰): روی کمپیوتری که دیتابیس ندارد (یا FD_DATA_DIR
   * اشتباه است) CLI اول می‌نوشت «۰ ردیف داده پاک می‌شود؛ پشتیبان گرفته
   * می‌شود» و بعد ارور می‌داد — کاربر فکر می‌کرد پشتیبان گرفته شده و شاید
   * داده‌اش جایی هست. حالا اول وجود فایل بررسی می‌شود و پیام روشن است.
   */
  const inv = await inventory({ dbFile, dataDir });
  if (!inv.exists) {
    console.error(yellow('ℹ فایل دیتابیس نیست — چیزی برای صفر کردن وجود ندارد.'));
    console.error(dim(`   مسیر بررسی‌شده: ${dbFile}`));
    console.error(dim('   اگر داده در جای دیگری است، FD_DATA_DIR یا FD_DB_FILE را درست بدهید.'));
    return 1;
  }
  console.log(bold('قبل از اجرا:'));
  console.log(`  ${fa(inv.total)} ردیف داده‌ی کاری پاک می‌شود.`);
  console.log(yellow(`  یک پشتیبان خودکار در ${path.join(dataDir, 'backups')} گرفته می‌شود.`));

  const r = await resetOffline({ dbFile, dataDir }, {
    confirm: val('confirm'),
    reason: val('reason'),
    operator: val('operator') || 'cli',
    keepAdmin: !flag('no-admin'),
    wipeBackups: !flag('keep-backups'),
  });

  if (!r.ok) { console.error(red('✘ ' + r.message)); return 1; }
  console.log(green('✔ ' + r.message));
  console.log(`  پشتیبان: ${r.backupFile}`);
  if (r.admin) console.log(`  کاربر مدیر: ${bold(r.admin.username + ' / ' + r.admin.password)}`);
  if (r.removedBackups) console.log(dim(`  ${fa(r.removedBackups)} پشتیبان قبلی پاک شد.`));
  console.log(dim('\n  حالا برنامه را باز کنید؛ فهرست‌های پیش‌فرض خودکار ساخته می‌شوند.'));
  return 0;
}

const cmd = flag('info') ? cmdInfo : (flag('confirm') || flag('yes') ? cmdReset : usage);
Promise.resolve(cmd()).then((c) => process.exit(c ?? 0)).catch((e) => {
  console.error(red('✘ ' + (e?.message || e)));
  process.exit(1);
});
