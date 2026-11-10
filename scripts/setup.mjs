/**
 * آماده‌سازی پروژه بعد از هر «git pull»
 *
 *   npm run setup
 *
 * به‌ترتیب و با پیام روشن:
 *   ۱) بررسی Node
 *   ۲) npm install (اگر node_modules ناقص/قدیمی است)
 *   ۳) تولید کلاینت Prisma (در این پروژه: آماده‌سازی schema)
 *   ۴) build کل پروژه (API + رابط)
 *   ۵) گزارش کوتاه «آماده است»
 *
 * اگر لازم نبود، مرحله‌ها رد می‌شوند تا هر بار چند دقیقه معطل نشوید.
 * برای اجرای اجباری همه مرحله‌ها:  npm run setup -- --force
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const has = (rel) => fs.existsSync(path.join(root, rel));

const step = (n, title) => console.log(`\n▶ ${n}) ${title}`);
const skip = (why) => console.log(`   ↷ رد شد — ${why}`);
const done = (why) => console.log(`   ✔ ${why}`);

console.log('\n=== آماده‌سازی فردای روشن ===\n');
console.log(`  پوشه: ${root}`);
console.log(`  نود:  ${process.version}`);

/* ۱) نسخه نود */
step(1, 'بررسی Node.js');
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.log('   ✘ نسخه نود قدیمی است. Node 22 LTS نصب کنید: https://nodejs.org');
  process.exit(1);
}
done(`Node ${process.version} مناسب است`);

/* ۲) بسته‌ها */
step(2, 'بسته‌های پروژه (npm install)');
const lock = path.join(root, 'package-lock.json');
const nm = path.join(root, 'node_modules');
const stampFile = path.join(nm, '.farday-lock-stamp');
const lockTime = fs.existsSync(lock) ? fs.statSync(lock).mtimeMs : 0;
const stamp = fs.existsSync(stampFile) ? fs.statSync(stampFile).mtimeMs : 0;
const needInstall = force || !fs.existsSync(nm) || !has('node_modules/vite') || !has('node_modules/@nestjs/core') || lockTime > stamp;

if (!needInstall) {
  skip('بسته‌ها به‌روز هستند (package-lock.json تغییر نکرده)');
} else {
  console.log('   … در حال نصب (چند دقیقه اولین بار)');
  run('npm install --no-audit --no-fund');
  fs.writeFileSync(stampFile, String(Date.now()));
  done('بسته‌ها نصب شدند');
}

/* ۳) Prisma */
step(3, 'کلاینت دیتابیس (Prisma)');
if (force || !has('node_modules/.prisma') && !has('apps/api/src/generated')) {
  try { run('npm run db:generate'); done('کلاینت دیتابیس آماده شد'); }
  catch { console.log('   ⚠ تولید کلاینت دیتابیس انجام نشد — ساخت API ممکن است خطا بدهد'); }
} else {
  done('کلاینت دیتابیس از قبل موجود است');
}

/* ۴) ساخت API + رابط */
step(4, 'ساخت API و رابط کاربری');
const srcNewer = (dir, built) => {
  const b = path.join(root, built);
  if (!fs.existsSync(b)) return true;
  const bt = fs.statSync(b).mtimeMs;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).some((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name !== 'node_modules' && walk(p);
    return fs.statSync(p).mtimeMs > bt;
  });
  return walk(path.join(root, dir));
};
const apiStale = force || srcNewer('apps/api/src', 'apps/api/dist/main.js');
const webStale = force || srcNewer('apps/web/src', 'apps/web/dist/index.html');

if (!apiStale && !webStale) skip('هر دو ساخته شده و به‌روز هستند');
else {
  if (apiStale) { console.log('   … API'); run('npm run build -w @farday/api'); }
  if (webStale) { console.log('   … رابط کاربری'); run('npm run build -w @farday/web'); }
  done('ساخته شد');
}

/* ۵) جمع‌بندی */
console.log('\n✅ آماده است.\n');
console.log('   اجرای برنامه در مرورگر:   npm start        →  http://127.0.0.1:4317');
console.log('   حالت توسعه (hot reload):  npm run dev      →  http://localhost:5173');
console.log('   ساخت نصب‌کننده ویندوز:    npm run desktop:build\n');
