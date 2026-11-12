/**
 * نگهبان «چاپ رسید و مصرف» — پیشنهاد C4، دور ۴۰.
 *
 *   node scripts/ui-check/print-docs.test.mjs
 *
 * ── چرا این تست ─────────────────────────────────────────────────────────
 * خطر اصلی در سند چاپی، **فیلد غلط** است: کد کامپایل می‌شود، صفحه باز
 * می‌شود، ولی جای مبلغ خالی می‌ماند. سند چاپی به دست مشتری می‌رود، پس این
 * نوع خطا بدترین نوع است (بی‌صدا و بیرون از کنترل ما).
 *
 * این تست نام دقیق فیلدهای API را با آنچه صفحه‌ی چاپ می‌خواند مقایسه می‌کند.
 * نام‌ها از اسکیمای واقعی گرفته شده‌اند (`Expense.amountAfn` و نه `amount`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const page = read('apps/web/src/pages/PrintDoc.tsx');
const app = read('apps/web/src/App.tsx');
const receipts = read('apps/web/src/pages/Receipts.tsx');
const expenses = read('apps/web/src/pages/Expenses.tsx');
const schema = read('apps/api/src/schema.ts');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— مسیرها و دکمه‌ها —');

ok('مسیر چاپ رسید تعریف شده', /path="\/print\/receipt\/:id"/.test(app));
ok('مسیر چاپ مصرف تعریف شده', /path="\/print\/expense\/:id"/.test(app));
ok('هر دو به یک صفحه می‌روند (نه دو نسخه‌ی جدا)',
  (app.match(/<PrintDoc kind=/g) || []).length === 2);
ok('صفحه lazy است (باندل اولیه سنگین نمی‌شود)', /const PrintDoc = lazy\(/.test(app));
ok('دکمه‌ی چاپ در فهرست رسیدها هست', /print\/receipt\/\$\{r\.id\}/.test(receipts));
ok('دکمه‌ی چاپ در فهرست مصارف هست', /print\/expense\/\$\{r\.id\}/.test(expenses));
ok('چاپ خودکار فقط با auto=1', /get\('auto'\) === '1'/.test(page));
ok('چاپ خودکار یک بار اجرا می‌شود', /printed/.test(page));

console.log('\n— فیلدهای API دقیقاً می‌خوانند —');

/* فیلدهایی که در سند چاپی استفاده می‌شوند و باید در اسکیما باشند */
const receiptFields = ['customerName', 'amount', 'sourceName', 'relatedBillNo', 'receivedBy', 'note'];
const expenseFields = ['description', 'categoryName', 'amountAfn', 'amountUsd', 'shopName', 'purchaseBillNo', 'payerName', 'paymentType', 'note'];

for (const f of receiptFields) {
  ok(`رسید: «${f}» در صفحه‌ی چاپ استفاده می‌شود`, page.includes(`doc.${f}`));
}
for (const f of expenseFields) {
  ok(`مصرف: «${f}» در صفحه‌ی چاپ استفاده می‌شود`, page.includes(`doc.${f}`));
}

/*
 * ⚠ خطای واقعی که همین‌جا گرفته می‌شود: جدول Expense ستون `amount` ندارد،
 * `amountAfn` دارد. اگر روزی کسی `amount` بنویسد، صفحه بی‌صدا خالی می‌شود.
 */
/*
 * فقط **شاخه‌ی مصرف** سنجیده می‌شود. `doc.amount` برای رسید درست است
 * (جدول Receipt ستون amount دارد)؛ خطا فقط وقتی است که در شاخه‌ی مصرف
 * `amount` نوشته شود، چون جدول Expense اصلاً چنین ستونی ندارد.
 */
const expenseBranch = page.slice(page.indexOf("} else {"), page.indexOf('const headMeta'));
ok('شاخه‌ی مصرف از amountAfn می‌خواند', /doc\.amountAfn/.test(expenseBranch));
ok('شاخه‌ی مصرف هرگز doc.amount تنها را نمی‌خواند',
  !/doc\.amount(?!Afn|Usd)/.test(expenseBranch),
  (expenseBranch.match(/doc\.amount[^A-Za-z]/g) || []).join(','));

/* هر فیلد نام‌برده باید در کوئری SELECT * سرور برگردد — یعنی ستون واقعی باشد */
const receiptCols = ['customerName', 'amount', 'sourceName', 'relatedBillNo', 'receivedBy', 'note', 'no', 'date'];
const expenseCols = ['description', 'categoryName', 'amountAfn', 'amountUsd', 'shopName', 'purchaseBillNo', 'payerName', 'paymentType', 'note', 'no', 'date'];
for (const c of receiptCols) ok(`ستون Receipt.${c} در اسکیما هست`, schema.includes(`"${c}"`));
for (const c of expenseCols) ok(`ستون Expense.${c} در اسکیما هست`, schema.includes(`"${c}"`));

console.log('\n— ایمنی صفحه (از باگ‌های PrintSale) —');
ok('خطا پیام روشن دارد (نه «در حال آماده‌سازی» ابدی)', /سند باز نشد/.test(page) && /setErr\(/.test(page));
ok('cleanup با alive (پاسخ دیررس روی صفحه‌ی رفته نمی‌نشیند)', /let alive = true/.test(page) && /alive = false/.test(page));
ok('دکمه‌ی بازگشت در خطا هست', /onClick=\{\(\) => nav\(-1\)\}/.test(page));
ok('دکمه‌ی چاپ/PDF در نوار ابزار هست', /window\.print\(\)/.test(page));
ok('سرصفحه و پاصفحه‌ی شرکت مشترک است (DocHeader/DocFooter)',
  /<DocHeader/.test(page) && /<DocFooter/.test(page));
ok('CSS چاپ بارگذاری می‌شود', /import '\.\.\/styles\/print\.css'/.test(page));

/* ردیف‌های خالی نباید چاپ شوند (سند با ده خط «—» زشت است) */
ok('فیلدهای خالی چاپ نمی‌شوند', /String\(value\)\.trim\(\) !== ''/.test(page));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
