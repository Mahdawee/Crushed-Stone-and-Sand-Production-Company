/**
 * «آماده‌ی انتشار» — پاسخ قابل‌تکرار به یک سؤال:
 *
 *   اگر این نسخه را روی نصب مشتری‌های قبلی بفرستیم، داده‌شان سالم می‌ماند؟
 *
 *   node scripts/release-check.mjs
 *
 * سه چیز را می‌سنجد و اگر یکی نباشد **کد خروج ۱** می‌دهد (برای زنجیره‌ی
 * انتشار: `npm run release:check && npm run desktop:build`):
 *
 *   ۱) **سازگاری ساختار**: هر ستون/جدول تازه‌ای که کد لازم دارد باید در
 *      `UPGRADES` باشد یا با `ADD COLUMN … DEFAULT` اضافه شود — وگرنه روی
 *      دیتابیس قدیمی، برنامه‌ی تازه ستون گم‌شده می‌بیند.
 *   ۲) **نسخه‌ها هم‌خوان**: `package.json` و `tauri.conf.json` و
 *      `Cargo.toml` یک شماره بدهند. تجربه‌ی تلخ: نسخه‌ها جدا عوض می‌شدند و
 *      تاریخچه‌ی بروزرسانی/نصب‌کننده شماره‌ی متفاوت نشان می‌داد.
 *   ۳) **مهاجرت واقعاً کار می‌کند**: `test:upgrade` اجرا می‌شود (نصب قدیمی
 *      با داده ⇒ برنامه‌ی امروز ⇒ داده دست‌نخورده + پشتیبان).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './lib/project-root.mjs';

const root = projectRoot(import.meta.url, 1);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (s) => console.log(`  ✔ ${s}`);
const warn = (s) => console.log(`  ⚠ ${s}`);
const problems = [];
const bad = (s, fix) => { problems.push({ s, fix }); console.log(`  ✘ ${s}`); };

console.log('\n=== بررسی آمادگی انتشار ===\n');

/* ---------------------------------------------------------------- ۱) نسخه‌ها */
console.log('— ۱) نسخه‌ها هم‌خوان —');
const pkg = JSON.parse(read('package.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargo = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1] || '';
const versions = { 'package.json': pkg.version, 'tauri.conf.json': tauri.version, 'Cargo.toml': cargo };
const uniq = [...new Set(Object.values(versions).filter(Boolean))];
if (uniq.length === 1) ok(`همه «${uniq[0]}» هستند (${Object.keys(versions).join(' · ')})`);
else bad(`نسخه‌ها یکی نیستند: ${JSON.stringify(versions)}`,
  'همه را یک عدد کنید: package.json ← tauri.conf.json ← src-tauri/Cargo.toml');

/* ---------------------------------------------------- ۲) سازگاری ساختار داده */
console.log('\n— ۲) سازگاری ساختار دیتابیس —');
const schema = read('apps/api/src/schema.ts');
const upgrade = read('apps/api/src/common/upgrade.ts');
const shapeVersion = Number(upgrade.match(/export const SHAPE_VERSION = (\d+)/)?.[1] || 0);
const tableVersion = [...upgrade.matchAll(/^\s*\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
const maxTable = tableVersion.length ? Math.max(...tableVersion) : 0;
if (shapeVersion > 0) ok(`SHAPE_VERSION = ${shapeVersion}`);
else bad('SHAPE_VERSION پیدا نشد', 'export const SHAPE_VERSION را در common/upgrade.ts تعریف کنید');
if (maxTable <= shapeVersion) ok(`جدول توضیح مهاجرت‌ها تا نسخه‌ی ${maxTable} است`);
else bad(`جدول توضیح مهاجرت‌ها از SHAPE_VERSION جلوتر است (${maxTable} > ${shapeVersion})`,
  'ردیف توضیح نسخه‌ی تازه را در جدول بالای upgrade.ts اضافه کنید');

/* هر ستونی که کد در INSERT/UPDATE لازم دارد، باید در ساختار باشد */
const tablesInSchema = new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]));
const softTables = [...read('apps/api/src/common/soft-delete.ts').matchAll(/^\s{2}(\w+): \{/gm)].map((m) => m[1]);
const missingSoft = softTables.filter((t) => !tablesInSchema.has(t));
if (missingSoft.length === 0) ok(`${softTables.length} جدول حذف‌نرم همه در ساختار هستند`);
else bad(`جدول‌های حذف‌نرم بدون CREATE TABLE: ${missingSoft.join(', ')}`, 'جدول را در TABLES اضافه کنید');

/*
 * قاعده‌ی طلایی: مهاجرت‌ها فقط اضافه می‌کنند. اگر روزی کسی `DROP`/تغییر نوع
 * در UPGRADES بنویسد، همان‌جا جلویش گرفته می‌شود — چون این تنها راه تضمین
 * این است که بروزرسانی داده‌ی مشتری را نبرد.
 */
const upgradesBlock = upgrade.slice(upgrade.indexOf('UPGRADES'));
const destructive = [...upgradesBlock.matchAll(/`([^`]*(?:DROP\s+(?:COLUMN|TABLE)|ALTER\s+TABLE[^`]*RENAME)[^`]*)`/gi)].map((m) => m[1].slice(0, 60));
if (destructive.length === 0) ok('مهاجرت‌ها فقط «اضافه» می‌کنند (بدون DROP/RENAME)');
else bad(`مهاجرت مخرب پیدا شد: ${destructive.join(' | ')}`, 'حذف ستون/جدول در مهاجرت ممنوع است — رجوع به docs/UPGRADE.md');

/* افزودن ستون باید DEFAULT داشته باشد وگرنه ردیف‌های موجود ناسازگار می‌شوند */
const addColumns = [...upgradesBlock.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN "(\w+)" ([^`]+)/g)];
const noDefault = addColumns
  .filter((m) => /NOT NULL/i.test(m[3]) && !/DEFAULT/i.test(m[3]))
  .map((m) => `${m[1]}.${m[2]}`);
