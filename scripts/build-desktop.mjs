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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMsvc, msvcEnv as msvcEnvOfMsvc, isFile as libIsFile } from './lib/msvc.mjs';
import { webview2Status, prepareWebView2 } from './lib/webview2.mjs';

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
/* ۱/ب) پیدا کردن لینکر C++ (link.exe) — ماژول مشترک                  */
/* ------------------------------------------------------------------ */
/*
 * منطق در `scripts/lib/msvc.mjs` است تا این اسکریپت، `doctor` و
 * `find-msvc` **دقیقاً یک رفتار** داشته باشند.
 *
 * درس دور سیزدهم: نسخه‌ی قبلی فقط پوشه‌های `…\2019\…` و `…\2022\…` را
 * می‌گشت. کاربر Build Tools کامل نصب داشت (MSVC v143 + SDK) ولی نصب در
 * مسیری بود که ما نمی‌گشتیم → پیام گمراه‌کننده‌ی «link.exe پیدا نشد».
 * حالا: vswhere -all -format json، سپس vswhere -find (مستقل از چیدمان)،
 * سپس پیمایش هر نام نسخه، سپس جست‌وجوی محدود داخل نصب.
 */
const msvc = findMsvc();

/* محیط کامل کامپایل (vcvars64 یا ساخت دستی LIB/INCLUDE) — یک بار */
let msvcHow = '';
let msvcEnvCache = null;
function msvcEnv() {
  if (msvcEnvCache === null) msvcEnvCache = msvcEnvOfMsvc(msvc);
  return msvcEnvCache;
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
    const { env: full, how } = msvcEnv();
    if (full.PATH) {
      /* `set` در vcvars مسیرها را با «;» می‌دهد؛ همه را جلو می‌گذاریم */
      for (const p of full.PATH.split(';').slice(0, 40)) if (p) prepend.push(p);
    } else if (msvc.found) {
      prepend.push(path.dirname(msvc.linkExe));
    }
    msvcHow = how;
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
    const { env: full } = msvcEnv();
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
    /*
     * حالت واقعی دور سیزدهم: نصب هست، کامپوننت هم نصب است، ولی ما
     * مسیرش را پیدا نکردیم. نسخه‌ی قبلی اینجا یک پیام قطعیِ **نادرست**
     * می‌داد («کامپوننت را ندارد»). حالا فقط واقعیت را می‌گوییم:
     * کدام مسیرها بررسی شد و در هر کدام چه بود.
     */
    console.log(`  ${C.bold('علت دقیق:')} یک نصب/پوشه‌ی Visual Studio دیده شد، ولی در مسیرهای ` +
      `بررسی‌شده ${C.bold('link.exe')} پیدا نشد.`);
    console.log(`  ${C.dim('این لزوماً یعنی نصب ناقص نیست — ممکن است چیدمان پوشه غیرمعمول باشد.')}`);
    console.log('');
    if (msvc.checked.length) {
      console.log(`  ${C.bold('مسیرهایی که بررسی شد:')}`);
      for (const c of msvc.checked.slice(0, 10)) {
        console.log(`    • ${c.path}`);
        console.log(`      ${C.dim(`${c.why} — ${c.source}`)}`);
      }
      if (msvc.checked.length > 10) console.log(`    ${C.dim(`… و ${msvc.checked.length - 10} مسیر دیگر`)}`);
    }
    if (msvc.instances.length) {
      console.log(`\n  ${C.bold('نصب‌های ثبت‌شده در vswhere:')}`);
      for (const it of msvc.instances.slice(0, 6)) {
        console.log(`    • ${it.displayName || '?'} → ${it.path} ${C.dim(`(${it.version || '?'})`)}`);
      }
    }
    console.log('');
    console.log(`  ${C.bold('قدم ۱ — عیب‌یابی دقیق (همین را بزنید):')}`);
    console.log(`    ${C.bold('npm run find:msvc')}`);
    console.log(`    ${C.dim('این دستور می‌گوید لینکر روی دیسک کجاست؛ اگر جای غیرمعمول باشد،')}`);
    console.log(`    ${C.dim('دستور «set FD_MSVC_ROOT=…» را آماده چاپ می‌کند.')}`);
    console.log('');
    console.log(`  ${C.bold('قدم ۲ — اگر link.exe پیدا شد، مسیر را معرفی کنید:')}`);
    console.log(`    ${C.bold('set FD_MSVC_ROOT=<ریشه‌ی نصب>')}   سپس ${C.bold('npm run desktop:build')}`);
    console.log('');
    console.log(`  ${C.bold('قدم ۳ — اگر واقعاً کامپوننت نیست:')}`);
    console.log(`    Visual Studio Installer → ${C.bold('Modify')} → تیک ${C.bold('«Desktop development with C++')}`);
    console.log(`    + «MSVC v143 …» + «Windows 11 SDK» → Modify`);
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
  /*
   * `FD_RELEASE=1` یعنی «این بیلد به مشتری می‌رود». `src-tauri/build.rs` با
   * همین متغیر، ساختِ بدون مُهر (یعنی بدون کلید عمومی داخل باینری) را متوقف
   * می‌کند — وگرنه کلید عمومی فقط یک فایل متنی کنار برنامه می‌شد و با
   * عوض کردنش هر کسی می‌توانست لایسنس خودش را بسازد. بیلد `--debug` هم
   * انتشاری نیست.
   */
  const buildEnv = wantDebug ? { ...env } : { ...env, FD_RELEASE: '1' };
  if (wantDebug) tauriArgs.push('--debug');
  if (wantOffline) tauriArgs.push('--', '--offline');

  if (isFile(cliJs)) {
    /* مستقیم با node — نه npx، نه shell؛ هیچ امکان دانلود/شکنندگی نقل‌قول */
    console.log(`  ${C.dim(`اجرا: node node_modules/@tauri-apps/cli/tauri.js ${tauriArgs.join(' ')}`)}`);
    return runStreamed(process.execPath, [cliJs, ...tauriArgs], { cwd: root, env: buildEnv });
  }
  /* نسخه‌ی قدیمی نصب: همان npx با --no-install */
  console.log(`  ${C.warn('⚠ نصب محلی Tauri CLI پیدا نشد — با npx --no-install تلاش می‌شود')}`);
  return runStreamed('npx', ['--no-install', 'tauri', ...tauriArgs], { cwd: root, env: buildEnv, shell: isWin });
}

