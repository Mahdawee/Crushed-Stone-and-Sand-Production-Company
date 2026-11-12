/**
 * تست «تاریخ ورودی» — شکار باگ دور ۳۴
 *
 *   npm run test:date-input
 *
 * ## باگی که این تست نگه می‌دارد
 * هم در UI (`lib/calendar.parseInputDate`) و هم در API (`common/calendar`)،
 * تقویمِ تاریخ **فقط از جداکننده** حدس زده می‌شد:
 *   • با تقویم شمسی، «2026/11/10» → سال ۲۰۲۶ **هجری** → سند `2648-01-30`
 *     (۶۲۱ سال جلو، بی‌هیچ خطایی؛ سند از فهرست ماه و راپور بیرون می‌افتاد).
 *   • با تقویم میلادی، «1405/08/19» → سال ۱۴۰۵ **میلادی**.
 *   • «۱۴۰۵-۰۸-۱۹» (خط تیره، همان چیزی که کیبورد/کپی می‌سازد) → ۱۴۰۵ میلادی.
 *
 * قاعده‌ی تازه: **بازه‌ی سال** تعیین می‌کند، نه جداکننده. شمسی امروز ۱۴۰۴
 * است و تا ۱۷۰۰ نمی‌رسد؛ میلادی ۲۰۲۶ است و زیر ۱۷۰۰ نمی‌آید. UI و API باید
 * دقیقاً یک چیز بگویند، وگرنه همان سند در فهرست دیده نمی‌شود.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let pass = 0, fail = 0;
const problems = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
};

/* ── UI: تابع را از سورس بیرون می‌کشیم و با یک shim اجرا می‌کنیم ──────────
   (به‌جای ساختن کل بسته‌ی Vite، همان تابع با همان وابستگی‌ها اجرا می‌شود.) */
const uiSrc = fs.readFileSync(path.join(root, 'apps/web/src/lib/calendar.ts'), 'utf8');

/*
 * همان فایل با **vite** (که خود پروژه دارد) تبدیل می‌شود — نه با regex.
 * تلاش اول با حذف دستی typeها شکننده بود؛ vite دقیقاً همان تبدیلی را
 * می‌دهد که برنامه‌ی واقعی می‌بیند.
 */
const { build } = await import('vite');
/* ⚠ داخل ریشه‌ی پروژه، نه /tmp — وگرنه import «jalaali-js» پیدا نمی‌شود */
const outDir = path.join(root, 'scripts/ui-check/.out-date');
await build({
  configFile: false,
  logLevel: 'silent',
  root,
  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    lib: { entry: path.join(root, 'apps/web/src/lib/calendar.ts'), formats: ['es'], fileName: () => 'calendar.mjs' },
    rollupOptions: { external: ['jalaali-js'] },
  },
});
const uiHelpers = await import(path.join(outDir, 'calendar.mjs'));

check('تابع parseInputDate از سورس UI در دسترس است', typeof uiHelpers.parseInputDate === 'function');

console.log('\n— UI: تقویم شمسی —');
const j = (s) => uiHelpers.parseInputDate(s, 'jalali');
check('«1405/08/19» شمسی → 2026-11-10', j('1405/08/19') === '2026-11-10', j('1405/08/19'));
check('«۱۴۰۵/۰۸/۱۹» با ارقام دری → 2026-11-10', j('۱۴۰۵/۰۸/۱۹') === '2026-11-10', j('۱۴۰۵/۰۸/۱۹'));
check('«1405-08-19» (خط تیره) → 2026-11-10', j('1405-08-19') === '2026-11-10', j('1405-08-19'));
check('«2026/11/10» (میلادی با اسلش) → همان 2026-11-10', j('2026/11/10') === '2026-11-10', j('2026/11/10'));
check('«2026-11-10» (ISO) → همان 2026-11-10', j('2026-11-10') === '2026-11-10', j('2026-11-10'));

console.log('\n— UI: تقویم میلادی —');
const g = (s) => uiHelpers.parseInputDate(s, 'gregorian');
check('«2026/11/10» → 2026-11-10', g('2026/11/10') === '2026-11-10', g('2026/11/10'));
check('«1405/08/19» با تقویم میلادی هم شمسی خوانده می‌شود', g('1405/08/19') === '2026-11-10', g('1405/08/19'));
check('«1405-08-19» با تقویم میلادی هم شمسی خوانده می‌شود', g('1405-08-19') === '2026-11-10', g('1405-08-19'));

