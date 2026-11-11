/**
 * تست «کیفیت چاپ» — `npm run test:print`
 *
 * ── درخواست کاربر ───────────────────────────────────────────────────────
 * «کلید چاپ در بعضی جاها ساده و ظاهری نامناسب داشت آن را هم اصلاح کن».
 *
 * این تست چیزهایی را تثبیت می‌کند که روی **کاغذ** دیده می‌شوند و با چشم
 * معمولی در مرورگر معلوم نیستند:
 *   ۱) در چاپ، جدول لخت نباشد: خط سرستون، نوار ردیف، ستون عددی هم‌تراز.
 *   ۲) کلاس `icon` روی دکمه‌ی چاپِ متنی نباشد (متن بیرون می‌زد — باگ ظاهری).
 *   ۳) چاپ خودکار فقط با `?auto=1` انجام شود؛ باز کردن سند بی‌دلیل پنجره‌ی
 *      چاپ باز نکند و «راه برگشت» همیشه روی صفحه باشد.
 *   ۴) همه‌ی صفحات چاپی `print.css` را وارد کنند (وگرنه استایل اعمال نمی‌شود).
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../lib/project-root.mjs';

const root = projectRoot(import.meta.url, 2);
const web = path.join(root, 'apps', 'web', 'src');
const read = (p) => fs.readFileSync(p, 'utf8');

let passed = 0, failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
}

const css = read(path.join(web, 'styles', 'print.css'));

console.log('\n— ۱) استایل چاپ —');
check('print.css وجود دارد و بلوک @media print دارد', /@media print/.test(css));
check('خط سرستون جدول در چاپ تعریف شده',
  /table\.tbl thead th\s*\{[\s\S]*?border-top/.test(css));
check('نوار یک‌درمیان ردیف‌ها در چاپ هست', /nth-child\(even\) td/.test(css));
check('ستون عددی هم‌تراز است (tabular-nums)', /tabular-nums/.test(css));
check('رنگ‌های چاپ با print-color-adjust دقیق می‌شوند', /print-color-adjust/.test(css));
check('پانوشت گزارش تنها روی برگه‌ی جدا نمی‌افتد',
  /print-report-foot\s*\{[\s\S]*?page-break-before:\s*avoid/.test(css));
check('عنوان صفحه در میانه‌ی جدول نمی‌ماند (page-break-after: avoid)', /page-break-after:\s*avoid/.test(css));
check('حاشیه‌ی A4 تعریف شده', /@page\s*\{\s*size:\s*A4/.test(css));
check('نوار ابزار سند در صفحه دیده می‌شود و روی کاغذ نه',
  /@media screen[\s\S]*?\.doc-toolbar/.test(css) && /\.doc-toolbar\s*\{\s*display:\s*none\s*!important/.test(css));

console.log('\n— ۲) صفحات چاپی print.css را وارد می‌کنند —');
const pages = fs.readdirSync(path.join(web, 'pages')).filter((f) => f.endsWith('.tsx'));
const printers = pages.filter((f) => /window\.print\(\)|doc-page/.test(read(path.join(web, 'pages', f))));
check('صفحه‌ی چاپی پیدا شد', printers.length >= 5, printers.join(', '));
const missing = printers.filter((f) => !/styles\/print\.css/.test(read(path.join(web, 'pages', f))));
check('همه‌ی صفحات چاپی print.css را وارد می‌کنند', missing.length === 0, missing.join(', '));

console.log('\n— ۳) دکمه‌ی چاپ —');
const sales = read(path.join(web, 'pages', 'Sales.tsx'));
check('دکمه‌ی چاپ بل، کلاس icon ندارد (متن بیرون نمی‌زند)',
  !/className="btn sm icon"[^>]*>\s*چاپ/.test(sales) && !/className="btn sm icon" to=\{`\/print/.test(sales));
check('دکمه‌ی چاپ بل آیکن دارد', /IconPrint/.test(sales));
const salaries = read(path.join(web, 'pages', 'Salaries.tsx'));
check('دکمه‌ی رسید معاش آیکن دارد', /IconPrint/.test(salaries));
check('هیچ دکمه‌ی چاپی هم‌زمان کلاس icon و متن ندارد',
  !pages.some((f) => /className="btn[^"]*\bicon\b[^"]*"[^>]*>[^<]*چاپ/.test(read(path.join(web, 'pages', f)))));

console.log('\n— ۴) چاپ خودکار فقط با ?auto=1 —');
for (const f of ['PrintSale.tsx', 'PrintSalary.tsx']) {
  const src = read(path.join(web, 'pages', f));
  check(`${f}: شرط auto=1 وجود دارد`, /get\('auto'\)\s*===\s*'1'/.test(src));
  check(`${f}: بدون auto=1 چاپ نمی‌شود`,
    /if \(!s \|\| printed \|\| !autoPrint\) return;/.test(src));
  check(`${f}: دکمه‌ی بازگشت روی صفحه هست`, /nav\(-1\)/.test(src) && /بازگشت/.test(src));
}

console.log('\n— ۵) ابزار صفر کردن — بدون کلید —');
const serverSrc = read(path.join(root, 'tools', 'reset-ui', 'server.mjs'));
const html = read(path.join(root, 'tools', 'reset-ui', 'ui.html'));
check('سرور ابزار هیچ کلیدی نمی‌خواهد', !/FARDAY_RESET_KEY/.test(serverSrc) && !/resetKey\(\)/.test(serverSrc));
check('صفحه کادر کلید ندارد', !/id="resetKey"/.test(html));
check('صفحه می‌گوید کلید لازم نیست', /کلید لازم نیست/.test(html));
check('تأیید متنی «صفر کردن» باقی است', /confirm/.test(html) && /صفر کردن/.test(html));
check('تیک «برگشت‌ناپذیر» باقی است', /id="ack"/.test(html));
check('پشتیبان اجباری در سرور هست', /backup:\s*true/.test(serverSrc));

console.log(`\n${failed === 0 ? '✔' : '✘'} ${passed} تست موفق، ${failed} ناموفق`);
if (failed) { console.log('\nمشکلات:'); problems.forEach((p) => console.log(` • ${p}`)); process.exit(1); }