/* ------------------------------------------------------------------ */
/* خودآزمایی محیط کامپایل                                              */
/* ------------------------------------------------------------------ */

/**
 * آیا می‌توان یک فایل C++ که `windows.h` را include می‌کند کامپایل کرد؟
 *
 * چرا لازم است: بدون این بررسی، اولین خطای واقعی بعد از ~۱۰ دقیقه کامپایل
 * ظاهر می‌شود (`fatal error C1083: Cannot open include file: 'winapifamily.h'`).
 * اینجا فقط چند وجود فایل را می‌سنجیم — ارزان و سریع.
 */
function checkCompileEnv(vars) {
  const incs = (vars.INCLUDE || '').split(';').filter(Boolean);
  const libs = (vars.LIB || '').split(';').filter(Boolean);
  const has = (dirs, file) => dirs.some((d) => isFile(path.join(d, file)));

  const fatal = [];
  const checked = [];

  if (!incs.length) fatal.push('INCLUDE خالی است (هدرهای C++ تنظیم نشده)');
  else {
    /* windows.h خودش در `um` است و winapifamily.h را از `shared` می‌خواند */
    if (has(incs, 'windows.h')) checked.push('windows.h');
    else fatal.push('windows.h پیدا نشد — پوشه‌ی «um» ویندوز SDK در INCLUDE نیست');
    if (has(incs, 'winapifamily.h')) checked.push('winapifamily.h');
    else fatal.push('winapifamily.h پیدا نشد — پوشه‌ی «shared» ویندوز SDK در INCLUDE نیست (خطای C1083)');
  }

  if (!libs.length) fatal.push('LIB خالی است (کتابخانه‌های ویندوز تنظیم نشده)');
  else if (!has(libs, 'kernel32.lib')) fatal.push('kernel32.lib پیدا نشد — پوشه‌ی «um\\x64» ویندوز SDK در LIB نیست');
  else checked.push('kernel32.lib');

  return { fatal, checked };
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
    console.log(`  ${C.ok('✔')} لینکر C++: MSVC ${msvc.msvcVersion || '?'}${msvc.sdkVersion ? ' · SDK ' + msvc.sdkVersion : ''}`);
    console.log(`     ${C.dim(msvc.linkExe)}`);
    console.log(`     ${C.dim(`منبع: ${msvc.source}${msvc.how ? ' · ' + msvc.how : ''}`)}`);
    const { how, env: msvcVars, vcvarsReason } = msvcEnv();
    if (how === 'vcvars64') console.log(`     ${C.dim('محیط vcvars64 خودکار تنظیم شد (PATH + LIB + INCLUDE)')}`);
    else if (how === 'vcvarsall x64') console.log(`     ${C.dim('محیط vcvarsall x64 خودکار تنظیم شد (PATH + LIB + INCLUDE)')}`);
    else if (how === 'ساخت دستی LIB/INCLUDE') console.log(`     ${C.warn('⚠ vcvars تنظیم نشد — LIB/INCLUDE دستی ساخته شد')}`);
    else if (how === 'link.exe از قبل در PATH') console.log(`     ${C.dim('link.exe از قبل در PATH بود (Developer Command Prompt)')}`);
    else if (how === 'ناموفق') console.log(`     ${C.bad('✘ محیط کامپایل تنظیم نشد — ساخت احتمالاً شکست می‌خورد')}`);
    if (vcvarsReason) console.log(`     ${C.dim('دلیل: ' + vcvarsReason)}`);

    /*
     * خودآزمایی محیط کامپایل.
     *
     * درس دور پانزدهم: `vswhom-sys` با این خطا شکست خورد
     *   windows.h(1): fatal error C1083: Cannot open include file: 'winapifamily.h'
     * چون INCLUDE پوشه‌ی `shared` ویندوز SDK را نداشت. این خطا **ده دقیقه
     * بعد** از شروع کامپایل ظاهر می‌شود؛ بهتر است همین اول معلوم شود.
     * پس وجود هدرهای کلیدی و پوشه‌های LIB را قبل از ساخت می‌سنجیم.
     */
    const missing = checkCompileEnv(msvcVars);
    if (missing.fatal.length) {
      console.log(`  ${C.bad('✘')} محیط کامپایل ناقص است — ساخت شکست می‌خورد:`);
      for (const m of missing.fatal) console.log(`       • ${m}`);
      console.log(`     ${C.dim('راه‌حل: npm run desktop:env   (تشخیص کامل) یا نصب «Windows 11 SDK» در Build Tools')}`);
      process.exit(1);
    }
    console.log(`     ${C.ok('✔')} هدرهای کلیدی ویندوز پیدا شد${missing.checked.length ? ` (${missing.checked.join(', ')})` : ''}`);
  } else {
    console.log(`  ${C.bad('✘')} لینکر C++ (link.exe): پیدا نشد — ساخت شکست می‌خورد`);
    console.log(`     ${C.dim(`${msvc.checked.length} مسیر بررسی شد؛ جزئیات با: npm run find:msvc`)}`);
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
  console.log(`  ۲/۳ Cargo.lock: ${fs.existsSync(lock) ? C.ok('موجود') : C.warn('ساخته نشد — یک بار cargo build لازم است')}`);

  /*
   * ۳) کش باینری ویندوزی libSQL.
   *
   * باگ واقعی که این مرحله حل می‌کند: ساخت روی لینوکس (یا هر جایی که
   * `npm ci` باینری ویندوزی را نصب نکند) به `curl` نیاز داشت. روی کمپیوتر
   * **بدون انترنت** این مرحله شکست می‌خورد و نصب‌کننده روی ویندوز با
   * «Cannot find module @libsql/win32-x64-msvc» بالا نمی‌آمد.
   * حالا در مرحله‌ی prefetch (که عمداً با انترنت اجرا می‌شود) همان فایل
   * ذخیره می‌شود تا ساخت آفلاین کامل باشد.
   */
  console.log('  ۳/۳ آماده‌سازی باینری ویندوزی libSQL…');
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'prefetch-libsql.mjs')], { cwd: root, stdio: 'inherit' });
  } catch (e) {
    console.log(C.warn('     ⚠ کش libSQL آماده نشد — ساخت آفلاین بعداً از این مرحله رد نمی‌شود.'));
  }

  console.log(C.ok('\n✔ آماده است. از حالا بدون انترنت:'));
  console.log(`   ${C.bold('npm run desktop:build -- --offline')}`);
  console.log(`   ${C.dim('اگر قصد دارید روی کمپیوتر آفلاین بسازید، پوشه‌های ' + cargoHome + ' و .cache و node_modules را هم منتقل کنید.')}\n`);
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

