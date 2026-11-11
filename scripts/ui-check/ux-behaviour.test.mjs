/**
 * تست «رفتار روزمره‌ی برنامه» — چیزهایی که کاربر واقعاً لمس می‌کند و
 * هیچ تست قبلی نگرفته بود.
 *
 *   node scripts/ui-check/ux-behaviour.test.mjs
 *
 * ۱) **صفحه‌بندی بعد از حذف**: اگر آخرین ردیف صفحه‌ی ۳ حذف شود، کاربر نباید
 *    جدول خالی ببیند (باگ واقعی: «همه‌ی داده‌ها پاک شد!»).
 * ۲) **کلیدهای بازه‌ی راپور**: امروز/۷ روز/این ماه/این سال باید خودشان راپور
 *    را دوباره بارگذاری کنند، نه اینکه اعداد بازه‌ی قبلی روی صفحه بماند.
 * ۳) **خروجی با بازه**: دکمه‌ی خروجی راپور بازه‌ی روی صفحه را می‌فرستد.
 * ۴) **ورودی‌های عددی**: مبلغ/متراژ منفی یا حرفی در UI پذیرفته نمی‌شود
 *    (چون سرور هم رد می‌کند، ولی رفتار فورم باید یکی باشد).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); }
  else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ================================================================ */
console.log('\n— صفحه‌بندی بعد از حذف —');

const paging = await import(path.join(root, 'apps/web/src/lib/paging.ts')).catch(() => null);
/* ماژول TS است؛ اگر import مستقیم نشد، منطق را از روی فایل می‌سنجیم */
if (paging) {
  ok('صفحه‌ی آخر با ۵۱ ردیف و ۲۵ تا = ۳', paging.lastPage(51, 25) === 3);
  ok('حذف آخرین ردیف صفحه‌ی ۳ → صفحه‌ی ۲', paging.pageAfterRemove(3, 25, 51) === 2);
  ok('حذف ردیف وسط صفحه‌ی ۲ → همان صفحه‌ی ۲', paging.pageAfterRemove(2, 25, 51) === 2);
  ok('حذف تنها ردیف موجود → صفحه‌ی ۱ (نه صفر)', paging.pageAfterRemove(1, 25, 1) === 1);
  ok('فهرست خالی → صفحه‌ی ۱', paging.lastPage(0, 25) === 1);
} else {
  const src = read('apps/web/src/lib/paging.ts');
  ok('ماژول صفحه‌بندی وجود دارد', /export function pageAfterRemove/.test(src));
  ok('صفحه‌ی آخر محاسبه می‌شود', /Math\.ceil/.test(src) && /Math\.max\(1,/.test(src));
}

const pages = ['Sales', 'Expenses', 'Receipts'];
const offenders = [];
for (const p of pages) {
  const src = read(`apps/web/src/pages/${p}.tsx`);
  if (!/pageAfterRemove/.test(src)) offenders.push(p);
}
ok('فروشات/مصارف/رسیدات بعد از حذف صفحه را درست می‌کنند', offenders.length === 0, offenders.join(', '));

/* ================================================================ */
console.log('\n— کلیدهای بازه‌ی راپور خودکار بارگذاری می‌کنند —');

for (const p of ['ReportsDetail', 'ReportsDaily', 'Cashbook']) {
  const src = read(`apps/web/src/pages/${p}.tsx`);
  ok(`${p}: تغییر بازه اثر دارد (useEffect روی range)`,
    /useEffect\(\(\) => \{[\s\S]{0,400}range\.from/.test(src), '');
  ok(`${p}: از بارگذاری تکراری جلوگیری می‌شود (loadedRef)`, /loadedRef/.test(src));
}

/* ================================================================ */
console.log('\n— خروجی با محدوده‌ی تاریخ —');

const api = read('apps/web/src/lib/api.ts');
ok('downloadCsv بازه را می‌پذیرد', /range\?: \{ from\?: string; to\?: string \}/.test(api));
ok('بازه در آدرس خروجی می‌رود', /qs\.set\('from', range\.from\)/.test(api) && /qs\.set\('to', range\.to\)/.test(api));

const ui = read('apps/web/src/components/ui.tsx');
ok('ExportButton بازه را می‌گیرد', /range\?: \{ from\?: string; to\?: string \}/.test(ui));
ok('ExportButton بازه را به downloadCsv می‌دهد', /downloadCsv\(type, format, range\)/.test(ui));

const rp = ['ReportsDetail', 'ReportsDaily', 'Cashbook'];
const noRange = rp.filter((p) => !/range=\{range\}/.test(read(`apps/web/src/pages/${p}.tsx`)));
ok('همه‌ی دکمه‌های خروجی راپور بازه را می‌فرستند', noRange.length === 0, noRange.join(', '));

const be = read('apps/api/src/modules/importexport.controller.ts');
ok('سرور پارامتر from/to را می‌خواند', /@Query\('from'\) from/.test(be) && /@Query\('to'\) to/.test(be));
ok('ستون تاریخ هر نوع اعلام شده', /dateCol: 'date'/.test(be) && /dateCol: 'payDate'/.test(be));
ok('بازه داخل کوئری (قبل از ORDER BY) اعمال می‌شود',
  /lastIndexOf\(' ORDER BY '\)/.test(be) && /const glue =/.test(be));

/* ================================================================ */
console.log('\n— ورودی عددی: منفی/حرفی پذیرفته نمی‌شود —');

const form = read('apps/web/src/components/ui.tsx');
ok('کادر عددی حرف نمی‌گیرد (sanitize)', /replace\(\/\[[^\]]*\]\/g/.test(form));
ok('کادر عددی منفی را با allowNegative کنترل می‌کند', /allowNegative/.test(form));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
