/**
 * عیب‌یابی لینکر C++ — «چرا link.exe پیدا نمی‌شود؟»
 *
 *   npm run find:msvc
 *
 * چرا این فایل: کاربر همه‌ی کامپوننت‌های C++ را نصب داشت
 * (MSVC v143 + Windows 11 SDK + C++ core features) ولی اسکریپت می‌گفت
 * «لینکر پیدا نشد». پیام‌های مبهم («—») عیب‌یابی را غیرممکن می‌کنند.
 *
 * این اسکریپت **هیچ تغییری** در سیستم نمی‌دهد؛ فقط می‌گوید:
 *   • چه نصب‌هایی از Visual Studio دیده می‌شود (مسیر + نام + نسخه)
 *   • vswhere کجاست و چه می‌گوید
 *   • داخل هر نصب، `VC\Tools\MSVC` چه دارد و `link.exe` هست یا نه
 *   • vcvars64.bat هست یا نه
 *   • Windows SDK و پوشه‌های LIB/INCLUDE
 *   • در پایان: دستور دقیقی که مشکل را حل می‌کند
 *
 * اگر `FD_MSVC_ROOT` لازم شد، همین اسکریپت مسیر درست را چاپ می‌کند.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  findMsvc, enumerateVsInstances, scanVsDirs, vswherePath, isFile, isDir,
  inPath, sdkLibRoots, searchFile, newestWindowsSdk, isWin,
  msvcVersions, pickMsvc, resolveCi,
} from './lib/msvc.mjs';

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

console.log(`\n${C.bold('=== عیب‌یابی لینکر C++ (link.exe) ===')}`);
console.log(`  سیستم: ${process.platform} ${process.arch} — Node ${process.version}`);
console.log(`  پوشه پروژه: ${process.cwd()}`);

if (!isWin) {
  console.log(`\n${C.warn('این بررسی برای ویندوز نوشته شده است.')}`);
  console.log('  روی لینوکس، لینکر سیستمی استفاده می‌شود: sudo apt install build-essential\n');
  process.exit(0);
}

/* ------------------------------------------------ ۱) PATH */
console.log(`\n${C.bold('۱) آیا link.exe در PATH است؟')}`);
const inPathLink = inPath('link.exe');
if (inPathLink) {
  console.log(`  ${C.ok('✔')} بله: ${inPathLink}`);
  console.log(`  ${C.dim('یعنی در «Developer Command Prompt» هستید. در این حالت ساخت باید کار کند.')}`);
} else {
  console.log(`  ${C.warn('⚠')} نه — طبیعی است. مهم این است که روی دیسک باشد (بند ۴).`);
  console.log(`  ${C.dim('اسکریپت ساخت خودش محیط vcvars را تنظیم می‌کند.')}`);
}

/* ------------------------------------------------ ۲) vswhere */
console.log(`\n${C.bold('۲) vswhere (ابزار رسمی مایکروسافت)')}`);
const vsw = vswherePath();
console.log(`  مسیر: ${vsw}`);
if (isFile(vsw)) {
  console.log(`  ${C.ok('✔')} موجود است`);
  const { spawnSync } = await import('node:child_process');
  const all = spawnSync(vsw, ['-all', '-products', '*', '-format', 'json', '-utf8'], { encoding: 'utf8' });
  const raw = (all.stdout || '').trim();
  if (raw.startsWith('[')) {
    try {
      const list = JSON.parse(raw);
      console.log(`  ${C.ok('✔')} ${list.length} نصب پیدا شد:`);
      for (const it of list) {
        console.log(`     • ${it.displayName || it.productId || '?'}`);
        console.log(`       مسیر: ${it.installationPath}`);
        console.log(`       نسخه: ${it.installationVersion || '?'} · کامل: ${it.isComplete !== false ? 'بله' : 'نه'}`);
      }
      if (!list.length) console.log(`     ${C.warn('هیچ نصبی ثبت نشده — یعنی Visual Studio/ Build Tools نصب نیست.')}`);
    } catch (e) {
      console.log(`  ${C.warn('⚠')} خروجی JSON خوانده نشد: ${e.message}`);
      console.log(C.dim(raw.slice(0, 600)));
    }
  } else {
    console.log(`  ${C.warn('⚠')} خروجی JSON نبود. متن خام:`);
    console.log(C.dim(raw.slice(0, 600) || '(خالی)'));
  }
} else {
  console.log(`  ${C.bad('✘')} موجود نیست — یعنی هیچ نسخه‌ای از Visual Studio Installer نصب نشده.`);
  console.log(`  ${C.dim('در این حالت Build Tools نصب نیست (یا با روش غیررسمی نصب شده).')}`);
}