/*
 * پیش‌نیاز ماژول WebView2 (مستقل از انترنت سازنده).
 *
 * bundler در حالت offlineInstaller فایل نصب‌کننده‌ی WebView2 را از
 * Microsoft (go.microsoft[.]com) می‌گیرد و **بعد** داخل نصب‌کننده می‌گذارد. اگر فایل از قبل
 * در کش باشد (`if !file_path.exists()` در tauri-bundler)، دانلود انجام نمی‌شود.
 * این بلوک همان حالت را تضمین می‌کند و اگر فایل نبود، به کاربر می‌گوید یک بار
 * `npm run webview2:prepare` بزند — به‌جای اینکه وسط ساخت غافلگیر شود.
 */
{
  const wv = webview2Status();
  if (wv.readyOffline) {
    console.log(`  ${C.ok('✔')} WebView2: نصب‌کننده‌ی آفلاین از قبل در کش هست — هیچ دانلودی لازم نیست.`);
  } else if (wantOffline) {
    console.log(`\n${C.bad('⛔ حالت آفلاین: نصب‌کننده‌ی آفلاین WebView2 در کش نیست.')}`);
    console.log(`   بدون آن، bundler خودش سعی می‌کند از سایت مایکروسافت دانلود کند.`);
    console.log(`   یک بار با انترنت:  ${C.bold('npm run webview2:prepare')}`);
    console.log(`   ${C.dim(`یا فایل نصب‌کننده را در ${path.join(wv.toolsDir, 'x64', '<GUID>')} بگذارید.`)}\n`);
    process.exit(1);
  } else if (isWin) {
    /* ساخت معمولی: سعی می‌کنیم همان‌جا آماده کنیم (اگر انترنت باشد) */
    console.log(`  ${C.warn('⚠')} نصب‌کننده‌ی آفلاین WebView2 در کش نیست — تلاش برای گرفتن یک‌باره …`);
    try {
      await prepareWebView2({ log: (m) => console.log(`    ${C.dim(m)}`) });
      console.log(`  ${C.ok('✔')} WebView2 آماده شد — ساخت بعدی کاملاً آفلاین است.`);
    } catch (e) {
      console.log(`  ${C.warn('⚠')} آماده‌سازی ناموفق: ${e.message}`);
      console.log(`    ${C.dim('ساخت ادامه می‌یابد، ولی ممکن است bundler خودش دانلود کند.')}`);
    }
  }
}

