/**
 * نمایش محیط کامپایل C++ که اسکریپت ساخت استفاده می‌کند.
 *
 *   npm run desktop:env
 *
 * چرا: خطاهای این مرحله (مثل
 *   windows.h(1): fatal error C1083: Cannot open include file: 'winapifamily.h'
 * ) ریشه‌شان در `INCLUDE`/`LIB` است، نه در کد. کاربر باید ببیند دقیقاً چه
 * چیزی به کامپایلر می‌رسد — بدون اینکه کل ساخت را اجرا کند.
 *
 * خروجی:
 *   • لینکر و vcvars ای که انتخاب شد
 *   • روش تنظیم محیط (vcvars64 / vcvarsall x64 / ساخت دستی)
 *   • فهرست کامل LIB و INCLUDE با علامت «موجود/نیست»
 *   • خودآزمایی هدرها و کتابخانه‌های کلیدی
 *   • اگر چیزی کم بود: نام کامپوننت دقیق Build Tools که باید نصب شود
 */
import fs from 'node:fs';
import path from 'node:path';
import { findMsvc, msvcEnv, isWin, sdkLibRoots } from './lib/msvc.mjs';

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const existsDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

console.log(`\n${C.bold('=== محیط کامپایل C++ (آنچه به rustc/cargo می‌رسد) ===')}`);
console.log(`  سیستم: ${process.platform} ${process.arch} — Node ${process.version}`);

if (!isWin) {
  console.log(`\n${C.warn('این بررسی برای ویندوز است.')}`);
  console.log('  روی لینوکس، لینکر و هدرهای سیستمی استفاده می‌شوند.');
  console.log('  اگر ساخت خطا داد: sudo apt install build-essential libwebkit2gtk-4.1-dev\n');
  process.exit(0);
}

/* ---------------------------------------------- ابزار انتخاب‌شده */
const msvc = findMsvc();
console.log(`\n${C.bold('۱) ابزار انتخاب‌شده')}`);
if (!msvc.found) {
  console.log(`  ${C.bad('✘')} MSVC پیدا نشد — اول npm run find:msvc را بزنید`);
  process.exit(1);
}
console.log(`  لینکر : ${msvc.linkExe}`);
console.log(`  نسخه  : MSVC ${msvc.msvcVersion || '?'}`);
console.log(`  vcvars: ${msvc.vcvars || C.warn('(نیست — LIB/INCLUDE دستی ساخته می‌شود)')}`);
console.log(`  منبع  : ${msvc.source} · ${msvc.how}`);

/* ---------------------------------------------- محیط */
const { env, how, vcvarsReason } = msvcEnv(msvc);
console.log(`\n${C.bold('۲) روش تنظیم محیط')}`);
console.log(`  ${how === 'ناموفق' ? C.bad(how) : C.ok(how)}`);
if (vcvarsReason) console.log(`  ${C.warn('دلیل استفاده از روش پشتیبان:')} ${vcvarsReason}`);
console.log(`  ${C.dim('(vcvars64/vcvarsall همان کاری را می‌کند که «Developer Command Prompt» می‌کند)')}`);

/* ---------------------------------------------- INCLUDE */
console.log(`\n${C.bold('۳) INCLUDE — هدرهای C++ و ویندوز')}`);
const incs = (env.INCLUDE || '').split(';').filter(Boolean);
if (!incs.length) console.log(`  ${C.bad('✘')} خالی است`);
for (const d of incs) console.log(`  ${existsDir(d) ? C.ok('✔') : C.bad('✘')} ${d}`);

/* ---------------------------------------------- LIB */
console.log(`\n${C.bold('۴) LIB — کتابخانه‌ها')}`);
const libs = (env.LIB || '').split(';').filter(Boolean);
if (!libs.length) console.log(`  ${C.bad('✘')} خالی است`);
for (const d of libs) console.log(`  ${existsDir(d) ? C.ok('✔') : C.bad('✘')} ${d}`);

/* ---------------------------------------------- خودآزمایی */
console.log(`\n${C.bold('۵) خودآزمایی — فایل‌هایی که کامپایل واقعاً می‌خواهد')}`);
const checks = [
  ['windows.h', 'um', 'هدر اصلی ویندوز'],
  ['winapifamily.h', 'shared', 'هدر خانواده‌ی API — خطای C1083 از اینجاست'],
  ['stdio.h', 'ucrt', 'هدر C runtime'],
  ['kernel32.lib', 'um', 'کتابخانه‌ی اصلی ویندوز'],
  ['ucrt.lib', 'ucrt', 'کتابخانه‌ی C runtime'],
];
let fatal = 0;
for (const [file, sub, why] of checks) {
  const dirs = file.endsWith('.lib') ? libs : incs;
  const hit = dirs.find((d) => exists(path.join(d, file)));
  if (hit) console.log(`  ${C.ok('✔')} ${file}  ${C.dim(`(${path.basename(path.dirname(hit))})`)}`);
  else {
    fatal++;
    console.log(`  ${C.bad('✘')} ${file} — ${why}`);
    console.log(`      ${C.dim(`باید در پوشه‌ی «${sub}» ویندوز SDK باشد`)}`);
  }
}

/* ---------------------------------------------- SDK */
console.log(`\n${C.bold('۶) Windows SDK نصب‌شده')}`);
const sdks = sdkLibRoots();
if (!sdks.length) console.log(`  ${C.bad('✘')} هیچ SDK ای پیدا نشد`);
for (const s of sdks.slice(0, 4)) console.log(`  • ${s.version}  ${C.dim(s.dir)}`);

/* ---------------------------------------------- نتیجه */
console.log(`\n${C.bold('=== نتیجه ===')}`);
if (fatal === 0) {
  console.log(`${C.ok('✔')} محیط کامپایل کامل است.`);
  console.log(`  ${C.dim('اگر ساخت باز خطا داد، متن انگلیسی خطا را ببینید (مشکل از کد است، نه محیط).')}`);
  process.exit(0);
}

console.log(`${C.bad(`✘ ${fatal} مورد کم است — ساخت با خطای کامپایلر شکست می‌خورد.`)}`);
console.log(`\n  ${C.bold('راه‌حل:')}`);
console.log(`    ۱. Visual Studio Installer را باز کنید`);
console.log(`    ۲. کنار «Visual Studio Build Tools 2026» → ${C.bold('Modify')}`);
console.log(`    ۳. تیک این‌ها را بزنید:`);
console.log(`         • ${C.bold('Desktop development with C++')}`);
console.log(`         • MSVC v143 — VS 2022/2026 C++ x64/x86 build tools`);
console.log(`         • ${C.bold('Windows 11 SDK')} ${C.dim('(یا Windows 10 SDK)')}`);
console.log(`    ۴. ${C.bold('Modify')} و صبر کنید`);
console.log(`\n  ${C.dim('توجه: ویندوز SDK نه فقط Lib دارد؛ پوشه‌های Include\\\\<ver>\\\\{ucrt,shared,um,winrt} هم لازم‌اند.')}`);
console.log(`  ${C.dim('اگر SDK روی درایو دیگری است: set FD_SDK_ROOT=D:\\\\Windows Kits\\\\10')}`);
console.log('');
process.exit(1);
