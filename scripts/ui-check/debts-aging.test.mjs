/**
 * نگهبان «عمر بدهی» — پیشنهاد C5، دور ۴۰.
 *
 *   node scripts/ui-check/debts-aging.test.mjs
 *
 * ── چرا این تست ─────────────────────────────────────────────────────────
 * تخصیص FIFO دو بار در همین دور غلط نوشته شد و هر دو بار کد **کامپایل
 * شد** و پاسخ **۲۰۰** داد. خطا فقط در عدد بود:
 *   بار اول: «تازه‌ترین بل» را قدیمی‌ترین می‌گفت (یادآوری برای بدهی
 *            چهار ماهه فرستاده نمی‌شد).
 *   بار دوم: بل **تسویه‌شده** را باز می‌شمرد (بعد از پرداخت کاملِ بل
 *            قدیمی، هنوز «۲۰۶ روز» می‌گفت).
 * چیزی که هر دو را گرفت، اجرای واقعی روی عدد بود. این فایل همان را
 * بدون نیاز به سرور تکرار می‌کند.
 *
 * منطق از کنترلر استخراج و در فایل جدا اجرا نمی‌شود (کد تکراری = کد
 * بی‌نگهبان)؛ به‌جایش تابع واقعی را از سورس می‌خوانیم و اجرا می‌کنیم.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctrl = fs.readFileSync(path.join(root, 'apps/api/src/modules/debts.controller.ts'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

/*
 * ── تابع واقعی، بدون بازنویسی و بدون ابزار اضافه ────────────────────────
 * منطق در `apps/api/src/common/debt-aging.ts` است و **هیچ import اجرایی
 * ندارد** فقط به همین دلیل. پس Node خودش می‌تواند فایل .ts را با
 * `--experimental-strip-types` بارگذاری کند: کد اجراشده همان کد ارسالی
 * است، نه یک کپی که دیر یا زود از اصل جدا می‌افتد.
 *
 * (پراچم اول با esbuild بود — در درخت نبود. دوم با typescript — نسخه‌ی ۷
 * API جاوااسکریپتی ندارد. سومی بومیِ Node است و هیچ وابستگی نمی‌خواهد.)
 */
const { oldestOpenBill } = await import('../../apps/api/src/common/debt-aging.ts');

const BILL_A = { date: '2026-04-20', total: 10000 };  // ۲۰۶ روز پیش
const BILL_B = { date: '2026-09-28', total: 5000 };   // ۴۵ روز پیش
const TODAY = '2026-11-12';
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

console.log('\n— موارد واقعی که در سرور آزمایش شد —');

let r = oldestOpenBill(0, [BILL_A, BILL_B], 0);
ok('بدهی کامل: قدیمی‌ترین بل، بل اول است', r.date === BILL_A.date, r.date);
ok('۲۰۶ روز درست حساب می‌شود', daysBetween(r.date, TODAY) === 206, String(daysBetween(r.date, TODAY)));

r = oldestOpenBill(0, [BILL_A, BILL_B], 10000);
ok('پرداخت کاملِ بل قدیمی → بل دوم قدیمی‌ترین باز است', r.date === BILL_B.date, r.date);
ok('و عمر آن ۴۵ روز است، نه ۲۰۶', daysBetween(r.date, TODAY) === 45, String(daysBetween(r.date, TODAY)));

r = oldestOpenBill(0, [BILL_A, BILL_B], 4000);
ok('پرداخت جزئی → همان بل اول باز می‌ماند', r.date === BILL_A.date, r.date);
ok('پرداخت جزئی از عمر بدهی کم نمی‌کند', daysBetween(r.date, TODAY) === 206);

r = oldestOpenBill(0, [BILL_A, BILL_B], 15000);
ok('پرداخت کامل همه بل‌ها → تاریخ بل آخر (نه تهی)', r.date === BILL_B.date, r.date);

console.log('\n— مانده‌ی قبلی (بدون تاریخ) —');

r = oldestOpenBill(8000, [], 0);
ok('مانده‌ی قبلی باز → fromOpening=true', r.fromOpening === true && r.date === '');
ok('برای مانده‌ی قبلی تاریخ ساختگی نمی‌سازیم', r.date === '');

r = oldestOpenBill(8000, [BILL_A], 8000);
ok('پرداخت اول مانده‌ی قبلی را می‌بندد', r.date === BILL_A.date && r.fromOpening === false, JSON.stringify(r));

r = oldestOpenBill(8000, [BILL_A], 3000);
ok('پرداخت ناکافی → مانده‌ی قبلی هنوز باز است', r.fromOpening === true && r.date === '');

console.log('\n— حالت‌های مرزی —');

r = oldestOpenBill(0, [], 0);
ok('نه بل، نه پرداخت → بدون خطا', typeof r.date === 'string');
r = oldestOpenBill(-5000, [BILL_A], 0);
ok('مانده‌ی منفی (بستانکار) به‌عنوان بل شمرده نمی‌شود', r.date === BILL_A.date, r.date);
r = oldestOpenBill(0, [{ date: '2026-05-01', total: 0 }], 0);
ok('بل صفر نادیده گرفته می‌شود', r.date === '2026-05-01', r.date);
r = oldestOpenBill(0, [BILL_A], 9999.99);
ok('یک ریال باقی‌مانده هنوز «باز» است', r.date === BILL_A.date, r.date);

console.log('\n— اتصال سراسری: هر دو مسیر از همین تابع استفاده می‌کنند —');
const usage = (ctrl.match(/oldestOpenBill\(/g) || []).length;
ok('تابع دو بار صدا زده می‌شود (فهرست + یادآوری)', usage === 2, String(usage));
ok('هیچ نسخه‌ی دست‌ساز باقی نمانده', !/let oldest = ''/.test(ctrl));
ok('کنترلر ثبت شده', /DebtsController/.test(fs.readFileSync(path.join(root, 'apps/api/src/app.module.ts'), 'utf8')));
ok('قاعده‌ی منبع رسید از domain.ts می‌آید، نه حرف‌به‌حرف',
  /receiptDebtSql\('"sourceName"'\)/.test(ctrl));
ok('مشتری گذری با realCustomerSql کنار گذاشته می‌شود', /realCustomerSql\(\)/.test(ctrl));
/*
 * هر کوئری‌ای که جدول زنده را می‌خواند باید شرط LIVE داشته باشد. شمارش
 * FROM و LIVE باید جفت باشد — اگر روزی کوئری تازه‌ای بدون LIVE اضافه شود،
 * اسناد حذف‌نرم‌شده بی‌صدا برمی‌گردند (باگ دور ۳۲).
 */
const fromLive = (ctrl.match(/FROM "(Sale|Receipt|Customer)"/g) || []).length;
const liveUses = (ctrl.match(/\$\{LIVE\}/g) || []).length;
ok('هر کوئری زنده شرط LIVE دارد', fromLive > 0 && liveUses >= fromLive, `FROM=${fromLive} LIVE=${liveUses}`);

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
