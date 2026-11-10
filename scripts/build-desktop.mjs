/**
 * ساخت نصب‌کننده‌ی ویندوز با تشخیصِ هوشمندِ زنجیره‌ی Rust.
 *
 *   npm run desktop:build                 # ساخت کامل (نصب‌کننده .exe)
 *   npm run desktop:build -- --prefetch    # یک بار با انترنت: دانلود crateها برای ساخت آفلاین بعدی
 *   npm run desktop:build -- --offline     # ساخت بدون انترنت (crateها باید از قبل باشند)
 *   npm run desktop:build -- --debug       # ساخت سریع‌تر آزمایشی (بدون بهینه‌سازی)
 *
 * ## خطایی که این اسکریپت حل می‌کند
 *
 * ```
 * failed to run 'cargo metadata' command to get workspace directory:
 *   failed to run command `cargo metadata --no-deps --format-version 1`:
 *   program not found
 * ```
 *
 * معنی دقیق: Tauri CLI اجرا شد، ولی `cargo` را پیدا نکرد. سه حالت:
 *   ۱) Rust **نصب است** ولی `%USERPROFILE%\.cargo\bin` در PATH این پنجره
 *      نیست (ترمینال قبل از نصب باز شده بود). → این اسکریپت PATH را خودش
 *      اصلاح می‌کند و کار ادامه پیدا می‌کند.
 *   ۲) Rust **نصب نیست**. → دستور نصب را می‌دهد و راهنمای فارسی چاپ می‌کند.
 *   ۳) Rust با `rustup` در مسیر غیرمعمول نصب شده. → چند مسیر متداول را
 *      می‌گردد و اگر پیدا نشد، می‌گوید چه چیزی را چک کنید.
 *
 * ## چرا دیگر `npx tauri build` دستی لازم نیست
 * این اسکریپت هر سه مرحله را به ترتیب انجام می‌دهد و در پایان مسیر فایل
 * نصب را چاپ می‌کند؛ اگر مرحله‌ای شکست بخورد، پیام فارسی + راه‌حل می‌دهد.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);

const wantPrefetch = flag('prefetch');
const wantOffline = flag('offline');
const wantDebug = flag('debug');
const skipApiPack = flag('skip-api');

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/* ------------------------------------------------------------------ */
/* ۱) پیدا کردن زنجیره‌ی Rust                                          */
/* ------------------------------------------------------------------ */

const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
const cargoHome = process.env.CARGO_HOME || path.join(home, '.cargo');
const cargoExeName = isWin ? 'cargo.exe' : 'cargo';

/** مسیرهای متداول نصب — بدون فرض اینکه PATH درست است */
function cargoCandidates() {
  const list = [
    path.join(cargoHome, 'bin', cargoExeName),
    path.join(home, '.cargo', 'bin', cargoExeName),
  ];
  if (isWin) {
    list.push(
      'C:\\Program Files\\Rust stable\\bin\\cargo.exe',
      'C:\\ProgramData\\chocolatey\\bin\\cargo.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Rust', 'bin', 'cargo.exe'),
    );
  } else {
    list.push('/usr/local/cargo/bin/cargo', '/usr/bin/cargo', '/opt/homebrew/bin/cargo');
  }
  return list.filter(Boolean);
}

const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

/** آیا فایل اجرایی در PATH هست؟ مسیر کامل یا رشته‌ی خالی برمی‌گرداند. */
function inPath(exe) {
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  const hasExt = /\.(exe|cmd|bat)$/i.test(exe);
  const dirs = (process.env.PATH || '').split(isWin ? ';' : ':').filter(Boolean);
  for (const d of dirs) {
    for (const e of hasExt ? [''] : exts) {
      const p = path.join(d, exe + e);
      if (isFile(p)) return p;
    }
  }
  return '';
}

/** cargo در PATH؟ */
function cargoFromPath() {
  return inPath(cargoExeName);
}

const cargoInPath = cargoFromPath();
const cargoOnDisk = cargoCandidates().find(isFile) || '';
const cargoPath = cargoInPath || cargoOnDisk;

/** آیا در PATH جست‌وجو کنیم یا مسیر مطلق بدهیم؟ */
const cargoCmd = cargoPath || 'cargo';

