/**
 * آماده‌سازی باینری ویندوزی libSQL برای **ساخت آفلاین**.
 *
 *   node scripts/prefetch-libsql.mjs
 *   (به‌طور خودکار داخل `npm run desktop:prefetch` اجرا می‌شود)
 *
 * ## چرا این فایل لازم است
 * برنامه با libSQL (SQLite) کار می‌کند و باینری بومی (`index.node`) بخشی از
 * بسته‌ی npm است. `npm ci` فقط باینری **همین سیستم** را نصب می‌کند؛ اگر
 * ساخت روی لینوکس انجام شود (یا پوشه `@libsql/win32-x64-msvc` نباشد)،
 * نصب‌کننده‌ی ویندوزی بدون درایور SQLite ساخته می‌شود و روی ویندوز صفحه‌ی
 * سفید می‌مانَد.
 *
 * راه‌حل: یک بار (با انترنت) فایل tgz را در `.cache/libsql/` ذخیره می‌کنیم.
 * بعد از آن، `scripts/build-desktop-api.mjs` در حالت `--offline` می‌تواند
 * بدون هیچ درخواست شبکه‌ای همان بسته را باز کند.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = '@libsql/win32-x64-msvc';
const cacheDir = path.join(root, '.cache', 'libsql');

/** نسخه از بسته‌های نصب‌شده — تا با همان نسخه‌ی بقیه هم‌خوان باشد */
function version() {
  for (const rel of [
    ['node_modules', '@libsql', 'libsql', 'package.json'],
    ['node_modules', '@libsql', 'client', 'package.json'],
    ['node_modules', '@libsql', 'linux-x64-gnu', 'package.json'],
  ]) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(root, ...rel), 'utf8')).version;
      if (v) return v;
    } catch { /* بعدی */ }
  }
  return '';
}

/**
 * نسخه‌ی درست همان نسخه‌ی `@libsql/client` نیست؛ باینری‌ها نسخه‌ی خودشان را
 * دارند. بهترین راه: از خود npm بپرسیم چه نسخه‌ای از `@libsql/win32-x64-msvc`
 * با درخت فعلی هم‌خوان است. اگر نشد، از `@libsql/client` استفاده می‌کنیم.
 */
function resolveVersion() {
  try {
    const out = execFileSync('npm', ['view', PKG, 'version'], { cwd: root, encoding: 'utf8' }).trim();
    if (/^\d+\.\d+\.\d+/.test(out)) return out.split(/\s+/).pop();
  } catch { /* آفلاین یا npm نیست */ }
  return version() || '0.5.29';
}

const v = resolveVersion();
const file = path.join(cacheDir, `win32-x64-msvc-${v}.tgz`);
const dest = path.join(root, 'node_modules', '@libsql', 'win32-x64-msvc');

if (fs.existsSync(path.join(dest, 'index.node'))) {
  console.log(`   ✔ باینری ویندوزی libSQL از قبل نصب است (${v})`);
  process.exit(0);
}
if (fs.existsSync(file) && fs.statSync(file).size > 100_000) {
  console.log(`   ✔ کش libSQL موجود است: ${path.relative(root, file)}`);
  process.exit(0);
}

fs.mkdirSync(cacheDir, { recursive: true });
const url = `https://registry.npmjs.org/${PKG}/-/win32-x64-msvc-${v}.tgz`;
console.log(`   ↳ دانلود ${PKG}@${v}…`);
try {
  execFileSync('curl', ['-fL', '--retry', '3', '--connect-timeout', '20', '-o', file, url], { stdio: 'inherit' });
  if (!fs.existsSync(file) || fs.statSync(file).size < 100_000) throw new Error('فایل دانلودشده خالی است');
  console.log(`   ✔ ذخیره شد: ${path.relative(root, file)}`);
} catch (e) {
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
  console.error(`   ⚠ دانلود نشد: ${e instanceof Error ? e.message : e}`);
  console.error('     ساخت آفلاین روی این کمپیوتر ممکن نخواهد بود تا این فایل موجود شود.');
  process.exit(1);
}
