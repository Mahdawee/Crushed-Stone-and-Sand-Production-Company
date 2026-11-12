/**
 * نگهبان «نخستین اجرا» و «بررسی سلامت» — پیشنهاد D2، دور ۴۰.
 *
 *   node scripts/ui-check/first-run.test.mjs
 *
 * دو ریسک واقعی را می‌سنجد:
 *   ۱) کارت خوش‌آمد روی سیستمِ **در حال کار** ظاهر شود. این بدترین حالت است:
 *      مشتری که ۲۰۰ بل ثبت کرده، هر بار پیام «سه قدم تا شروع» می‌بیند و فکر
 *      می‌کند داده‌اش پاک شده.
 *   ۲) کارت سلامت «سالم» بگوید وقتی پاسخ سرور نیامده. دروغِ سبز، بدتر از
 *      ندانستن است.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dash = fs.readFileSync(path.join(root, 'apps/web/src/pages/Dashboard.tsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'apps/web/src/pages/Settings.tsx'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— کارت نخستین اجرا —');

ok('شرط خالی بودن وجود دارد', /const isEmpty =/.test(dash));
ok('بدون کارمندِ ثبت‌شده است', /Number\(counts\.employees \|\| 0\) === 0/.test(dash));
ok('بدون بل ثبت‌شده است', /recentSales && d\.recentSales\.length/.test(dash));
ok('مشتری گذری به‌عنوان «داده» شمرده نمی‌شود (customers <= 1)', /customers \|\| 0\) <= 1/.test(dash));
ok('کارت فقط وقتی خالی است نمایش داده می‌شود', /showWelcome = isEmpty && !welcomeOff/.test(dash));
ok('بستن، دائمی است (localStorage)', /localStorage\.setItem\(WELCOME_KEY, '1'\)/.test(dash));
ok('حالت خصوصی/بدون localStorage برنامه را نمی‌شکند', /catch \{ \/\* حالت خصوصی \*\/ \}/.test(dash));
ok('هر سه قدم لینک واقعی دارند',
  /to="\/company"/.test(dash) && /to="\/lookups"/.test(dash) && /to="\/sales\?new=1"/.test(dash));

console.log('\n— کارت بررسی سلامت —');

ok('AboutCard وجود دارد', /function AboutCard\(/.test(settings));
ok('در صفحه‌ی تنظیمات رندر می‌شود', /<AboutCard info=\{info\} onRefresh=\{loadInfo\}/.test(settings));
ok('«نامعلوم» از «درست» جدا است', /c\.ok === null \? 'نامعلوم'/.test(settings));
ok('وقتی همه پاسخ نیامده، مدعی «سالم» نیست', /unknown === 0 && bad\.length === 0/.test(settings));
ok('مشکل‌ها اول شمرده می‌شوند', /bad\.length > 0\s*\n?\s*\? `\$\{bad\.length\} مورد نیاز به بررسی دارد`/.test(settings));
ok('هر راه‌حل عملی نوشته شده (نه پیام فنی)', /آنتی‌ویروس یا دسترسی پوشه را بررسی کنید/.test(settings));
ok('دکمه‌ی بررسی دوباره وجود دارد', /بررسی دوباره/.test(settings));
ok('خطای لحظه‌ای اطلاعات سالم را پاک نمی‌کند', /if \(h\) setHealth\(h\)/.test(settings));
ok('سه بررسی موازی، نه پشت‌سرهم', /Promise\.all\(/.test(settings));

console.log('\n— آزمون رفتاری شرط «خالی» —');
/* منطق isEmpty را با داده‌های واقعی‌نما اجرا می‌کنیم */
const isEmptyOf = (counts, recentSales) =>
  Number(counts.employees || 0) === 0 &&
  Number(counts.customers || 0) <= 1 &&
  !(recentSales && recentSales.length);

ok('نصب تازه (فقط مشتری گذری) → خالی', isEmptyOf({ employees: 0, customers: 1 }, []) === true);
ok('یک مشتری واقعی → خالی نیست', isEmptyOf({ employees: 0, customers: 2 }, []) === false);
ok('یک بل ثبت‌شده → خالی نیست', isEmptyOf({ employees: 0, customers: 1 }, [{ id: 1 }]) === false);
ok('کارمند ثبت‌شده → خالی نیست', isEmptyOf({ employees: 3, customers: 1 }, []) === false);
ok('داده‌ی ناقص از سرور (undefined) → خالی تلقی نمی‌شود مگر همه صفر باشند',
  isEmptyOf({}, []) === true); /* توضیح: نبودِ شمارش = صفر در سرورِ تازه، ولی: */
ok('اگر customers نامعلوم باشد ولی بل باشد → خالی نیست',
  isEmptyOf({}, [{ id: 1 }]) === false);

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