/* ------------------------------------------------------------------ */
/* ۱/ب) پیدا کردن لینکر C++ (link.exe) و Windows SDK                  */
/* ------------------------------------------------------------------ */
/*
 * خطای دوم کاربر — متفاوت از خطای cargo:
 *
 *   error: linker `link.exe` not found
 *     = note: the msvc targets depend on the msvc linker but `link.exe` was not found
 *
 * یعنی cargo/rustc اجرا می‌شوند ولی **لینکر C++** نیست. Rust برای ساختن
 * فایل .exe به link.exe از «Visual Studio C++ Build Tools» نیاز دارد.
 * نکته‌ی مهم: VS Code کافی نیست (پیام خودِ rustc هم همین را می‌گوید).
 *
 * درس گرفته‌شده از نسخه‌ی قبل: فقط اضافه‌کردن پوشه‌ی bin به PATH کافی
 * **نیست**؛ link.exe برای پیدا کردن kernel32.lib و بقیه به متغیرهای
 * LIB و INCLUDE هم نیاز دارد. راه درست، اجرای vcvars64.bat و برداشتن
 * محیط کامل آن است — که همین‌جا انجام می‌شود.
 */

/** مسیرهای ممکن نصب Visual Studio / Build Tools */
const VS_ROOTS = [
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools',
  'C:\\Program Files\\Microsoft Visual Studio\\2019\\Community',
];

const VSW_HERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';

/**
 * مرتب‌ترین نسخه‌ی MSVC را برمی‌گرداند (`VC\\Tools\\MSVC\\14.4x.xxxxx`).
 * از readdir استفاده می‌کنیم تا نسخه‌ی آینده هم کار کند (قبلاً نسخه
 * دستی حدس زده می‌شد که شکننده بود).
 */
function newestMsvcVersion(vsPath) {
  try {
    const list = fs.readdirSync(path.join(vsPath, 'VC', 'Tools', 'MSVC'))
      .filter((v) => /^14\./.test(v))
      .sort((a, b) => {
        const n = (x) => x.split('.').map(Number);
        const [a1, a2, a3] = n(a);
        const [b1, b2, b3] = n(b);
        return a1 - b1 || a2 - b2 || (a3 || 0) - (b3 || 0);
      });
    return list.pop() || '';
  } catch { return ''; }
}

/** آیا مسیر vcvars64.bat (یا vcvarsall.bat) در این نصب هست؟ */
function vcvarsIn(vsPath) {
  for (const rel of [
    ['VC', 'Auxiliary', 'Build', 'vcvars64.bat'],
    ['VC', 'Auxiliary', 'Build', 'vcvarsall.bat'],
  ]) {
    const p = path.join(vsPath, ...rel);
    if (isFile(p)) return p;
  }
  return '';
}

/**
 * نتیجه‌ی جست‌وجوی MSVC:
 *   { found, vsPath, msvcVersion, linkExe, vcvars, sdkVersion, source }
 */
