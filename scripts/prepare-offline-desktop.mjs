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
  /* کاربر اغلب مسیر را داخل کوتیشن می‌گذارد («"D:\node.zip"») — کوتیشن‌ها پاک می‌شوند */
  const trimmed = zip.replace(/^["']|["']$/g, '');
  if (fs.existsSync(trimmed)) zip = trimmed;
  else {
    console.error(`⛔ فایل ZIP پیدا نشد: ${zip}`);
    console.error(`   مسیر را بدون کوتیشن زیاده بدهید، مثلاً:`);
    console.error(`     npm run desktop:build:offline -- "D:\\${zipName}"`);
    process.exit(1);
  }
}
if (zip && fs.statSync(zip).size < 5_000_000) {
  console.error(`⛔ فایل ZIP خراب/ناقص است (${Math.round(fs.statSync(zip).size / 1024)} کیلوبایت).`);
  process.exit(1);
}

if (!zip && fs.existsSync(cachedZip)) {
  zip = cachedZip;
  console.log(`ℹ استفاده از ZIP ذخیره‌شده: ${cachedZip}`);
}

const run = (cmd, args, env) =>
  spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: env || process.env });

/**
 * اجرای دستور با مسیرهای دارای فاصله و بدون shell.
 *
 * درس گرفته‌شده: روی ویندوز وقتی `shell: true` باشد، مسیرهایی مثل
 * `C:\Users\My Name\node-v22-win-x64.zip` بدون کوتیشن به هم می‌چسبند و
 * دستور با «file not found» عجیب شکست می‌خورد. پس `node` را با
 * `process.execPath` و بدون shell صدا می‌زنیم.
 */
const runNode = (args, env) =>
  spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: env || process.env });

/**
 * مسیرهای متداول Rust/Cargo را به PATH اضافه می‌کند.
 *
 * باگ گزارش‌شده: «failed to run 'cargo metadata' … program not found» در
 * حالی که Rust نصب بود. علت: rustup در PATH فعلی نبود (نصب تازه، ترمینال
 * قدیمی، یا PATH عوض‌نشده). اینجا صریحاً `%USERPROFILE%\.cargo\bin` را
 * جلو می‌گذاریم.
 */
function rustEnv({ offline = false } = {}) {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const extras = [
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.rustup', 'toolchains'),
    process.env.CARGO_HOME ? path.join(process.env.CARGO_HOME, 'bin') : '',
  ].filter(Boolean);
  const sep = process.platform === 'win32' ? ';' : ':';
  const pathParts = [...extras, process.env.PATH || ''].filter(Boolean);
  const env = { ...process.env, PATH: pathParts.join(sep) };
  if (offline) {
    env.CARGO_NET_OFFLINE = 'true';
    env.npm_config_offline = 'true';
  }
  return env;
}

/** آیا cargo واقعاً قابل اجراست؟ */
function cargoAvailable(env) {
  const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8', env: env || rustEnv() });
  return probe.status === 0;
}

/** آیا کریت‌ها قبلاً دانلود شده‌اند (پیش‌شرط ساخت آفلاین)؟ */
function cargoRegistryReady() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const cargoHome = process.env.CARGO_HOME || path.join(home, '.cargo');
  try {
    return fs.readdirSync(path.join(cargoHome, 'registry', 'cache')).length > 0;
  } catch { return false; }
}

function printRustHelp() {
  console.error('\n⛔ cargo پیدا نشد — همین خطا در tauri build به شکل');
  console.error('   «failed to run \'cargo metadata\' … program not found» ظاهر می‌شود.');
  console.error('   یعنی Rust نصب نیست، یا نصب است ولی PATH این پنجره آن را نمی‌بیند.');
  if (process.platform === 'win32') {
    console.error('   • نصب از صفر:  winget install --id Rustlang.Rustup -e');
    console.error('   • یا فایل scripts\\install-rust.ps1 را راست‌کلیک → Run with PowerShell');
    console.error('   • اگر Rust نصب است: ترمینال را ببندید و باز کنید');
    console.error('     یا:  set PATH=%USERPROFILE%\\.cargo\\bin;%PATH%');
  } else {
    console.error('   • نصب:  curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh');
  }
  console.error('');
}

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

/*
 * پیش از هر کاری cargo را چک می‌کنیم — اگر نبود، به‌جای شکستِ مبهم در
 * وسط ساخت (بعد از چند دقیقه کامپایل)، همان اول راه‌حل می‌دهیم.
 */
const envOnline = rustEnv();
if (!cargoAvailable(envOnline)) {
  printRustHelp();
  process.exit(1);
}

/*
 * آفلاین بودن را از نبودِ رجیستری کریت‌ها تشخیص نمی‌دهیم (شاید اولین ساخت
 * آفلاین باشد ولی رجیستری پر باشد). به‌جایش: اگر رجیستری خالی است، ساخت با
 * `--offline` شکست می‌خورد؛ پس یک بار بدون `--offline` تلاش می‌کنیم که
 * cargo خودش بگوید چه کم است.
 */