console.log(`\n${C.bold(`▶ ۳/۳ ساخت نصب‌کننده${wantDebug ? ' (debug)' : ''}${wantOffline ? ' — آفلاین' : ''}`)}`);
console.log(`  ${C.dim('اولین ساخت ۳ تا ۱۰ دقیقه طول می‌کشد (کامپایل crateها).')}`);
code = await runTauriBuild(env);

if (code !== 0) {
  console.log(`\n${C.bad('⛔ ساخت نصب‌کننده ناموفق بود.')}`);
  /* تشخیص خودکار نوع خطا از نسخه‌ی باستان — کاربر لازم نباشد دنبال جدول بگردد */
  if (buildLogHas(/C1083|Cannot open include file/i)) {
    /* هدرهای ویندوز SDK در INCLUDE نیست — خطای واقعی دور پانزدهم */
    const inc = (msvcEnv().env.INCLUDE || '').split(';').filter(Boolean);
    const missingFile = (tauriLog.match(/Cannot open include file: '([^']+)'/) || [])[1] || '';
    console.log(`  ${C.bold('علت:')} هدرهای ویندوز SDK به کامپایلر نمی‌رسند${missingFile ? ` (${missingFile})` : ''}.`);
    console.log(`  ${C.dim('این خطا از LIB/INCLUDE می‌آید، نه از کد پروژه.')}`);
    console.log('');
    console.log(`  ${C.dim('INCLUDE فعلی:')}`);
    for (const d of inc) console.log(`    ${isFile(path.join(d, missingFile || 'windows.h')) ? C.ok('✔') : C.bad('✘')} ${d}`);
    console.log('');
    console.log(`  ${C.bold('قدم ۱ — تشخیص دقیق:')}  ${C.bold('npm run desktop:env')}`);
    console.log(`  ${C.bold('قدم ۲ — اگر «shared» یا «ucrt» نبود:')}`);
    console.log(`     Visual Studio Installer → Modify → تیک ${C.bold('«Windows 11 SDK')} (با Include، نه فقط Lib)`);
    console.log(`     ${C.dim('اگر SDK روی درایو دیگری است: set FD_SDK_ROOT=D:\\Windows Kits\\10')}`);
  } else if (buildLogHas(/link\.exe.*not found|msvc linker but .*link\.exe/i)) {
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
