/**
 * نگهبان جست‌وجوی سراسری (Ctrl+K) — پیشنهاد C1، دور ۴۰.
 *
 *   node scripts/ui-check/global-search.test.mjs
 *
 * این تست سه چیز را قفل می‌کند:
 *   ۱) **سرور**: ستون‌های متنی هر سند واقعاً جست‌وجو می‌شوند. باگ اولی که در
 *      همین دور رخ داد این بود که فقط «شماره» و «مبلغ» گشته می‌شد و جست‌وجوی
 *      «دیزل» (شرح یک مصرف واقعی) صفر نتیجه می‌داد.
 *   ۲) **سرور**: `%` و `_` در ورودی کاربر escape می‌شوند، وگرنه یک `%` تنها
 *      همه‌ی ردیف‌ها را برمی‌گرداند.
 *   ۳) **فرانت**: درخواست‌ها لغو می‌شوند و خطا **دیده** می‌شود (نه سکوت).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const api = fs.readFileSync(path.join(root, 'apps/api/src/modules/search.controller.ts'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'apps/web/src/components/GlobalSearch.tsx'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'apps/web/src/components/Layout.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'apps/web/src/styles/app.css'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— سرور جست‌وجو —');

/* ۱) یا کمتر از ۲ حرف نتیجه نمی‌دهد */
ok('کمتر از ۲ حرف نتیجه نمی‌دهد', /q\.length < 2/.test(api));
ok('عبارت خالی همه‌ی ردیف‌ها را برنمی‌گرداند', /return \{ q, hits: \[\] as SearchHit\[\] \}/.test(api));

/* ۲) escape درست برای LIKE */
ok('تابع escape برای % و _ دارد', /replace\(\/\[\\\\%_\]\/g/.test(api), 'likePattern');
/*
 * شمارش ساده‌ی رشته‌ای، نه regex: در سورس، الگوی SQL به شکل `ESCAPE '\\'`
 * نوشته شده (دو بک‌اسلش) و regex آن را به‌راحتی از دست می‌دهد. شمارش
 * زیررشته‌ای مقاوم است و همان چیزی را می‌سنجد که به SQLite می‌رسد.
 */
/* فقط SQL واقعی سنجیده می‌شود — نه توضیح‌های داخل کامنت که ESCAPE را ذکر می‌کنند */
const sqlOnly = api.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
const likeCount = (sqlOnly.match(/LIKE \?/g) || []).length;
const escapeCount = (sqlOnly.match(/ESCAPE '/g) || []).length;
ok('هر کوئری LIKE از ESCAPE استفاده می‌کند', likeCount === escapeCount,
  `${likeCount} LIKE vs ${escapeCount} ESCAPE`);

/* ۳) ستون‌های متنی واقعی — باگ واقعی این دور */
const mustSearch = [
  ['Sale', '"materialName"'], ['Sale', '"customerName"'],
  ['Receipt', '"sourceName"'], ['Receipt', '"receivedBy"'],
  ['Expense', '"description"'], ['Expense', '"shopName"'], ['Expense', '"categoryName"'],
];
for (const [table, col] of mustSearch) {
  ok(`${table}: ${col} جست‌وجو می‌شود`, api.includes(col));
}

/* ۴) اسناد حذف‌شده هرگز برنمی‌گردند */
ok('همه‌ی بخش‌ها شرط «زنده» دارند', /const LIVE = `COALESCE\("deletedAt",''\)=''`/.test(api));
ok('جست‌وجوی مشتری مشتری گذری را حذف می‌کند', /isWalkIn" IS NULL OR "isWalkIn"=0/.test(api));

/* ۵) هیچ رشته‌ی کاربر داخل SQL نمی‌چسبد */
ok('الگوی جست‌وجو پارامتر bind است، نه رشته‌ی درهم‌آمیخته', !/LIKE '%\$\{/.test(api) && !/\$\{q\}/.test(api));

/* ۶) شکست یک بخش، کل جست‌وجو را نمی‌خواباند */
ok('هر بخش در try/catch است', /catch \(e: any\) \{ console\.warn\('جست‌وجو بخشی را رد کرد/.test(api));

console.log('\n— فرانت: پنجره و میان‌بر —');

ok('Ctrl+K در Layout وصل شده', /e\.key\.toLowerCase\(\) === 'k'/.test(layout));
ok('preventDefault شده (نوار آدرس مرورگر باز نمی‌شود)', /ctrlKey \|\| e\.metaKey[\s\S]{0,200}preventDefault/.test(layout) || /preventDefault\(\);\s*\n\s*setSearchOpen/.test(layout));
ok('حذف شنونده در cleanup', /removeEventListener\('keydown', onCtrlK\)/.test(layout));
ok('دکمه‌ی ذره‌بین هم هست (کاربر میان‌بر را نمی‌داند)', /topbar-search/.test(layout));
ok('پنجره در Layout رندر می‌شود', /<GlobalSearch open=\{searchOpen\}/.test(layout));

ok('تأخیر تایپ دارد (۲۵۰ms)', /250\)/.test(ui));
ok('درخواست قبلی لغو می‌شود', /AbortController/.test(ui) && /abortRef\.current\?\.abort\(\)/.test(ui));
ok('پاسخ کهنه نادیده گرفته می‌شود', /ctl\.signal\.aborted/.test(ui));
ok('خطا به کاربر نشان داده می‌شود', /gs-err/.test(ui) && /جست‌وجو انجام نشد/.test(ui));
ok('پیمایش با ↑↓', /ArrowDown/.test(ui) && /ArrowUp/.test(ui));
ok('Enter انتخاب می‌کند', /e\.key === 'Enter'/.test(ui));
ok('Esc می‌بندد', /e\.key === 'Escape'/.test(ui));
ok('حداقل ۲ حرف در فرانت هم رعایت می‌شود', /term\.length < 2/.test(ui));
ok('نتیجه‌ی انتخاب‌شده در دید می‌آید (scrollIntoView)', /scrollIntoView/.test(ui));
ok('مسیرها فقط از پاسخ سرور می‌آیند (بدون ساخت دستی /customers/)', !/path:\s*[`'"]\/customers\//.test(ui));

console.log('\n— استایل —');
ok('کلاس‌های پنجره در CSS هست', /\.gs-backdrop/.test(css) && /\.gs-panel/.test(css) && /\.gs-row\.on/.test(css));
ok('بالاتر از مودال‌های عادی است', /\.gs-backdrop \{[^}]*z-index: 130/.test(css));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