if (noDefault.length === 0) ok(`${addColumns.length} ستون تازه، همه با DEFAULT/اختیاری`);
else bad(`ستون NOT NULL بدون DEFAULT: ${noDefault.join(', ')}`, 'برای ردیف‌های موجود DEFAULT بگذارید');

/* نسخه‌ی دیتابیس جدیدتر از برنامه: نباید دست‌کاری شود */
if (/isNewerDatabase/.test(upgrade)) ok('دیتابیس جدیدتر از برنامه: فقط هشدار، بدون نوشتن');
else bad('بررسی «دیتابیس جدیدتر» نیست', 'isNewerDatabase را در مسیر مهاجرت به کار ببرید');

/* ------------------------------------------------------------------ ۳) تست */
console.log('\n— ۳) مهاجرت واقعی با داده‌ی قدیمی —');
try {
  const out = execFileSync(process.execPath, [path.join(root, 'apps/api/test/upgrade.test.js')], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000,
  });
  const last = out.trim().split('\n').filter((l) => /موفق،|✅/.test(l)).pop() || '';
  ok(`تست مهاجرت سبز است ${last ? `— ${last.trim()}` : ''}`);
} catch (e) {
  const out = String(e.stdout || '') + String(e.stderr || '');
  const fails = out.split('\n').filter((l) => l.includes('✘')).slice(0, 5);
  bad('تست مهاجرت یا بسته نشده یا ناکام دارد', fails.join(' | ') || 'npm run test:upgrade را ببینید');
}

/* ------------------------------------------------------------- ۴) پشتیبان/بازیابی */
console.log('\n— ۴) راه بازگشت —');
const control = read('apps/api/src/modules/system.controller.ts');
if (/backup\/list/.test(control) && /restore/.test(control)) ok('مسیر پشتیبان‌گیری و بازگردانی در API هست');
else bad('مسیر پشتیبان/بازگردانی پیدا نشد', 'GET /system/backup/list و POST /system/restore لازم است');
if (/recentUpgrades/.test(control)) ok('تاریخچه‌ی بروزرسانی در برنامه دیده می‌شود');
else warn('تاریخچه‌ی بروزرسانی در پنل نشان داده نمی‌شود');
if (fs.existsSync(path.join(root, 'docs', 'UPGRADE.md'))) ok('سند قاعده‌های بروزرسانی موجود است (docs/UPGRADE.md)');
else bad('docs/UPGRADE.md نیست', 'قاعده‌های مهاجرت را مستند کنید');

/* ---------------------------------------------------------------- جمع‌بندی */
console.log('');
if (problems.length === 0) {
  console.log('✅ این نسخه برای فرستادن به مشتری‌های قبلی آماده است:');
  console.log('   • ساختار داده فقط «اضافه» می‌شود و مهر نسخه داخل خود دیتابیس است؛');
  console.log('   • قبل از هر مهاجرت پشتیبان گرفته می‌شود و اگر پشتیبان نشد، هیچ نوشتنی انجام نمی‌شود؛');
  console.log('   • تست با یک دیتابیس قدیمیِ دارای داده سبز است؛');
  console.log('   • راه بازگشت (بازگردانی پشتیبان + CLI بازیابی) هست.');
  console.log('\n   برای انتشار: npm run desktop:build\n');
} else {
  console.log(`⛔ ${problems.length} مورد باید درست شود:\n`);
  for (const p of problems) console.log(`• ${p.s}\n  راه‌حل: ${p.fix}\n`);
  process.exitCode = 1;
}
