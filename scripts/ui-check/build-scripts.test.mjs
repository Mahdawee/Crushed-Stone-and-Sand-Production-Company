/**
 * بررسی ساختاری اسکریپت‌های **ساخت نصب‌کننده** — بدون ویندوز/راست.
 *
 *   node scripts/ui-check/build-scripts.test.mjs
 *   npm run test:build
 *
 * چرا: خطای واقعیِ کاربر
 *
 *   failed to run 'cargo metadata' command to get workspace directory:
 *     failed to run command `cargo metadata --no-deps --format-version 1`:
 *     program not found
 *
 * از `npx tauri build` می‌آمد و در ساندباکس (بدون Rust) نمی‌توان آن را
 * بازتولید کرد. پس حداقل قراردادهایی که همان خطا را می‌گیرند اینجا تضمین
 * می‌شوند:
 *   • `npm run desktop:build` به اسکریپتی برود که خودش cargo را پیدا می‌کند
 *   • اسکریپت مسیرهای متداول rustup را جست‌وجو کند و PATH را اصلاح کند
 *   • اگر Rust نبود، پیام نصب فارسی بدهد (نه stack trace)
 *   • هرگز `npx tauri` بی‌`--no-install` اجرا نشود
 *   • مسیر آفلاین وجود داشته باشد (prefetch + --offline)
 *   • ساخت آفلاین، `CARGO_NET_OFFLINE` بگذارد
 *   • node.exe با ZIP محلی (بدون دانلود) نصب شود
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const pkg = JSON.parse(read('package.json'));
const scripts = pkg.scripts || {};
const build = read('scripts/build-desktop.mjs');
const off = read('scripts/prepare-offline-desktop.mjs');
const doctor = read('scripts/doctor.mjs');
const docs = read('docs/TAURI-BUILD.md');
const apiPack = read('scripts/build-desktop-api.mjs');
const ps1 = read('scripts/install-rust.ps1');

let pass = 0;
let fail = 0;
const ok = (n, c, extra = '') => {
  c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`));
};

console.log('\n— اسکریپت ساخت: دستورهای npm —');
ok('desktop:build به اسکریپت اختصاصی می‌رود (نه tauri خالی)',
  /^node scripts\/build-desktop\.mjs$/.test(scripts['desktop:build'] || ''), scripts['desktop:build']);
ok('desktop:build دیگر `&& tauri build` خام ندارد',
  !/&&\s*tauri build/.test(scripts['desktop:build'] || ''));
ok('desktop:prefetch وجود دارد',
  /build-desktop\.mjs --prefetch/.test(scripts['desktop:prefetch'] || ''), scripts['desktop:prefetch']);
ok('مسیر آفلاین cargo وجود دارد',
  /build-desktop\.mjs --offline/.test(scripts['desktop:build:cargo-offline'] || ''));
ok('desktop:build:offline هنوز به اسکریپت ZIP نود وصل است',
  /prepare-offline-desktop\.mjs/.test(scripts['desktop:build:offline'] || ''));
ok('test:build در فهرست test هست', /test:build/.test(scripts.test || ''));

console.log('\n— تشخیص cargo (منشأ خطای program not found) —');
ok('فایل build-desktop.mjs وجود دارد', build.length > 1000);
ok('مسیر %USERPROFILE%\\.cargo\\bin جست‌وجو می‌شود', /\.cargo['"],\s*'bin'/.test(build));
ok('CARGO_HOME در نظر گرفته می‌شود', /CARGO_HOME/.test(build));
ok('cargo.exe روی ویندوز و cargo روی لینوکس', /cargo\.exe/.test(build) && /isWin \? 'cargo\.exe' : 'cargo'/.test(build));
ok('PATH همان اجرا اصلاح می‌شود (spawn با env)', /PATH:\s*parts\.join\(sep\)/.test(build));
ok('از PATH هم cargo جست‌وجو می‌شود', /function cargoFromPath/.test(build));
ok('نسخه cargo خوانده و گزارش می‌شود', /cargoPath,\s*\['--version'\]/.test(build));
ok('پیام راهنمای نصب Rust به فارسی', /Rust پیدا نشد/.test(build) && /rustup/.test(build));
ok('راه نصب winget پیشنهاد می‌شود', /winget install --id Rustlang\.Rustup/.test(build));
ok('به install-rust.ps1 اشاره می‌شود', /install-rust\.ps1/.test(build));
ok('خطای «program not found» در توضیح آمده (قابل جست‌وجو برای کاربر)', /program not found/.test(build));

console.log('\n— بدون npx شکننده —');
ok('Tauri CLI مستقیم با node اجرا می‌شود', /@tauri-apps['"],\s*'cli['"],\s*'tauri\.js'/.test(build));
ok('npx فقط با --no-install (نسخه پشتیبان)', /npx['"],\s*\['--no-install'/.test(build));
ok('هیچ `npx tauri` بدون --no-install نیست', !/'npx',\s*\['tauri/.test(build));
ok('prepare-offline هم --no-install دارد', /'--no-install',\s*'tauri'/.test(off));
ok('ZIP نود بدون shell به اسکریپت پاس می‌شود (مسیرهای دارای فاصله)',
  /runNode\(\[[^\]]*'--node-zip'/.test(off));

console.log('\n— ساخت آفلاین —');
ok('CARGO_NET_OFFLINE در build-desktop', /CARGO_NET_OFFLINE = 'true'/.test(build));
ok('CARGO_NET_OFFLINE در prepare-offline', /CARGO_NET_OFFLINE = 'true'/.test(off));
ok('npm_config_offline گذاشته می‌شود', /npm_config_offline/.test(build));
ok('--prefetch از cargo fetch استفاده می‌کند', /'fetch',\s*'--manifest-path'/.test(build));
ok('Cargo.lock بررسی می‌شود', /Cargo\.lock/.test(build) && /Cargo\.lock/.test(off));
ok('اگر رجیستری خالی و --offline بود، پیام روشن می‌دهد',
  /حالت آفلاین انتخاب شده ولی کریت‌های Rust دانلود نشده/.test(build));
ok('رجیستری با readdir بررسی می‌شود (نه فرض)', /registry['"],\s*'cache'/.test(build));
ok('prepare-offline وجود node.exe را می‌سنجد', /node\.exe'\)\)|nodeInBundle/.test(off));
ok('ZIP ناقص/کوچک رد می‌شود', /5_000_000/.test(off));
ok('FD_NODE_ZIP به بسته‌بندی پاس می‌شود', /FD_NODE_ZIP/.test(build));

console.log('\n— doctor —');
ok('حالت «cargo روی دیسک ولی نه در PATH» تشخیص داده می‌شود', /cargoOnDisk/.test(doctor));
ok('راه‌حل PATH در doctor چاپ می‌شود', /set PATH=%USERPROFILE%/.test(doctor) || /export PATH=/.test(doctor));
ok('doctor به build:desktop ارجاع می‌دهد', /npm run build:desktop|npm run desktop:build/.test(doctor));

console.log('\n— نصب‌کننده PowerShell —');
ok('install-rust.ps1 وجود دارد', ps1.length > 500);
ok('نصب بی‌صدا (بدون پرسش) انجام می‌شود', /-y --default-toolchain/.test(ps1));
ok('PATH همین پنجره اصلاح می‌شود', /\$env:PATH\s*=\s*"\$cargoBin;/.test(ps1));
ok('اگر از قبل نصب بود، دوباره نصب نمی‌کند', /Test-Path \$cargoExe/.test(ps1));

console.log('\n— مستندات —');
ok('بخش ساخت آفلاین با prefetch آمده', /desktop:prefetch/.test(docs));
ok('خطای cargo metadata در جدول خطاهای رایج هست', /cargo metadata/.test(docs));
ok('بخش عیب‌یابی اختصاصی وجود دارد', /program not found/.test(docs));
ok('مسیر دو-بار-تودرتو توضیح داده شده', /package\.json.*src-tauri|دو بار/.test(docs));
ok('سه مرحله ساخت (۱/۳..۳/۳) در راهنما آمده', /۱\/۳/.test(docs) || /▶ ۱\/۳/.test(build));

console.log('\n— بسته‌بندی API —');
ok('node.exe از ZIP داده‌شده استخراج می‌شود', /--node-zip|nodeZip/.test(apiPack));
ok('اگر node.exe نبود با --require-node خطا می‌دهد', /require-node|requireNode/.test(apiPack));

/* هر فایل JS باید سینتکس سالم داشته باشد — خطای تایپی در اسکریپت ساخت
   یعنی «program not found» بعدی. */
console.log('\n— سینتکس فایل‌های ساخت —');
for (const f of ['scripts/build-desktop.mjs', 'scripts/prepare-offline-desktop.mjs', 'scripts/doctor.mjs']) {
  let good = true;
  let err = '';
  try {
    const src = read(f);
    /* بررسی سبک: بالانس آکولادها بیرون از رشته/کامنت */
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
      .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
      .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""');
    let depth = 0;
    let neg = false;
    for (const ch of stripped) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth < 0) { neg = true; break; } }
    }
    good = !neg && depth === 0;
    if (!good) err = `بالانس آکولاد: ${depth}`;
  } catch (e) { good = false; err = e.message; }
  ok(`${f} ساختار سالم دارد`, good, err);
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
