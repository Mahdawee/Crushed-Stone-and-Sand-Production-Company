/**
 * نگهبان «بارگذاری اولیه سبک بماند».
 *
 *   node scripts/ui-check/bundle-weight.test.mjs
 *
 * ── چرا این تست (پیشنهاد B1، دور ۴۰) ───────────────────────────────────
 * هدف این بود که کتابخانه‌ی نمودار (~۳۵۰KB) در **هر** باز شدن برنامه دانلود
 * نشود. دو اشتباه پشت‌سرهم این هدف را از بین برده بود و هیچ تستی نمی‌گرفت:
 *   ۱) `Dashboard` در `App.tsx` **eager** مانده بود و recharts را می‌کشید.
 *   ۲) `manualChunks` با قاعده‌ی «d3-» helperهای مشترک را به چانک charts
 *      می‌برد و `index.js` یک import ثابت از آن می‌گرفت — حتی بعد از lazy
 *      کردن داشبورد، `index.html` همان چانک را `modulepreload` می‌کرد.
 *
 * این تست به باندل **ساخته‌شده** نگاه می‌کند (نه به سورس): هر فایلی که در
 * `index.html` مستقیم یا با `modulepreload` آمده، «مسیر بحرانی» است و نباید
 * چانک نمودار را شامل شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'apps/web/dist');
const indexPath = path.join(dist, 'index.html');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— وزن بارگذاری اولیه —');

if (!fs.existsSync(indexPath)) {
  console.log('  ⚠ باندل web ساخته نشده (apps/web/dist) — اول npm run build -w @farday/web');
  console.log('\n⚠ بررسی انجام نشد\n');
  process.exit(2);
}

const html = fs.readFileSync(indexPath, 'utf8');
/* فایل‌هایی که مرورگر قبل از اولین رندر می‌گیرد */
const critical = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const preloaded = [...html.matchAll(/modulepreload"[^>]*href="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const eager = [...new Set([...critical, ...preloaded])];

console.log(`  فایل‌های مسیر بحرانی: ${eager.join(', ') || '(هیچ)'}`);
ok('index.html حداقل یک اسکریپت اصلی دارد', critical.length > 0, eager.join(','));

const sizeOf = (f) => {
  try { return fs.statSync(path.join(dist, f)).size; } catch { return 0; }
};
const eagerBytes = eager.reduce((a, f) => a + sizeOf(f), 0);
const KB = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`  حجم مسیر بحرانی: ${KB(eagerBytes)}`);

/* ۱) چانک نمودار نباید در مسیر بحرانی باشد */
const CHARTY = /(charts|CartesianChart|recharts|d3)/i;
const chartInCritical = eager.filter((f) => CHARTY.test(f));
ok('چانک نمودار در مسیر بحرانی نیست', chartInCritical.length === 0, chartInCritical.join(', '));

/* ۲) واقعاً چانک نمودار وجود دارد (اگر روزی حذف شود، تست بالا بی‌معنا می‌شود) */
const assets = fs.existsSync(path.join(dist, 'assets')) ? fs.readdirSync(path.join(dist, 'assets')) : [];
const chartChunk = assets.find((f) => CHARTY.test(f) && f.endsWith('.js'));
ok('چانک نمودار ساخته می‌شود (و lazy است)', Boolean(chartChunk), assets.filter((f) => f.endsWith('.js')).slice(0, 6).join(','));

/* ۳) سقف حجم مسیر بحرانی — تا رشد خاموش جلوی چشم بیاید */
const BUDGET = 400 * 1024;
ok(`مسیر بحرانی زیر سقف ${KB(BUDGET)} است`, eagerBytes <= BUDGET, KB(eagerBytes));

/* ۴) داشبورد نباید eager باشد */
const appSrc = fs.readFileSync(path.join(root, 'apps/web/src/App.tsx'), 'utf8');
ok('داشبورد lazy است', /const Dashboard = lazy\(/.test(appSrc));
ok('ورود/لایسنس عمداً eager مانده‌اند (اولین صفحه)', /import LoginPage from/.test(appSrc));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
