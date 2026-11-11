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

/* ================================================================ */
console.log('\n— چاپ کامل (نه با تأخیر دلبخواه) —');

/*
 * باگ دور ۳۰: دکمه‌ی چاپ «حرکت دخل» اول همه‌ی سطرها را رندر می‌کرد و بعد
 * با `setTimeout(…, 60)` چاپ را صدا می‌زد. ۶۰ms عددی دلبخواه بود؛ روی
 * داده‌ی زیاد جدول هنوز آماده نبود و کاغذ ناقص می‌آمد.
 */
const cashbook = read('apps/web/src/pages/Cashbook.tsx');
ok('صندوق: چاپ در افکت و بعد از رندر انجام می‌شود',
  /requestAnimationFrame\(\(\) => window\.print\(\)\)/.test(cashbook));
ok('صندوق: دیگر setTimeout دلبخواه برای چاپ ندارد',
  !/setTimeout\(\(\) => window\.print\(\), \d+\)/.test(cashbook));
ok('صندوق: هنگام چاپ همه‌ی سطرها رندر می‌شوند',
  /printAll \? d\.rows : d\.rows\.slice/.test(cashbook));

/*
 * باگ دور ۳۰: کارت حساب مشتری همه‌ی اسناد را در یک جدول می‌ریخت (مشتری با
 * چند هزار سند = هزاران <tr>). حالا صفحه‌بندی + چاپ کامل.
 */
