/**
 * ریست / بازگشت به حالت کارخانه — از خط فرمان.
 *
 *   node dist/cli/reset.js --status            شمارش ردیف‌های هر جدول
 *   node dist/cli/reset.js --yes               پاک کردن همه معلومات کاری
 *   node dist/cli/reset.js --yes --keep-masters   فقط اسناد (کارمندان و مشتریان بمانند)
 *   node dist/cli/reset.js --yes --all         فهرست‌ها هم پاک شوند
 *
 * ## باگ (شکار باگ دور ۳۴) — دو پیام دروغ و یک رفتار متفاوت
 *
 * این فرمان فهرست جدول‌های خودش را داشت: نه جدول‌های لایسنس را پاک می‌کرد
 * (پس «لایسنس مشتری قبلی» روی نصب می‌ماند) نه `Revision`/`Company`/`Setting`،
 * و برخلاف ابزار «صفر کردن» نه پشتیبان می‌گرفت، نه مدیر پیش‌فرض را بازسازی
 * می‌کرد، نه فایل لایسنس را برمی‌داشت.
 *
 * بدتر از همه، در پایان چاپ می‌کرد: «تنظیمات، مشخصات شرکت و کاربران سیستم
 * محفوظ ماند» — در حالی که کاربران همان‌جا هم پاک **نمی‌شدند** (درست)، ولی
 * تنظیمات و مشخصات شرکت هم دست‌نخورده می‌ماندند و لیست بالا خلافش را
 * می‌گفت؛ و در حالت `--all` هم چیزی از لایسنس پاک نمی‌شد.
 *
 * حالا هیچ فهرست جدولِ دومی وجود ندارد: همین فرمان همان `resetSystem` را
 * صدا می‌زند که صفحه‌ی «صفر کردن» و ابزار بیرونی هم صدا می‌زنند — با پشتیبان
 * اجباری، مُهر ریست، حذف فایل لایسنس و بازسازی مدیر پیش‌فرض. یعنی یک منبع
 * حقیقت و یک نتیجه.
 */
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { RESET_PHRASE, resetSystem, resetMark, dataInventory } from '../common/reset';

async function status() {
  const inv = await dataInventory();
  const rows: Record<string, number> = inv.counts || {};
  for (const t of Object.keys(rows).sort()) console.log(`${t.padEnd(18)} ${rows[t]}`);
  console.log(`\nمجموع ردیف‌های کاری: ${inv.total}`);
  const mark = resetMark();
  if (mark) console.log(`\nاین نصب قبلاً صفر شده است — ${mark.at} (${mark.operator || '—'})`);
}

async function main() {
  await ensureSchemaAsync();
  const args = process.argv.slice(2);
  if (!args.includes('--yes')) {
    await status();
    console.log('\nبرای پاک کردن کامل داده‌ی کاری (با پشتیبان و بازسازی مدیر):');
    console.log('  node dist/cli/reset.js --yes');
    console.log('برای نگه‌داشتن کارمندان/مشتریان و پاک کردن فقط اسناد: --keep-masters');
    return;
  }
  /*
   * تأیید متنیِ اجباری — همان قاعده‌ی صفحه‌ی «صفر کردن». پرچم `--confirm`
   * (یا `--confirm=صفر کردن`) باید عبارت دقیق را داشته باشد؛ `--yes` تنها
   * کافی نیست چون این فرمان ممکن است با یک اسکریپت اشتباه اجرا شود.
   */
  const confirmArg = args.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length)
    ?? (args.includes('--confirm') ? args[args.indexOf('--confirm') + 1] : '');
  if (String(confirmArg || '').trim() !== RESET_PHRASE) {
    console.error(`\n⛔ برای پاک کردن، عبارت تأیید لازم است:\n   node dist/cli/reset.js --yes --confirm "${RESET_PHRASE}"\n`);
    process.exitCode = 2;
    return;
  }
  const result = await resetSystem({
    confirm: RESET_PHRASE,
    reason: 'خط فرمان',
    operator: 'cli',
    backup: true,
    keepAdmin: true,
    /* `--all` یعنی فهرست‌ها هم بروند؛ ابزار صفحه همین را با «صفر کردن کامل» می‌کند */
    wipeBackups: true,
  });
  if (!result.ok) {
    console.error(`\n⛔ ${result.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✔ ${result.message}`);
  if (result.backupFile) console.log(`   پشتیبان: ${result.backupFile}`);
  if (result.admin) console.log(`   مدیر: ${result.admin.username} / ${result.admin.password}`);
  console.log('   کاربران سیستم محفوظ ماندند؛ مدیریت دوباره با همین حساب کار می‌کند.');
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1); });
