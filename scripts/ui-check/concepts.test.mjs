/**
 * بررسی «یک مفهوم، یک نام» در رابط کاربری و API — بدون مرورگر.
 *
 *   node scripts/ui-check/concepts.test.mjs
 *
 * سه چیزی که کاربر در دور ۱۷ خواست و این‌جا ماشینی سنجیده می‌شود:
 *   ۱) **«بیانیه» تنها بازمانده**: هیچ صفحه‌ای «پیش‌پرداخت»/«پیش پرداخت»/
 *      «بیانه» را به‌عنوان گزینه‌ی منبع رسید نشان ندهد (نگاشت داده در سرور
 *      مجاز و لازم است).
 *   ۲) **«مربوط» = شاخه‌ی مصرف**: هر جا «مربوط» برچسب یک ستون/فیلد است،
 *      «شاخه مصرف» هم کنارش باشد — تا کاربر بداند همان مفهوم است.
 *   ۳) **ناوبری درون‌برنامه‌ای**: هیچ‌جا برای رفتن به یک صفحه `href="#/…"`
 *      استفاده نشود (این کار کل سند را دوباره بار می‌کند و وضعیت را می‌ریزد —
 *      همان باگی که صفحه‌ی لایسنس را بن‌بست کرده بود).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const webDir = path.join(root, 'apps/web/src');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); }
  else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(webDir);
const rel = (p) => path.relative(root, p);
const read = (p) => fs.readFileSync(p, 'utf8');
const codeLines = (src) =>
  src.split('\n').map((line, i) => ({ line, no: i + 1 }))
    // خطوط توضیح و کامنت را کنار می‌گذاریم: متن فارسی توضیح، «گزینه‌ی کاربر» نیست
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));

/* ================================================================ */
console.log('\n— «بیانیه» تنها بازمانده (پیش‌پرداخت حذف شد) —');

const DEPRECATED = ['پیش‌پرداخت', 'پیش پرداخت', 'بیانه'];
let offenders = [];
for (const f of files) {
  for (const { line, no } of codeLines(read(f))) {
    for (const w of DEPRECATED) {
      if (line.includes(w)) offenders.push(`${rel(f)}:${no} → ${w}`);
    }
  }
}
ok('هیچ کد UI نام قدیمی منبع رسید را نشان نمی‌دهد', offenders.length === 0, offenders.join(' | '));

const lookupMeta = read(path.join(webDir, 'pages/lookupMeta.ts'));
ok('کشوی «از درک» در تنظیمات «بیانیه» را نام می‌برد', /receipt_source[\s\S]*?بیانیه/.test(lookupMeta));
ok('کشوی «از درک» «مربوط» را هم نام می‌برد', /receipt_source[\s\S]*?مربوط/.test(lookupMeta));

/* ================================================================ */
console.log('\n— «مربوط» = شاخه‌ی مصرف —');

/*
 * هر جا «مربوط» برچسب یک ستون/فیلد است (لیست ستون‌های جدول، label فیلد،
 * سرستون خروجی) باید «شاخه مصرف» هم بیاید. جمله‌های توضیحی آزادند.
 */