console.log('\n— UI: تاریخ نامعتبر باید خطا بدهد (نه ۶۲۱ سال جلو) —');
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
check('«1405/13/01» ماه ۱۳ شمسی رد می‌شود', throws(() => j('1405/13/01')));
check('«2026/02/30» فوریه‌ی ۳۰ روزه رد می‌شود', throws(() => g('2026/02/30')));
check('«abc» رد می‌شود', throws(() => j('abc')));
check('خالی رد می‌شود', throws(() => j('')));

console.log('\n— UI: خواندن عدد از متن («۱۲,۵» متر نباید ۱۲۵ شود) —');
const n = (s) => uiHelpers.num(s);
check('«12,5» → ۱۲٫۵ (ممیز، نه هزارگان)', n('12,5') === 12.5, String(n('12,5')));
check('«۱۲,۵» با ارقام دری → ۱۲٫۵', n('۱۲,۵') === 12.5, String(n('۱۲,۵')));
check('«12٬500» هزارگان فارسی → ۱۲۵۰۰', n('12٬500') === 12500, String(n('12٬500')));
check('«1,234.5» → ۱۲۳۴٫۵', n('1,234.5') === 1234.5, String(n('1,234.5')));
check('«1.234,5» (سبک اروپایی) → ۱۲۳۴٫۵', n('1.234,5') === 1234.5, String(n('1.234,5')));
check('«۱۲٫۵» ممیز فارسی → ۱۲٫۵', n('۱۲٫۵') === 12.5, String(n('۱۲٫۵')));
check('«1000» ساده → ۱۰۰۰', n('1000') === 1000, String(n('1000')));
check('خالی → ۰', n('') === 0, String(n('')));
check('متن نامعتبر → ۰ (نه NaN)', n('abc') === 0, String(n('abc')));
check('منفی حفظ می‌شود', n('-3,5') === -3.5, String(n('-3,5')));

console.log('\n— API: همان قاعده، همان روز —');
/* سرور را از سورس می‌سازیم و مستقیم صدایش می‌زنیم (بدون HTTP) */
const apiDist = path.join(root, 'apps/api/dist/common/calendar.js');
if (!fs.existsSync(apiDist)) {
  check('بسته‌ی API برای مقایسه موجود است', false, `${apiDist} — اول npm run build -w @farday/api`);
} else {
  const cal = await import(`file://${apiDist}`);
  const aj = (s) => cal.parseUserDate(s, 'jalali');
  const ag = (s) => cal.parseUserDate(s, 'gregorian');
  check('API: «1405/08/19» → 2026-11-10', aj('1405/08/19') === '2026-11-10', aj('1405/08/19'));
  check('API: «2026/11/10» → 2026-11-10', aj('2026/11/10') === '2026-11-10', aj('2026/11/10'));
  check('API: «1405-08-19» → 2026-11-10', aj('1405-08-19') === '2026-11-10', aj('1405-08-19'));
  check('API: «۱۴۰۵-۰۸-۱۹» → 2026-11-10', ag('۱۴۰۵-۰۸-۱۹') === '2026-11-10', ag('۱۴۰۵-۰۸-۱۹'));
  /*
   * هم‌خوانی UI و API — این چیزی است که واقعاً خراب بود: UI یک روز را نشان
   * می‌داد و API روز دیگری را ذخیره می‌کرد.
   */
  const samples = ['1405/08/19', '1405-08-19', '2026/11/10', '2026-11-10', '۱۴۰۵/۱۲/۲۹', '1404/01/01'];
  let same = true;
  for (const s of samples) {
    let a = null, b = null;
    try { a = aj(s); } catch { a = 'خطا'; }
    try { b = j(s); } catch { b = 'خطا'; }
    if (a !== b) { same = false; problems.push(`UI/API برای «${s}» یکی نیستند: ${a} ≠ ${b}`); }
  }
  check('UI و API برای همه‌ی نمونه‌ها یک روز می‌دهند', same);
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام`);
if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
console.log('');
process.exit(fail === 0 ? 0 : 1);