/* ------------------------------------------------ ۳) پیمایش پوشه‌ها */
console.log(`\n${C.bold('۳) پوشه‌های Visual Studio روی دیسک')}`);
const scanned = scanVsDirs();
if (!scanned.length) {
  console.log(`  ${C.warn('⚠')} هیچ پوشه‌ای در «C:\\Program Files[ (x86)]\\Microsoft Visual Studio» پیدا نشد.`);
} else {
  for (const s of scanned) console.log(`  • ${s.path}  ${C.dim(s.source)}`);
}

/* ------------------------------------------------ ۴) بررسی هر نصب */
console.log(`\n${C.bold('۴) بررسی هر نصب: MSVC و link.exe')}`);
const allRoots = [...new Set([
  ...enumerateVsInstances().map((i) => i.path),
  ...scanned.map((s) => s.path),
  ...(process.env.FD_MSVC_ROOT || '').split(';').filter(Boolean),
])];

if (!allRoots.length) {
  console.log(`  ${C.bad('✘')} نصبی برای بررسی نیست.`);
}

let anyLink = '';
for (const root of allRoots) {
  console.log(`\n  ${C.bold(root)}`);
  if (!isDir(root)) { console.log(`    ${C.bad('✘')} پوشه وجود ندارد`); continue; }

  const versions = msvcVersions(root);
  if (versions.length) {
    const picked = pickMsvc(root);
    console.log(`    ${C.ok('✔')} VC\\Tools\\MSVC → نسخه‌ها: ${versions.join(', ')}`);
    for (const v of versions) {
      const msvcRoot = resolveCi(root, 'VC', 'Tools', 'MSVC');
      const link = resolveCi(path.join(msvcRoot, v), 'bin', 'Hostx64', 'x64', 'link.exe');
      const used = picked.msvcVersion === v;
      if (link) {
        console.log(`      ${C.ok('✔')} ${v}: link.exe موجود است${used ? C.dim('  ← استفاده می‌شود') : ''}`);
        if (used) anyLink = link;
      } else {
        /* نسخه‌ی ناقص — پیام دقیق، به‌جای «کامپوننت نصب نشده» */
        console.log(`      ${C.warn('⚠')} ${v}: link.exe ندارد (این نسخه ناقص است — نسخه‌ی دیگر استفاده می‌شود)`);
      }
    }
    if (!picked.linkExe) console.log(`    ${C.bad('✘')} هیچ نسخه‌ای از MSVC فایل link.exe ندارد`);
  } else {
    console.log(`    ${C.bad('✘')} پوشه‌ی VC\\Tools\\MSVC نیست — کامپوننت «MSVC v143 …» نصب نشده`);
  }

  const vcvars64 = resolveCi(root, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  const vcvarsall = resolveCi(root, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
  console.log(`    ${vcvars64 ? C.ok('✔') : C.dim('•')} VC\\Auxiliary\\Build\\vcvars64.bat${vcvars64 ? '' : ' (نیست)'}`);
  console.log(`    ${vcvarsall ? C.ok('✔') : C.dim('•')} VC\\Auxiliary\\Build\\vcvarsall.bat${vcvarsall ? C.dim('  ← برای x64 استفاده می‌شود') : ' (نیست)'}`);
  if (!vcvars64 && !vcvarsall) {
    console.log(`    ${C.warn('⚠')} هیچ vcvars ای نیست — LIB/INCLUDE دستی ساخته می‌شود`);
  }

  /* چیدمان ناشناخته: جست‌وجوی محدود */
  if (!anyLink && isDir(path.join(root, 'VC'))) {
    const deep = searchFile(path.join(root, 'VC'), 'link.exe', 6);
    console.log(`    ${deep ? C.ok('✔') + ' جست‌وجوی عمیق: ' + deep : C.warn('⚠') + ' جست‌وجوی عمیق هم چیزی پیدا نکرد'}`);
    if (deep) anyLink = deep;
  }
}

/* ------------------------------------------------ ۵) Windows SDK */
console.log(`\n${C.bold('۵) Windows SDK (برای LIB/INCLUDE لازم است)')}`);
const sdks = sdkLibRoots();
if (sdks.length) {
  console.log(`  ${C.ok('✔')} جدیدترین: ${newestWindowsSdk()}`);
  for (const s of sdks.slice(0, 3)) console.log(`     ${C.dim(s.dir)}`);
} else {
  console.log(`  ${C.bad('✘')} Windows SDK پیدا نشد — حتی با link.exe، خطای ` +
    `${C.dim("LNK1104: cannot open file 'kernel32.lib'")} می‌گیرید.`);
  console.log(`  ${C.dim('در Visual Studio Installer → Modify → تیک «Windows 11 SDK».')}`);
}

/* ------------------------------------------------ ۶) نتیجه */
console.log(`\n${C.bold('=== نتیجه ===')}`);
const msvc = findMsvc();
if (msvc.found) {
  console.log(`${C.ok('✔')} لینکر پیدا شد:`);
  console.log(`   ${msvc.linkExe}`);
  console.log(`   منبع: ${msvc.source} · روش: ${msvc.how}`);
  console.log(`   MSVC ${msvc.msvcVersion || '?'} · SDK ${msvc.sdkVersion || 'پیدا نشد (بند ۵)'}`);
  if (msvc.vcvars) {
    const isAll = /vcvarsall\.bat$/i.test(msvc.vcvars);
    console.log(`   vcvars: ${msvc.vcvars}${isAll ? ' (با آرگومان x64 اجرا می‌شود)' : ''}`);
  }
  else console.log(`   ${C.warn('⚠')} هیچ vcvars ای نیست — اسکریپت LIB/INCLUDE را دستی می‌سازد`);
  console.log(`\n${C.ok('مرحله بعد:')} npm run desktop:build`);
  process.exit(0);
}

console.log(`${C.bad('✘')} هیچ link.exe‌ای پیدا نشد.`);
console.log(`\n  ${C.bold('مسیرهایی که بررسی شد:')}`);
for (const c of msvc.checked) console.log(`   • ${c.path}  ${C.dim(`(${c.why}، ${c.source})`)}`);
if (!msvc.checked.length) console.log(`   ${C.dim('(هیچ مسیری برای بررسی پیدا نشد)')}`);

if (anyLink) {
  console.log(`\n  ${C.warn('⚠')} ولی در جست‌وجوی خام یک link.exe پیدا شد:`);
  console.log(`     ${anyLink}`);
  const vcIdx = anyLink.split(/[\\/]/).findIndex((p) => /^VC$/i.test(p));
  const root = vcIdx > 0 ? anyLink.split(/[\\/]/).slice(0, vcIdx).join('\\') : '';
  if (root) {
    console.log(`\n  ${C.bold('این را اجرا کنید (مسیر را دستی معرفی می‌کند):')}`);
    console.log(`     ${C.bold(`set FD_MSVC_ROOT=${root}`)}`);
    console.log(`     ${C.bold('npm run desktop:build')}`);
  }
} else {
  console.log(`\n  ${C.bold('راه‌حل: کامپوننت C++ را نصب کنید')}`);
  console.log(`     ۱. https://visualstudio.microsoft.com/visual-cpp-build-tools/`);
  console.log(`     ۲. در نصب‌کننده → تب Workloads → تیک ${C.bold('«Desktop development with C++')}`);
  console.log(`     ۳. در پنل راست: «MSVC v143 …» + «Windows 11 SDK» تیک داشته باشند`);
  console.log(`     ۴. Install`);
  console.log(`\n     یا: ${C.bold('winget install Microsoft.VisualStudio.2022.BuildTools')}`);
  console.log(`     ${C.dim('(بعد در Visual Studio Installer روی Modify بزنید و workload را تیک بزنید)')}`);
}
console.log('');
process.exit(1);
