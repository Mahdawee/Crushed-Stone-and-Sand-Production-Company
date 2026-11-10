/**
 * ساختِ **آفلاین** نصب‌کننده‌ی دسکتاپ.
 *
 *   npm run desktop:build:offline -- "<مسیر node-v22-win-x64.zip>"
 *
 * چرا: نصب‌کننده‌ای که «بدون نصب هیچ چیز اضافه» کار می‌کند باید فایل
 * `node.exe` را همراه داشته باشد. `desktop:build` آن را از nodejs.org
 * دانلود می‌کند — ولی اگر کمپیوتر ساخت اینترنت نداشته باشد، قبلاً فقط یک
 * هشدار چاپ می‌شد و نصب‌کننده **بی‌فایده** ساخته می‌شد (روی کمپیوتر مقصد
 * Node.js لازم می‌شد؛ همان چیزی که نباید پیش بیاید).
 *
 * این اسکریپت همان کاشی را حل می‌کند:
 *   ۱) فایل ZIP رسمی نود را از قبل روی یک فلش/کاپی می‌آورید،
 *   ۲) این دستور را با مسیر همان ZIP می‌زنید،
 *   ۳) `node.exe` از ZIP بیرون کشیده و در بسته گذاشته می‌شود،
 *   ۴) سپس `tauri build` اجرا می‌شود — کاملاً بدون انترنت.
 *
 * اگر فایل ZIP داده نشود، اسکریپت سعی می‌کند ZIP را از nodejs.org بگیرد
 * (اگر انترنت بود) و در پوشه‌ی `.cache/` برای بارهای بعد نگه دارد.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ver = process.versions.node;
const zipName = `node-v${ver}-win-x64.zip`;
const cacheDir = path.join(root, '.cache');
const cachedZip = path.join(cacheDir, zipName);

const argZip = process.argv.slice(2).find((a) => a && !a.startsWith('-'));
let zip = argZip ? path.resolve(argZip) : '';

if (zip && !fs.existsSync(zip)) {
  console.error(`⛔ فایل ZIP پیدا نشد: ${zip}`);
  process.exit(1);
}

if (!zip && fs.existsSync(cachedZip)) {
  zip = cachedZip;
  console.log(`ℹ استفاده از ZIP ذخیره‌شده: ${cachedZip}`);
}

const run = (cmd, args) =>
  spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

if (!zip) {
  console.log('▶ فایل ZIP نود در دسترس نیست — تلاش برای دانلود یک‌باره…');
  fs.mkdirSync(cacheDir, { recursive: true });
  const url = `https://nodejs.org/dist/v${ver}/${zipName}`;
  const dl = spawnSync('curl', ['-fL', '--retry', '3', '--connect-timeout', '20', '-o', cachedZip, url], {
    cwd: root,
    stdio: 'inherit',
  });
  if (dl.status === 0 && fs.existsSync(cachedZip) && fs.statSync(cachedZip).size > 5_000_000) {
    zip = cachedZip;
    console.log(`✔ دانلود شد و برای بارهای بعد ذخیره شد: ${cachedZip}`);
  } else {
    try { fs.rmSync(cachedZip, { force: true }); } catch { /* ignore */ }
    console.error('\n⛔ بدون فایل ZIP نود نمی‌توان نصب‌کننده‌ی مستقل ساخت.');
    console.error(`   روی یک کمپیوتر با انترنت این فایل را بگیرید (نسخه ${ver}):`);
    console.error(`     https://nodejs.org/dist/v${ver}/${zipName}`);
    console.error('   آن را با فلش به این کمپیوتر بیاورید و اجرا کنید:');
    console.error(`     npm run desktop:build:offline -- "D:\\${zipName}"`);
    process.exit(1);
  }
}

console.log(`\n▶ 1/3 ساخت API و رابط کاربری…`);
let r = run('npm', ['run', 'build:desktop']);
if (r.status !== 0) process.exit(r.status ?? 1);

console.log(`\n▶ 2/3 بسته‌بندی API + node.exe از ZIP محلی…`);
r = run('node', ['scripts/build-desktop-api.mjs', '--require-node', '--node-zip', zip]);
if (r.status !== 0) process.exit(r.status ?? 1);

console.log(`\n▶ 3/3 ساخت نصب‌کننده (tauri build)…`);
r = run('npx', ['tauri', 'build']);
if (r.status !== 0) process.exit(r.status ?? 1);

console.log('\n✔ نصب‌کننده ساخته شد:');
console.log('   src-tauri/target/release/bundle/nsis/Farday Roshan_0.1.0_x64-setup.exe');
console.log('   این فایل کاملاً مستقل است: Node.js و انترنت لازم ندارد.');