const LABEL_PATTERNS = [
  /label="[^"]*مربوط[^"]*"/g,
  /head=\{\[[^\]]*مربوط[^\]]*\]\}/g,
  /'[^']*مربوط[^']*',\s*'/g, // سرستون خروجی/چاپ کنار یک ستون دیگر
];
offenders = [];
for (const f of files.filter((p) => /\.tsx?$/.test(p))) {
  const src = read(f);
  for (const pat of LABEL_PATTERNS) {
    for (const m of src.matchAll(pat)) {
      if (m[0].includes('شاخه')) continue;
      /* «شماره بل مربوط» یک عبارت دیگر است (شماره بل فروش)، نه شاخه */
      if (m[0].includes('بل مربوط')) continue;
      offenders.push(`${rel(f)} → ${m[0].replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }
}
ok('هر برچسب «مربوط» توضیح «شاخه مصرف» دارد', offenders.length === 0, offenders.join(' | '));

const sales = read(path.join(webDir, 'pages/Sales.tsx'));
const expenses = read(path.join(webDir, 'pages/Expenses.tsx'));
const printSale = read(path.join(webDir, 'pages/PrintSale.tsx'));
const reports = read(path.join(webDir, 'pages/ReportsDetail.tsx'));
ok('فروشات: «مربوط (شاخه مصرف)»', /مربوط \(شاخه مصرف\)/.test(sales));
ok('مصارف: فیلد «مربوط (شاخه مصرف)»', /مربوط \(شاخه مصرف\)/.test(expenses));
ok('چاپ بل فروش: ردیف «مربوط (شاخه مصرف)»', /مربوط \(شاخه مصرف\)/.test(printSale));
ok('راپور: تب «مربوط (شاخه مصرف)»', /مربوط \(شاخه مصرف\)/.test(reports));
ok('راپور: جدول شاخه ستون‌های کرایه/مصرف/رسید را دارد',
  /byRelated/.test(reports) && /مجموع کرایه/.test(reports) && /مبلغ رسید/.test(reports));
ok('راپور: جمع کل شاخه‌ها نشان داده می‌شود', /relatedTotals/.test(reports));
ok('تنظیمات: فهرست شاخه‌ها «مربوط (شاخه مصرف)» نام دارد',
  /مربوط \(شاخه مصرف\)/.test(read(path.join(webDir, 'pages/Settings.tsx'))));
ok('راهنما: «مربوط» توضیح داده شده', /مربوط \(شاخه مصرف\)/.test(read(path.join(webDir, 'pages/Help.tsx'))));

/* ================================================================ */
console.log('\n— ناوبری: هیچ href="#/…" —');

offenders = [];
for (const f of files) {
  for (const { line, no } of codeLines(read(f))) {
    if (/href=\{?["'`]#\//.test(line) || /href=["']#\//.test(line)) offenders.push(`${rel(f)}:${no}`);
  }
}
ok('هیچ صفحه‌ای با href="#/…" ناوبری نمی‌کند', offenders.length === 0, offenders.join(' | '));

const app = read(path.join(webDir, 'App.tsx'));
ok('کلید بازگشت از لایسنس تعریف شده', /farday\.license\.returnTo/.test(app));
ok('مسیر /license قبل از دروازه‌ی قفل بررسی می‌شود',
  app.indexOf("pathname === '/license'") > 0 && app.indexOf("pathname === '/license'") < app.indexOf('lock-gate') + 1e6);
ok('صفحه‌ی لایسنس دکمه‌ی بازگشت می‌گیرد', /onBack=\{/.test(app) && /onBack/.test(read(path.join(webDir, 'pages/License.tsx'))));
ok('Layout آخرین مسیر کاری را نگه می‌دارد', /farday\.license\.returnTo/.test(read(path.join(webDir, 'components/Layout.tsx'))));

/* ================================================================ */
console.log('\n— API: یک منبع حقیقت برای منابع رسید —');

const apiDir = path.join(root, 'apps/api/src');
const domain = read(path.join(apiDir, 'common/domain.ts'));
ok('فایل دامنه منابع رسمی را تعریف می‌کند', /RECEIPT_SOURCES/.test(domain) && /'بیانیه'/.test(domain));
ok('نام‌های قدیمی نگاشت شده‌اند (داده‌ی قدیمی معتبر می‌ماند)', /RECEIPT_SOURCE_ALIASES/.test(domain) && /پیش پرداخت/.test(domain));

offenders = [];
for (const f of walk(apiDir).filter((p) => /\.ts$/.test(p) && !p.includes('/generated/') && !p.endsWith('domain.ts'))) {
  const src = read(f);
  for (const m of src.matchAll(/'امانت'/g)) {
    const lineNo = src.slice(0, m.index).split('\n').length;
    const line = src.split('\n')[lineNo - 1];
    if (/^\s*(\*|\/\/)/.test(line)) continue; // توضیح
    offenders.push(`${rel(f)}:${lineNo}`);
  }
}
ok('هیچ کوئری‌ای رشته‌ی «امانت» را دستی تکرار نمی‌کند', offenders.length === 0, offenders.join(' | '));
ok('شرط SQL از تابع مشترک می‌آید', /receiptDebtSql/.test(domain));
ok('کارت حساب هم از همان تصمیم استفاده می‌کند',
  /reducesCustomerDebt/.test(read(path.join(apiDir, 'modules/customers.controller.ts'))));
ok('مهاجرت داده برای نام‌های قدیمی هست', /migrateReceiptSources/.test(read(path.join(apiDir, 'schema.ts'))));

/* ================================================================ */
console.log('\n— کد مرده: هیچ کاری بعد از return نمی‌ماند —');

/*
 * باگ واقعی: در ۵ کنترلر، ثبت «سابقه فعالیت» بعد از `return` بود و هرگز
 * اجرا نمی‌شد؛ یعنی حذف‌ها در سابقه نمی‌آمدند و «قابل بازیابی» فقط روی
 * کاغذ بود. TypeScript این را خطا نمی‌دهد (allowUnreachableCode)، پس تست
 * باید بگیرد.
 */
const ctrls = fs.readdirSync(path.join(root, 'apps/api/src/modules'))
  .filter((f) => f.endsWith('.controller.ts'));
offenders = [];
for (const f of ctrls) {
  const lines = read(path.join(root, 'apps/api/src/modules', f)).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)return\b/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const nxt = lines[j];
      if (!nxt.trim()) continue;
      if (/^\s*(\/\/|\*|\/\*)/.test(nxt)) continue;
      const nIndent = nxt.length - nxt.trimStart().length;
      /*
       * فقط «دستور» را کد مرده می‌شماریم. خطوط ادامه‌ی یک رشته‌ی XML/HTML
       * (مثل `xmlns:x="…"`) دستور نیستند و همین‌جا کنار می‌روند.
       */
      const STATEMENT = /^(await |const |let |var |return\b|throw |if |for |while |switch |db\(|p\.|this\.|logActivity|nextDocNo|[A-Za-z_$][\w$]*\()/;
      if (nIndent <= indent && STATEMENT.test(nxt.trim())) {
        offenders.push(`${f}:${j + 1} — ${nxt.trim().slice(0, 50)}`);
      }
      break;
    }
  }
}
ok('هیچ کدی بعد از return رهاشده نیست (سابقه‌ی حذف واقعاً ثبت می‌شود)', offenders.length === 0, offenders.join(' | '));

offenders = [];
for (const f of ctrls) {
  const src = read(path.join(root, 'apps/api/src/modules', f));
  /* حذف‌نرم‌شده‌ها نباید در کارت حساب/شمارش‌ها بیایند */
  for (const m of src.matchAll(/FROM "(Sale|Receipt)" WHERE "customerId"=\?/g)) {
    const around = src.slice(m.index, m.index + 260);
    const cond = around.split('`')[0];
    if (/deletedAt/.test(cond)) continue;
    offenders.push(`${f} — ${m[0]}`);
  }
}
ok('کارت حساب و شمارش‌ها اسناد حذف‌شده را حساب نمی‌کنند', offenders.length === 0, offenders.join(' | '));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
