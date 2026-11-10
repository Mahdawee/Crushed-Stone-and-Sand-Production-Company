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
import { spawnSync } from 'node:child_process';
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

/** cargo در PATH؟ */
function cargoFromPath() {
  const dirs = (process.env.PATH || '').split(isWin ? ';' : ':').filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, cargoExeName);
    if (isFile(p)) return p;
  }
  return '';
}

const cargoInPath = cargoFromPath();
const cargoOnDisk = cargoCandidates().find(isFile) || '';
const cargoPath = cargoInPath || cargoOnDisk;

/** آیا در PATH جست‌وجو کنیم یا مسیر مطلق بدهیم؟ */
const cargoCmd = cargoPath || 'cargo';

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
    /* linker (link.exe) گاهی فقط داخل Build Tools است، نه در PATH */
    const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
    if (isFile(vswhere)) {
      const r = spawnSync(vswhere, ['-latest', '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath'], { encoding: 'utf8' });
      const vsPath = (r.stdout || '').split(/\r?\n/)[0].trim();
      if (vsPath) {
        /* نسخه‌ی MSVC را از روی پوشه پیدا می‌کنیم (به‌جای حدس زدن) */
        try {
          const msvcRoot = path.join(vsPath, 'VC', 'Tools', 'MSVC');
          const ver = fs.readdirSync(msvcRoot).sort().pop();
          if (ver) prepend.push(path.join(msvcRoot, ver, 'bin', 'Hostx64', 'x64'));
        } catch { /* MSVC نصب نیست */ }
      }
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

/**
 * اجرای Tauri CLI از نصب محلی.
 *
 * مهم: `npx --no-install` — بدون این پرچم، npx ممکن است بخواهد بسته را از
 * شبکه بگیرد؛ روی کمپیوتر آفلاین همان باعث خطای گمراه‌کننده می‌شود.
 */
function runTauriBuild(env) {
  const cliJs = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const tauriArgs = ['build'];
  if (wantDebug) tauriArgs.push('--debug');
  if (wantOffline) tauriArgs.push('--', '--offline');

  if (isFile(cliJs)) {
    /* مستقیم با node — نه npx، نه shell؛ هیچ امکان دانلود/شکنندگی نقل‌قول */
    console.log(`  ${C.dim(`اجرا: node node_modules/@tauri-apps/cli/tauri.js ${tauriArgs.join(' ')}`)}`);
    const r = spawnSync(process.execPath, [cliJs, ...tauriArgs], {
      cwd: root, stdio: 'inherit', env,
    });
    return r.status ?? 1;
  }
  /* نسخه‌ی قدیمی نصب: همان npx با --no-install */
  console.log(`  ${C.warn('⚠ نصب محلی Tauri CLI پیدا نشد — با npx --no-install تلاش می‌شود')}`);
  const r = spawnSync('npx', ['--no-install', 'tauri', ...tauriArgs], {
    cwd: root, stdio: 'inherit', env, shell: isWin,
  });
  return r.status ?? 1;
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
code = runTauriBuild(env);

if (code !== 0) {
  console.log(`\n${C.bad('⛔ ساخت نصب‌کننده ناموفق بود.')}`);
  console.log(`  ${C.bold('راهنمای خطاهای رایج:')} docs/TAURI-BUILD.md — بخش ۱۰`);
  console.log(`  ${C.dim('اگر پیام cargo بود، متن انگلیسی خطا را نگه دارید؛ اکثر آن‌ها در همان جدول آمده‌اند.')}\n`);
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