const registryReady = cargoRegistryReady();
const offline = registryReady || process.argv.includes('--offline');
const env = rustEnv({ offline });

if (offline) {
  console.log('ℹ حالت آفلاین: cargo از کریت‌های ذخیره‌شده استفاده می‌کند (CARGO_NET_OFFLINE=true).');
} else {
  console.log('ℹ رجیستری کریت‌ها خالی است — اولین ساخت به انترنت نیاز دارد (یک بار).');
  console.log('  برای آماده‌سازی:  npm run desktop:prefetch');
}

console.log(`\n▶ 1/4 ساخت API و رابط کاربری…`);
let r = run('npm', ['run', 'build:desktop'], env);
if (r.status !== 0) { console.error('\n⛔ ساخت API/رابط ناموفق بود.'); process.exit(r.status ?? 1); }

console.log(`\n▶ 2/4 بسته‌بندی API + node.exe از ZIP محلی…`);
r = runNode(['scripts/build-desktop-api.mjs', '--require-node', '--node-zip', zip], env);
if (r.status !== 0) {
  console.error('\n⛔ بسته‌بندی API ناموفق بود.');
  console.error(`   ZIP: ${zip}`);
  process.exit(r.status ?? 1);
}

/* وجود node.exe در بسته شرط «نصب بدون هیچ پیش‌نیاز» است */
const nodeInBundle = path.join(root, 'src-tauri', 'api', 'node.exe');
if (!fs.existsSync(nodeInBundle)) {
  console.error('\n⛔ node.exe در بسته‌ی API قرار نگرفت — نصب‌کننده روی کمپیوتر مقصد Node.js می‌خواست.');
  console.error(`   ZIP داده‌شده: ${zip}`);
  process.exit(1);
}
console.log(`✔ node.exe داخل بسته است (${Math.round(fs.statSync(nodeInBundle).size / 1024 / 1024)} مگابایت) — نصب‌کننده مستقل است.`);

console.log(`\n▶ 3/4 بررسی قفل وابستگی‌ها…`);
/* Cargo.lock اگر نباشد، cargo در حالت آفلاین نمی‌تواند نسخه‌ها را حل کند */
const lock = path.join(root, 'src-tauri', 'Cargo.lock');
if (!fs.existsSync(lock) && offline) {
  console.error('\n⛔ فایل src-tauri\\Cargo.lock نیست و حالت آفلاین است.');
  console.error('   یک بار با انترنت:  npm run desktop:prefetch');
  process.exit(1);
}
console.log(`✔ ${fs.existsSync(lock) ? 'Cargo.lock موجود است' : 'Cargo.lock نبود (اولین ساخت، آنلاین)'}`);

console.log(`\n▶ 4/4 ساخت نصب‌کننده (tauri build${offline ? ' — آفلاین' : ''})…`);
/*
 * `npx tauri` بدون `--no-install` می‌تواند بخواهد بسته را از npm بگیرد و روی
 * کمپیوتر بدون انترنت با «program not found» یا خطای شبکه بترکد. اینجا صریحاً
 * از نصب محلی استفاده می‌کنیم و در PATH مسیر cargo/rustup را هم می‌گذاریم —
 * چون نصب‌کننده‌ی rustup گاهی PATH را در همین نشست عوض نمی‌کند و خطای
 * «cargo program not found» می‌دهد.
 */
r = spawnSync('npx', ['--no-install', 'tauri', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
if (r.status !== 0) {
  console.error('\n⛔ ساخت نصب‌کننده ناموفق بود.');
  if (offline) {
    console.error('   در حالت آفلاین، اگر کریتی کم بود پیام cargo می‌گوید کدام است.');
    console.error('   یک بار با انترنت بزنید:  npm run desktop:prefetch');
  } else {
    console.error('   اگر خطای cargo مربوط به شبکه بود، انترنت را بررسی کنید یا فایل');
    console.error('   docs/TAURI-BUILD.md بخش «ساخت آفلاین» را ببینید.');
  }
  process.exit(r.status ?? 1);
}

console.log('\n✔ نصب‌کننده ساخته شد:');
const outDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle');
for (const kind of ['nsis', 'msi']) {
  try {
    for (const f of fs.readdirSync(path.join(outDir, kind))) {
      console.log(`   ${path.join(outDir, kind, f)}`);
    }
  } catch { /* این نوع ساخته نشده */ }
}
console.log('   این فایل کاملاً مستقل است: Node.js و انترنت لازم ندارد.');
console.log(`\n   از این پس ساخت‌های بعدی هم آفلاین کار می‌کنند ` +
  `(کریت‌ها در ${process.env.CARGO_HOME || '~/.cargo'} ذخیره شده‌اند).\n`);
