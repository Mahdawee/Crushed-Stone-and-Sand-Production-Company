/**
 * نگهبان صفحه‌ی «بدهی و یادآوری» — پیشنهاد C5، دور ۴۰.
 *
 *   node scripts/ui-check/debts-page.test.mjs
 *
 * ── چه چیزی را می‌گیرد ──────────────────────────────────────────────────
 *  ۱) کلاس CSS تخیلی: من در نسخه‌ی اول `stat-big` و `tag` نوشتم که در
 *     app.css وجود ندارند. صفحه **کامپایل می‌شود** و باز می‌شود، فقط
 *     بی‌استایل است. هیچ تستی این را نمی‌گیرد مگر اینکه بگردد.
 *  ۲) مسیر/منو جا افتاده: صفحه ساخته شود ولی لینکی به آن نباشد.
 *  ۳) جمع سمت رابط: اگر صفحه خودش عدد جمع بزند، دیر یا زود با سرور
 *     اختلاف پیدا می‌کند (باگ «سه صفحه، سه عدد»، دور ۳۲).
 *  ۴) دکمه‌ی واتساپ با شماره‌ی خالی.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const page = read('apps/web/src/pages/Debts.tsx');
const app = read('apps/web/src/App.tsx');
const layout = read('apps/web/src/components/Layout.tsx');
const css = read('apps/web/src/styles/app.css');
const ctrl = read('apps/api/src/modules/debts.controller.ts');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— کلاس‌های CSS واقعاً وجود دارند —');

/*
 * هر کلاس ثابتی که در className می‌آید باید در app.css تعریف شده باشد.
 * عبارت‌های پویا (`${…}`) کنار گذاشته می‌شوند؛ نام‌های داخل آن‌ها
 * جای دیگری سنجیده می‌شوند.
 */
const staticClasses = new Set();
for (const m of page.matchAll(/className="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && staticClasses.add(c));
for (const m of page.matchAll(/className=\{`([^`]+)`\}/g)) {
  m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).forEach((c) => c && staticClasses.add(c));
}
const missing = [...staticClasses].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
ok('هیچ کلاس بی‌استایلی استفاده نشده', missing.length === 0, missing.join(', '));
ok(`آماری ${staticClasses.size} کلاس سنجیده شد`, staticClasses.size >= 8, String(staticClasses.size));

console.log('\n— متغیرهای CSS —');
/*
 * `--bad` وجود ندارد؛ درستش `--danger` است. استفاده از متغیر ناموجود
 * در style باعث می‌شود مرورگر همان رنگ را دور بریزد و متن سیاه بماند.
 */
const vars = [...page.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
const badVars = [...new Set(vars)].filter((v) => !css.includes(`${v}:`));
ok('هیچ متغیر CSS ناموجودی استفاده نشده', badVars.length === 0, badVars.join(', '));

console.log('\n— مسیر، منو و راه‌اندازی —');
ok('صفحه lazy بارگذاری می‌شود', /const DebtsPage = lazy\(\(\) => import\('\.\/pages\/Debts'\)\)/.test(app));
ok('مسیر /debts تعریف شده', /path="\/debts" element=\{<DebtsPage \/>\}/.test(app));
ok('لینک در منو هست', /to: '\/debts', label: 'بدهی و یادآوری'/.test(layout));
ok('عنوان صفحه تعریف شده', /'\/debts': \{ t: 'بدهی و یادآوری'/.test(layout));
ok('از IconCoins استفاده می‌شود که وجود دارد', /IconCoins/.test(layout));

console.log('\n— قاعده‌ی «عدد از سرور» —');
ok('از /debts خوانده می‌شود', /api\.get\('\/debts'\)/.test(page));
ok('متن یادآوری از سرور می‌آید', /api\.get\(`\/debts\/\$\{r\.id\}\/reminder`\)/.test(page));
/*
 * جمع «نمایش‌داده‌شده» در رابط مجاز است (فیلتر محلی است و سرور از آن
 * خبر ندارد)، ولی جمع کل باید از `data.total` بیاید. این تست مطمئن
 * می‌شود `data.total` هست و جای محاسبه‌ی دستی (reduce روی rows برای کل)
 * استفاده نشده.
 */
ok('جمع کل از server.total می‌آید', /money\(data\.total\)/.test(page));
ok('جمع بدهی دستی حساب نمی‌شود', !/rows\.reduce\([^)]*balance/.test(page));
ok('تفکیک سنی از server.buckets می‌آید', /data\.buckets\?\.\[b\.key\]/.test(page));

console.log('\n— ایمنی تعامل —');
ok('cleanup با alive', /let alive = true/.test(page) && /alive = false/.test(page));
ok('خطای بارگذاری پیام و دکمه‌ی تلاش دارد', /تلاش دوباره/.test(page));
ok('واتساپ فقط با شماره‌ی موجود فعال است', /reminder\.phone \?/.test(page));
ok('کلیپ‌بورد پلن ب دارد (وعده‌ی دروغ نمی‌دهد)', /catch \{/.test(page) && /Ctrl\+C/.test(page));
ok('صف خالی پیام روشن دارد', /هیچ مشتری‌ای بدهکار نیست/.test(page));

console.log('\n— سمت سرور —');
ok('کنترلر ثبت شده', /DebtsController/.test(read('apps/api/src/app.module.ts')));
ok('تاریخ «مانده‌ی قبلی» جعل نمی‌شود', /fromOpening/.test(ctrl));
ok('همه‌ی کوئری‌ها حذف‌نرم‌شده را کنار می‌گذارند', /\$\{LIVE\}/.test(ctrl));
ok('رسید امانت/بیانیه از domain.ts می‌آید', /receiptDebtSql/.test(ctrl));
ok('مشتری گذری بیرون است', /realCustomerSql/.test(ctrl));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