const stmt = read('apps/web/src/pages/CustomerStatement.tsx');
ok('کارت حساب: صفحه‌بندی دارد (نه یک جدول بی‌کران)',
  /const PAGE = \d+/.test(stmt) && /shown\.slice\(/.test(stmt));
ok('کارت حساب: چاپ همه‌ی سطرها را رندر می‌کند',
  /printAll \? shown : shown\.slice/.test(stmt));
ok('کارت حساب: افکت‌ها قبل از بازگشت زودهنگام هستند (قانون هوک‌ها)',
  stmt.indexOf('return <Spinner />') > stmt.indexOf('useEffect(') &&
  stmt.indexOf('return <Spinner />') > stmt.lastIndexOf('useEffect('));
ok('کارت حساب: با عوض شدن بازه، صفحه به ۱ برمی‌گردد',
  (stmt.match(/setPage\(1\)/g) || []).length >= 3);

console.log('\n— مجموع بدهی در فهرست مشتریان —');

/*
 * باگ دور ۳۰: با جستجو، «مجموع بدهی» فقط بدهی نتیجه‌ی جستجو بود و برچسبش
 * همان «مجموع بدهی» می‌ماند — مدیر می‌توانست آن را کل بدهی شرکت بخواند.
 */
const customers = read('apps/web/src/pages/Customers.tsx');
ok('مشتریان: برچسب مجموع بدهی با جستجو روشن می‌شود',
  /نتیجه‌ی جستجو/.test(customers) && /dq\.trim\(\)/.test(customers));

console.log('\n— ابزار صفر کردن: پیام‌های روشن —');
const cli = read('tools/reset-ui/cli.mjs');
ok('CLI بدون دیتابیس پیام روشن می‌دهد (نه «۰ ردیف»)',
  /چیزی برای صفر کردن وجود ندارد/.test(cli));
ok('CLI وجود فایل را قبل از گزارش «پشتیبان» بررسی می‌کند',
  cli.indexOf('inv.exists') < cli.indexOf('پیش‌فرض'));
for (const tool of ['license', 'reset-ui']) {
  const srv = read(`tools/${tool}/server.mjs`);
  /* فقط کدِ واقعی سنجیده می‌شود؛ توضیح‌ها `req.destroy()` را نام می‌برند */
  const code = srv.split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n');
  ok(`${tool}: بدنه‌ی بزرگ اتصال را معلق نمی‌گذارد (pause + reject)`,
    /req\.pause\(\)/.test(code) && !/req\.destroy\(\)/.test(code));
}

/* ================================================================ */
console.log('\n— کشویی: مقدار ناموجود بی‌صدا پاک نمی‌شود —');

/*
 * باگ دور ۳۱: اگر مقدار ذخیره‌شده در فهرست گزینه‌ها نبود (قلم حذف/تغییر نام
 * شده)، مرورگر «انتخاب…» را نشان می‌داد و ذخیره‌ی دوباره‌ی فورم همان مقدار
 * را پاک می‌کرد. حالا خودِ مقدار به‌عنوان گزینه‌ی «ناموجود در فهرست» می‌آید.
 */
const uiSrc = read('apps/web/src/components/ui.tsx');
ok('Select مقدارِ ناموجود را تشخیص می‌دهد', /const ghost = current !== '' && !known/.test(uiSrc));
ok('Select گزینه‌ی «ناموجود در فهرست» می‌سازد', /ناموجود در فهرست/.test(uiSrc));
ok('Select مقدارِ ناموجود را با نشان هشدار رندر می‌کند', /input-warn/.test(uiSrc));
ok('Select مقدار را رشته‌ای می‌کند (هم‌ترازی عدد/متن)', /String\(o\.value\) === current/.test(uiSrc));
ok('CSS برای همین حالت تعریف شده', /\.input-warn|select\.input-warn/.test(read('apps/web/src/styles/app.css')));

console.log('\n— انتخاب ماه/سال: داده‌های قدیمی دسترس‌پذیرند —');

/*
 * باگ دور ۳۱: فهرست سال با `yearsBack` قطع می‌شد (مثلاً ۱۴۰۱) و سالِ
 * قدیمی‌تر از آن قابل انتخاب نبود؛ حضور و غیاب/معاش سال‌های قبل از داخل
 * برنامه باز نمی‌شد.
 */
const dp = read('apps/web/src/components/DatePicker.tsx');
ok('بازه‌ی سال به سالِ انتخاب‌شده گسترش می‌یابد', /const minYear = Math\.min\(now\.jy - yearsBack/.test(dp));
ok('سال‌ها از «امسال+۱» تا کمینه ساخته می‌شوند', /now\.jy \+ 1 - minYear/.test(dp));

console.log('\n— نصب تازه: فهرست‌های پیش‌فرض —');

const schema = read('apps/api/src/schema.ts');
ok('بالا آمدن برنامه فهرست‌های پیش‌فرض را می‌سازد', /hasDefaultLookups\(\)/.test(schema) && /ensureDefaultLookups\(\)/.test(schema));
const lookups = read('apps/api/src/modules/lookups.controller.ts');
ok('مسیر بازگرداندن پیش‌فرض‌ها هست', /restore-defaults/.test(lookups));
ok('مسیر فعال‌سازی دوباره‌ی غیرفعال‌ها هست', /restore-inactive/.test(lookups));
ok('فقط پیش‌فرض‌ها فعال می‌شوند (نه ردیف کاربر)', /DEFAULT_LOOKUP_NAMES/.test(lookups));
const lookupsPage = read('apps/web/src/pages/Lookups.tsx');
ok('صفحه‌ی فهرست‌ها دکمه‌ی بازگرداندن دارد', /بازگرداندن پیش‌فرض‌ها/.test(lookupsPage));
ok('صفحه‌ی فهرست‌ها دکمه‌ی فعال‌سازی غیرفعال‌ها دارد', /فعال‌کردن غیرفعال‌ها/.test(lookupsPage));

console.log('\n— صفحه‌بندی: نه پاسخ بی‌سقف، نه کشویی ناقص —');

/*
 * باگ دور ۳۲: `/customers` بی‌سقف بود و با هر جستجو کامل دانلود می‌شد.
 * قفل اصلی: صفحه‌ی مشتریان باید **صفحه‌بندی‌شده** بخواهد، ولی فورم‌های
 * فروش/رسید باید همچنان `light=1` و کامل بگیرند (وگرنه کشویی‌شان ناقص
 * می‌شود — همان کلاس باگی که در Select دیدیم).
 */
const customersPage = read('apps/web/src/pages/Customers.tsx');
ok('صفحه‌ی مشتریان با page/pageSize می‌خواند', /\?q=\$\{encodeURIComponent\(dq\)\}&page=\$\{page\}&pageSize=\$\{pageSize\}/.test(customersPage));
ok('صفحه‌ی مشتریان Pager دارد', /<Pager page=\{page\}/.test(customersPage));
ok('«مجموع بدهی» از سرور می‌آید (نه جمع صفحه)', /const totalDebt = debtTotal/.test(customersPage));
ok('تغییر جستجو صفحه را به ۱ برمی‌گرداند', /useEffect\(\(\) => \{ setPage\(1\); \}, \[dq\]\)/.test(customersPage));
ok('فورم فروش همچنان فهرست کامل و سبک می‌خواهد', /customers\?light=1/.test(read('apps/web/src/pages/Sales.tsx')));
ok('فورم رسید همچنان فهرست کامل و سبک می‌خواهد', /customers\?light=1/.test(read('apps/web/src/pages/Receipts.tsx')));
const recyclePage = read('apps/web/src/pages/Recycle.tsx');
ok('سطل بازیافت صفحه‌بندی سمت سرور دارد', /listDeleted\(active, page, pageSize\)/.test(recyclePage));
const soft = read('apps/api/src/common/soft-delete.ts');
ok('ترتیب سطل بازیافت کلید دوم دارد (OFFSET پایدار)', /ORDER BY "deletedAt" DESC, "id" DESC/.test(soft));
const sys = read('apps/api/src/modules/system.controller.ts');
ok('سابقه‌ی فعالیت با trash=0 پیمایش سطل را رد می‌کند', sys.includes('for (const table of (withTrash ? nonEmpty : []))'));
ok('فقط جدول‌های غیرخالی پرسیده می‌شوند (شمارش قبلی)', /deletedCounts\(\)/.test(sys));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