function findMsvc() {
  const result = {
    found: false, vsPath: '', msvcVersion: '', linkExe: '',
    vcvars: '', sdkVersion: '', source: '',
    /* آیا اصلاً Visual Studio (هر نسخه‌ای) دیده شد؟ → برای تشخیص
       «VS هست ولی کامپوننت C++ ندارد» که شایع‌ترین حالت است */
    sawVisualStudio: false,
  };
  if (!isWin) return result;

  const candidates = [];

  /* الف) مسیر دستی — اگر Visual Studio در جای غیرمعمول نصب شده باشد:
        set FD_MSVC_ROOT=D:\Tools\VS2022BuildTools
        (می‌توان چند مسیر را با «;» جدا کرد) */
  for (const p of (process.env.FD_MSVC_ROOT || '').split(';').filter(Boolean)) {
    candidates.push({ p: p.trim(), s: 'FD_MSVC_ROOT' });
  }

  /* ب) vswhere — روش رسمی مایکروسافت. اول با شرط «کامپوننت C++ نصب باشد» */
  const vswhereExe = process.env.FD_VSWHERE || VSW_HERE;
  if (isFile(vswhereExe)) {
    const q = spawnSync(vswhereExe, [
      '-latest', '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ], { encoding: 'utf8' });
    const p1 = (q.stdout || '').split(/\r?\n/)[0].trim();
    if (p1) candidates.push({ p: p1, s: 'vswhere (کامپوننت C++ دارد)' });

    /* ب) اگر شرط بالا چیزی نداد، نصب‌های VS را بی‌شرط ببین (شاید کامپوننت
       ناقص باشد — در آن صورت باید کاربر کامپوننت را اضافه کند) */
    if (!candidates.some((c) => c.s.startsWith('vswhere'))) {
      const q2 = spawnSync(vswhereExe, ['-latest', '-products', '*', '-property', 'installationPath'],
        { encoding: 'utf8' });
      for (const line of (q2.stdout || '').split(/\r?\n/)) {
        const p = line.trim();
        if (p) candidates.push({ p, s: 'vswhere (بدون کامپوننت C++)' });
      }
    }
  }

  /* ج) مسیرهای متداول — اگر vswhere نبود یا نصب قابل‌شناسایی نبود */
  for (const p of VS_ROOTS) if (isFile(path.join(p, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat'))
    || fs.existsSync(path.join(p, 'VC'))) candidates.push({ p, s: 'مسیر متداول' });

  for (const { p, s } of candidates) {
    /* اگر پوشه‌ی VC یا یک نصب VS دیده شد، یعنی VS نصب است */
    if (fs.existsSync(path.join(p, 'VC')) || fs.existsSync(p)) result.sawVisualStudio = true;
    const vcvars = vcvarsIn(p);
    if (!vcvars) continue; /* VS نصب است ولی VC Tools ندارد → کمکی نمی‌کند */
    const msvcVersion = newestMsvcVersion(p);
    const linkExe = msvcVersion
      ? path.join(p, 'VC', 'Tools', 'MSVC', msvcVersion, 'bin', 'Hostx64', 'x64', 'link.exe')
      : '';
    if (!linkExe || !isFile(linkExe)) continue;
    return {
      ...result,
      found: true,
      sawVisualStudio: true,
      vsPath: p,
      msvcVersion,
      linkExe,
      vcvars,
      sdkVersion: newestWindowsSdk(),
      source: s,
    };
  }
  return result;
}

/** نسخه‌ی Windows SDK نصب‌شده (برای لاگ؛ بدون آن هم link.exe کار می‌کند اگر LIB درست باشد) */
function newestWindowsSdk() {
  for (const root of [
    'C:\\Program Files (x86)\\Windows Kits\\10\\Lib',
    'C:\\Program Files\\Windows Kits\\10\\Lib',
  ]) {
    try {
      const dirs = fs.readdirSync(root).filter((d) => /^10\./.test(d)).sort();
      if (dirs.length) return dirs.pop();
    } catch { /* نیست */ }
  }
  return '';
}

const msvc = findMsvc();

/**
 * محیط کامل MSVC از vcvars64.bat.
 *
 * چرا نه فقط PATH: link.exe برای پیوند دادن به `LIB` (مسیر kernel32.lib و…)
 * و `INCLUDE` نیاز دارد. مایکروسافت خودش این‌ها را با vcvars تنظیم می‌کند؛
 * پس همان را اجرا می‌کنیم و خروجی `set` را می‌خوانیم.
 */
let msvcEnvCache = null;
function msvcEnv() {
  if (msvcEnvCache !== null) return msvcEnvCache;
  if (!isWin || !msvc.found) { msvcEnvCache = {}; return msvcEnvCache; }
  if (inPath('link.exe')) { msvcEnvCache = {}; return msvcEnvCache; } /* از قبل در PATH است (Developer Command Prompt) */

  const cmd = `call "${msvc.vcvars}" x64 >nul 2>&1 && set`;
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', cmd], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  const env = {};
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    /* فقط متغیرهایی که به کامپایل مربوط‌اند — تا محیط آلوده نشود */
    if (/^(PATH|LIB|INCLUDE|LIBPATH|VCINSTALLDIR|VCToolsInstallDir|VSINSTALLDIR|WindowsSdkDir|WindowsSDKVersion|Platform|UCRTVersion|UniversalCRTSdkDir|VSCMD_ARG_TGT_ARCH)$/i.test(key)) {
      env[key] = line.slice(i + 1);
    }
  }
  msvcEnvCache = env;
  return env;
}

/**
 * محیط اجرای cargo با PATH اصلاح‌شده.
 * چرا: حتی وقتی `cargo` در PATH هست، `rustc`/`rustup` ممکن است نباشند؛
 * هر دو در همان پوشه‌ی `~/.cargo/bin` هستند.
 */
function rustEnv({ offline = false } = {}) {
  const sep = isWin ? ';' : ':';
  const prepend = [];
  if (cargoPath) prepend.push(path.dirname(cargoPath));
  prepend.push(path.join(cargoHome, 'bin'), path.join(home, '.cargo', 'bin'));
  if (isWin) {
    /*
     * لینکر C++: اگر در PATH نبود، از vcvars64 محیط کامل می‌گیریم
     * (PATH + LIB + INCLUDE). فقط bin کافی نیست — خطای link.exe برمی‌گردد.
     */
    const full = msvcEnv();
    if (full.PATH) {
      /* `set` در vcvars مسیرها را با «;» می‌دهد؛ همه را جلو می‌گذاریم */
      for (const p of full.PATH.split(';').slice(0, 40)) if (p) prepend.push(p);
    } else if (msvc.found) {
      prepend.push(path.dirname(msvc.linkExe));
    }
  }
  const seen = new Set();
  const parts = [...prepend, ...(process.env.PATH || '').split(sep)]
    .filter((p) => {
      if (!p) return false;
      const k = p.toLowerCase();
      return seen.has(k) ? false : (seen.add(k), true);
    });
  const env = { ...process.env, PATH: parts.join(sep) };
  if (isWin) {
    /* LIB و INCLUDE از vcvars — بدون این‌ها link.exe فایل‌های .lib را پیدا نمی‌کند */
    const full = msvcEnv();
    for (const k of ['LIB', 'INCLUDE', 'LIBPATH', 'WindowsSdkDir', 'WindowsSDKVersion',
      'UCRTVersion', 'UniversalCRTSdkDir', 'VCINSTALLDIR', 'VCToolsInstallDir', 'VSINSTALLDIR',
      'Platform', 'VSCMD_ARG_TGT_ARCH']) {
      if (full[k]) env[k] = full[k];
    }
  }
  if (offline) {
    env.CARGO_NET_OFFLINE = 'true';
    env.npm_config_offline = 'true';
  }
  return env;
}

const cargoVersion = cargoPath
  ? (spawnSync(cargoPath, ['--version'], { encoding: 'utf8' }).stdout || '').trim()
  : '';

/* ------------------------------------------------------------------ */
/* ۲) پیام‌های راهنما                                                  */
/* ------------------------------------------------------------------ */

function rustInstallHelp() {
  console.log(`\n${C.bad('⛔ Rust پیدا نشد — همان چیزی که باعث خطای «cargo metadata … program not found» می‌شود.')}`);
  console.log('');
  if (isWin) {
    console.log(`  ${C.bold('راه ۱ (ساده‌ترین):')}  ${C.bold('winget install --id Rustlang.Rustup -e')}`);
    console.log(`  ${C.bold('راه ۲:')}  https://rustup.rs → دانلود rustup-init.exe → اجرا → Enter`);
    console.log(`  ${C.bold('راه ۳ (بدون تایپ):')}  در ویندوز اکسپلورر به پوشه‌ی ${C.bold('scripts')} بروید،`);
    console.log(`         روی ${C.bold('install-rust.ps1')} راست‌کلیک → ${C.bold('Run with PowerShell')}`);
  } else {
    console.log(`  ${C.bold('curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh')}`);
  }
  console.log('');
  console.log(`  بعد از نصب، ${C.bold('این پنجره را ببندید و یک ترمینال تازه باز کنید')}، بعد:`);
  console.log(`     ${C.bold('npm run desktop:build')}`);
  console.log('');
  console.log(`  ${C.dim('نصب Rust یک بار و با انترنت لازم است؛ ساخت‌های بعدی می‌توانند آفلاین باشند.')}`);
  console.log(`  ${C.dim('جزئیات: docs/TAURI-BUILD.md — بخش ۲ و بخش ۸ (ساخت آفلاین)')}\n`);
}

/**
 * پیام راهنمای خطای لینکر — برای خطای واقعیِ کاربر:
 *
 *   error: linker `link.exe` not found
 *     = note: the msvc targets depend on the msvc linker but `link.exe` was not found
 *
 * سه حالت و سه راه‌حل مشخص.
 */
function linkerHelp(reason, detail) {
  console.log(`\n${C.bad('⛔ لینکر C++ (link.exe) پیدا نشد — Rust بدون آن نمی‌تواند فایل .exe بسازد.')}`);
  if (reason) console.log(`   ${C.dim(reason)}`);
  console.log('');
  console.log(`  ${C.bold('پیام اصلی Rust (همان چیزی که دیدید):')}`);
  console.log(`    ${C.dim('error: linker `link.exe` not found')}`);
  console.log(`    ${C.dim('note: the msvc targets depend on the msvc linker but `link.exe` was not found')}`);
  console.log('');

  if (!isWin) {
    console.log('  روی لینوکس این خطا معنی ندارد. بسته‌های سیستمی را نصب کنید:');
    console.log('    sudo apt install -y build-essential libwebkit2gtk-4.1-dev libssl-dev');
    console.log('');
    return;
  }

  if (detail === 'vs-no-cpp') {
    /* VS نصب است ولی کامپوننت C++ ندارد — شایع‌ترین حالت */
    console.log(`  ${C.bold('علت:')} Visual Studio نصب است ولی کامپوننت ${C.bold('«Desktop development with C++')} را ندارد.`);
    console.log(`  ${C.dim(`(نصب پیدا‌شده: ${msvc.vsPath || '—'}، ولی پوشه‌ی VC\\Tools\\MSVC یا link.exe ندارد)`)}`);
    console.log('');
    console.log(`  ${C.bold('راه‌حل (ساده‌ترین):')}`);
    console.log(`    ${C.bold('visualstudio.microsoft.com/visual-cpp-build-tools')} → نصب‌کننده → ${C.bold('Modify')}`);
    console.log(`    تیک: ${C.bold('Desktop development with C++')} → Install (~۱٫۵ گیگابایت)`);
    console.log('');
    console.log(`  یا همین در یک دستور (اگر winget دارید — پارامترها را با نسخه‌ی خودتان چک کنید):`);
    console.log(`    ${C.bold('winget install Microsoft.VisualStudio.2022.BuildTools')}`);
    console.log(`    بعد از نصب: ${C.bold('npm run doctor')}`);
    console.log('');
    return;
  }

  console.log(`  ${C.bold('علت:')} کامپایلر/لینکر C++ نصب نیست. ${C.dim('(VS Code کافی نیست — این را خودِ Rust هم می‌گوید)')}`);
  console.log('');
  console.log(`  ${C.bold('راه ۱ (پیشنهادی): Visual Studio Build Tools')}`);
  console.log(`    ۱. بروید به ${C.bold('https://visualstudio.microsoft.com/visual-cpp-build-tools/')}`);
  console.log(`       → دکمه‌ی ${C.bold('Download Build Tools')}`);
  console.log(`    ۲. در نصب‌کننده: تب ${C.bold('Workloads')} → تیک ${C.bold('Desktop development with C++')}`);
  console.log(`    ۳. در پنل راست مطمئن شوید این‌ها تیک دارند:`);
  console.log(`         • MSVC v143 — VS 2022 C++ x64/x86 build tools`);
  console.log(`         • ${C.bold('Windows 11 SDK')} (یا Windows 10 SDK)`);
  console.log(`    ۴. ${C.bold('Install')} (~۱٫۵ گیگابایت، ۱۰ تا ۲۰ دقیقه)`);
  console.log('');
  console.log(`  ${C.bold('راه ۲ (winget):')}`);
  console.log(`    ${C.bold('winget install Microsoft.VisualStudio.2022.BuildTools')}`);
  console.log(`    ${C.dim('سپس در «Visual Studio Installer» روی Modify بزنید و «Desktop development with C++» را تیک بزنید.')}`);
  console.log('');
  console.log(`  ${C.bold('راه ۳:')} اگر Visual Studio 2022 Community/Professional دارید:`);
  console.log(`    Visual Studio Installer → ${C.bold('Modify')} → تیک ${C.bold('Desktop development with C++')} → Modify`);
  console.log('');
  console.log(`  ${C.dim('بعد از نصب، همین دستور را دوباره بزنید (نیازی به ری‌استارت نیست):')}`);
  console.log(`    ${C.bold('npm run desktop:build')}`);
  console.log(`  ${C.dim('این اسکریپت خودش vcvars64 را اجرا و محیط کامل لینکر را تنظیم می‌کند.')}`);
  console.log(`  ${C.dim('راه دیگر: از منوی استارت «x64 Native Tools Command Prompt for VS 2022» را باز کنید و همان دستور را بزنید.')}`);
  console.log('');
}

function cargoPathHelp() {
  console.log(`\n${C.warn('⚠ cargo نصب است ولی این پنجره‌ی ترمینال آن را در PATH نمی‌بیند.')}`);
  console.log(`  مسیر پیدا‌شده: ${C.bold(cargoOnDisk)}`);
  console.log(`  این اسکریپت مسیر را برای همین اجرا اضافه می‌کند و ادامه می‌دهد.`);
  console.log(`  ${C.dim('برای رفع دائمی: ترمینال را ببندید و باز کنید.')}\n`);
}

/* ------------------------------------------------------------------ */
/* ۳) اجرای دستورها                                                    */
/* ------------------------------------------------------------------ */

/** اجرای قابل‌اعتماد: فایل‌های .cmd روی ویندوز به shell نیاز دارند */
function runNodeScript(scriptArgs, env) {
  const r = spawnSync(process.execPath, scriptArgs, { cwd: root, stdio: 'inherit', env });
  return r.status ?? 1;
}

function runNpm(scriptName, env) {
  const r = spawnSync(isWin ? 'npm.cmd' : 'npm', ['run', scriptName], {
    cwd: root, stdio: 'inherit', env, shell: isWin,
  });
  return r.status ?? 1;
}

/* ------------------------------------------------------------------ */
/* گرفتن خروجی ساخت برای تشخیص خودکار خطا                             */
/* ------------------------------------------------------------------ */
/*
 * چرا: کاربر خطا را در انتهای یک ساخت طولانی می‌بیند و باید بداند *کدام*
 * مشکل است. حداکثر ۴۰۰ کیلوبایت آخر خروجی نگه داشته می‌شود (کافی برای
 * پیام خطا) و همان لحظه هم روی صفحه چاپ می‌شود — تجربه‌ی کاربر عوض نمی‌شود.
 */
const LOG_LIMIT = 400 * 1024;
let tauriLog = '';
function appendLog(chunk) {
  tauriLog += chunk;
  if (tauriLog.length > LOG_LIMIT) tauriLog = tauriLog.slice(-LOG_LIMIT);
}
const buildLogHas = (re) => re.test(tauriLog);

/** آیا Visual Studio (هر نسخه‌ای) روی دیسک هست؟ */
function vsInstalled() {
  if (msvc.found || msvc.sawVisualStudio) return true;
  return ['C:\\Program Files (x86)\\Microsoft Visual Studio',
    'C:\\Program Files\\Microsoft Visual Studio'].some((p) => fs.existsSync(p));
}

/** اجرای یک دستور با چاپ زنده + نگه‌داشتن خروجی؛ Promise برمی‌گرداند */
function runStreamed(cmd, cmdArgs, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { ...opts, stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => { process.stdout.write(b); appendLog(b.toString('utf8')); });
    child.stderr.on('data', (b) => { process.stderr.write(b); appendLog(b.toString('utf8')); });
    child.on('error', (e) => { appendLog(String(e && e.message)); resolve(1); });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/**
 * اجرای Tauri CLI از نصب محلی.
 *
 * مهم: `npx --no-install` — بدون این پرچم، npx ممکن است بخواهد بسته را از
 * شبکه بگیرد؛ روی کمپیوتر آفلاین همان باعث خطای گمراه‌کننده می‌شود.
 */
async function runTauriBuild(env) {
  const cliJs = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const tauriArgs = ['build'];
  if (wantDebug) tauriArgs.push('--debug');
  if (wantOffline) tauriArgs.push('--', '--offline');

  if (isFile(cliJs)) {
    /* مستقیم با node — نه npx، نه shell؛ هیچ امکان دانلود/شکنندگی نقل‌قول */
    console.log(`  ${C.dim(`اجرا: node node_modules/@tauri-apps/cli/tauri.js ${tauriArgs.join(' ')}`)}`);
    return runStreamed(process.execPath, [cliJs, ...tauriArgs], { cwd: root, env });
  }
  /* نسخه‌ی قدیمی نصب: همان npx با --no-install */
  console.log(`  ${C.warn('⚠ نصب محلی Tauri CLI پیدا نشد — با npx --no-install تلاش می‌شود')}`);
  return runStreamed('npx', ['--no-install', 'tauri', ...tauriArgs], { cwd: root, env, shell: isWin });
}

/* ------------------------------------------------------------------ */
/* ۴) گزارش محیط                                                       */
/* ------------------------------------------------------------------ */

console.log(`\n${C.bold('— بررسی محیط ساخت —')}`);
console.log(`  سیستم: ${os.platform()} ${os.arch()} · Node ${process.version}`);
console.log(`  پوشه پروژه: ${root}`);

if (cargoPath) {
  console.log(`  ${C.ok('✔')} ${cargoVersion || cargoPath}`);
  if (!cargoInPath) console.log(`  ${C.warn('⚠')} cargo در PATH نبود — ${C.dim(path.dirname(cargoPath))} برای این ساخت اضافه شد.`);
} else {
  console.log(`  ${C.bad('✘')} cargo پیدا نشد`);
}

if (isWin) {
  const wvKey = 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  const wv = spawnSync('reg', ['query', wvKey, '/v', 'pv'], { encoding: 'utf8' });
  const hasWv = /pv\s+REG_SZ/.test(wv.stdout || '');
  console.log(`  ${hasWv ? C.ok('✔') : C.warn('⚠')} WebView2: ${hasWv ? 'نصب است' : 'در رجیستری نبود (نصب‌کننده خودش نصب می‌کند)'}`);

  /* لینکر C++ — منشأ خطای «linker link.exe not found» */
  if (msvc.found) {
    const fromPath = inPath('link.exe');
    console.log(`  ${C.ok('✔')} لینکر C++: MSVC ${msvc.msvcVersion}${msvc.sdkVersion ? ' · SDK ' + msvc.sdkVersion : ''}`);
    console.log(`     ${C.dim(msvc.linkExe)}`);
    if (!fromPath) console.log(`     ${C.dim('(در PATH نبود — محیط کامل vcvars64 خودکار تنظیم می‌شود)')}`);
  } else {
    console.log(`  ${C.bad('✘')} لینکر C++ (link.exe): پیدا نشد — ساخت شکست می‌خورد`);
  }
}

const tauriLocal = isFile(path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'));
console.log(`  ${tauriLocal ? C.ok('✔') : C.bad('✘')} Tauri CLI: ${tauriLocal ? 'نصب محلی (آفلاین‌پذیر)' : 'نصب نیست — npm install'}`);

const registryHasCrates = (() => {
  try { return fs.readdirSync(path.join(cargoHome, 'registry', 'cache')).length > 0; } catch { return false; }
})();
console.log(`  ${registryHasCrates ? C.ok('✔') : C.warn('⚠')} کریت‌های Rust: ${registryHasCrates ? 'در حافظه محلی موجود' : 'خالی — اولین ساخت به انترنت نیاز دارد'}`);

/* ------------------------------------------------------------------ */
/* ۵) --prefetch : آماده‌سازی آفلاین                                    */
/* ------------------------------------------------------------------ */

if (wantPrefetch) {
  if (!cargoPath) { rustInstallHelp(); process.exit(1); }
  console.log(`\n${C.bold('▶ آماده‌سازی آفلاین (یک بار، با انترنت)')}`);
  const env = rustEnv();
  const manifest = path.join(root, 'src-tauri', 'Cargo.toml');
  console.log('  ۱/۲ دانلود crateهای Rust…');
  const fetch = spawnSync(cargoCmd, ['fetch', '--manifest-path', manifest], { cwd: root, stdio: 'inherit', env });
  if ((fetch.status ?? 1) !== 0) {
    console.log(C.bad('\n⛔ cargo fetch ناموفق — اتصال اینترنت را بررسی کنید.'));
    process.exit(fetch.status ?? 1);
  }
  const lock = path.join(root, 'src-tauri', 'Cargo.lock');
  console.log(`  ۲/۲ Cargo.lock: ${fs.existsSync(lock) ? C.ok('موجود') : C.warn('ساخته نشد — یک بار cargo build لازم است')}`);
  console.log(C.ok('\n✔ آماده است. از حالا بدون انترنت:'));
  console.log(`   ${C.bold('npm run desktop:build -- --offline')}`);
  console.log(`   ${C.dim('اگر قصد دارید روی کمپیوتر آفلاین بسازید، پوشه‌ی ' + cargoHome + ' و node_modules را هم منتقل کنید.')}\n`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* ۶) ساخت                                                             */
/* ------------------------------------------------------------------ */

if (!cargoPath) { rustInstallHelp(); process.exit(1); }
if (!cargoInPath) cargoPathHelp();

/*
 * پیش‌بررسی لینکر — قبل از چند دقیقه کامپایل، نه بعد از آن.
 * چرا: کاربر خطای «linker link.exe not found» را *در انتهای* یک ساخت
 * طولانی دید؛ بهتر است همان اول بداند چه کم است.
 */
if (isWin && !msvc.found && !inPath('link.exe') && process.env.FD_SKIP_MSVC_CHECK !== '1') {
  linkerHelp('پیش‌بررسی محیط انجام شد.', vsInstalled() ? 'vs-no-cpp' : 'no-vs');
  process.exit(1);
}

if (!tauriLocal) {
  console.log(`\n${C.bad('⛔ @tauri-apps/cli نصب نیست.')}`);
  console.log(`   با انترنت:  ${C.bold('npm install')}`);
  console.log(`   ${C.dim('اگر آفلاین هستید، node_modules را از کمپیوتر دیگر کپی کنید.')}\n`);
  process.exit(1);
}

if (wantOffline && !registryHasCrates) {
  console.log(`\n${C.bad('⛔ حالت آفلاین انتخاب شده ولی کریت‌های Rust دانلود نشده‌اند.')}`);
  console.log(`   یک بار با انترنت:  ${C.bold('npm run desktop:build -- --prefetch')}`);
  console.log(`   ${C.dim('یا فایل ZIP نود را بدهید: npm run desktop:build:offline -- "D:\\node-v22-win-x64.zip"')}\n`);
  process.exit(1);
}

const env = rustEnv({ offline: wantOffline });

console.log(`\n${C.bold(`▶ ۱/۳ ساخت API و رابط کاربری`)}`);
let code = runNpm('build:desktop', env);
if (code !== 0) {
  console.log(C.bad('\n⛔ ساخت API یا رابط کاربری ناموفق بود — پیام بالا را ببینید.'));
  process.exit(code);
}

const apiEntry = path.join(root, 'src-tauri', 'api', 'app.js');
const nodeInBundle = path.join(root, 'src-tauri', 'api', 'node.exe');
const needPack = !fs.existsSync(apiEntry) || (isWin && !fs.existsSync(nodeInBundle));

if (skipApiPack) {
  console.log(`\n${C.dim('▶ ۲/۳ بسته‌بندی API — با --skip-api رد شد')}`);
} else if (!needPack) {
  console.log(`\n${C.dim('▶ ۲/۳ بسته API از قبل آماده است (شامل node.exe) — رد شد')}`);
} else {
  console.log(`\n${C.bold('▶ ۲/۳ بسته‌بندی API' + (isWin ? ' + node.exe' : ''))}`);
  const packArgs = ['scripts/build-desktop-api.mjs'];
  if (isWin) packArgs.push('--require-node');
  /* ZIP محلی نود (مسیر از prepare-offline-desktop.mjs می‌آید) — بدون دانلود */
  if (process.env.FD_NODE_ZIP) packArgs.push('--node-zip', process.env.FD_NODE_ZIP);
  code = runNodeScript(packArgs, env);
  if (code !== 0) {
    console.log(C.bad('\n⛔ بسته‌بندی API ناموفق بود.'));
    console.log(`   اگر پیام مربوط به دانلود node.exe بود، یعنی اینترنت لازم است.`);
    console.log(`   راه آفلاین: فایل ZIP نود را از قبل بگیرید و بزنید:`);
    console.log(`     ${C.bold(`npm run desktop:build:offline -- "D:\\node-v${process.versions.node}-win-x64.zip"`)}`);
    console.log(`   ${C.dim('لینک دانلود همان ZIP: https://nodejs.org/dist/v' + process.versions.node + `/node-v${process.versions.node}-win-x64.zip`)}\n`);
    process.exit(code);
  }
}

console.log(`\n${C.bold(`▶ ۳/۳ ساخت نصب‌کننده${wantDebug ? ' (debug)' : ''}${wantOffline ? ' — آفلاین' : ''}`)}`);
console.log(`  ${C.dim('اولین ساخت ۳ تا ۱۰ دقیقه طول می‌کشد (کامپایل crateها).')}`);
code = await runTauriBuild(env);

if (code !== 0) {
  console.log(`\n${C.bad('⛔ ساخت نصب‌کننده ناموفق بود.')}`);
  /* تشخیص خودکار نوع خطا از نسخه‌ی باستان — کاربر لازم نباشد دنبال جدول بگردد */
  if (buildLogHas(/link\.exe.*not found|msvc linker but .*link\.exe/i)) {
    linkerHelp('خروجی ساخت همین را نشان داد.', vsInstalled() ? 'vs-no-cpp' : 'no-vs');
  } else if (buildLogHas(/Persian\.nlf|MUI_LANGUAGEEX/i)) {
    console.log(`  ${C.bold('علت: تنظیم زبان نصب‌کننده (Persian.nlf).')} راه‌حل: ${C.bold('git pull')} — NSIS زبان فارسی را «Farsi» می‌شناسد.`);
  } else if (buildLogHas(/failed to run .cargo metadata|program not found/i) && !cargoPath) {
    rustInstallHelp();
  } else {
    console.log(`  ${C.bold('راهنمای خطاهای رایج:')} docs/TAURI-BUILD.md — بخش ۱۰ و ۱۳`);
    console.log(`  ${C.dim('متن انگلیسی خطا را نگه دارید؛ اکثر آن‌ها در همان جدول آمده‌اند.')}`);
  }
  console.log('');
  process.exit(code);
}

/* ------------------------------------------------------------------ */
/* ۷) گزارش خروجی                                                      */
/* ------------------------------------------------------------------ */

const bundleDir = path.join(root, 'src-tauri', 'target', wantDebug ? 'debug' : 'release', 'bundle');
console.log(`\n${C.ok('✔ نصب‌کننده ساخته شد:')}`);
let found = 0;
for (const kind of ['nsis', 'msi']) {
  const dir = path.join(bundleDir, kind);
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(exe|msi)$/i.test(f)) continue;
      const p = path.join(dir, f);
      console.log(`   ${p}  ${C.dim((fs.statSync(p).size / 1024 / 1024).toFixed(1) + ' MB')}`);
      found++;
    }
  } catch { /* این نوع بسته ساخته نشده */ }
}
if (!found) console.log(`   ${C.warn('⚠ فایلی در ' + bundleDir + ' پیدا نشد — لاگ بالا را ببینید.')}`);
console.log(`\n   ${C.dim('این فایل مستقل است: روی کمپیوتر شرکت نه Node لازم است، نه Rust، نه انترنت.')}\n`);
