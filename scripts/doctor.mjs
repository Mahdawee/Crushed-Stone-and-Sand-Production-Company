/**
 * بررسی پیش‌نیازهای ساخت نسخه دسکتاپ (Tauri)
 *
 *   npm run doctor
 *
 * هر مورد را با پیام دری و راه‌حل نشان می‌دهد. خطا نمی‌دهد (exit 0) مگر
 * که واقعاً چیزی برای ساخت کم باشد.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ok = (s) => console.log(`  ✔ ${s}`);
const bad = (s, fix) => { problems.push({ s, fix }); console.log(`  ✘ ${s}`); };
const warn = (s) => console.log(`  ⚠ ${s}`);
const problems = [];
const todos = [];

function run(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const isWin = process.platform === 'win32';

console.log('\n=== بررسی محیط ===\n');
console.log(`  سیستم: ${os.platform()} ${process.arch} — نود ${process.version}`);

console.log('\n— ۱) Node.js —');
const [major] = process.versions.node.split('.').map(Number);
if (major >= 20) ok(`Node ${process.version} (کافی است — ۲۲ یا بالاتر)`);
else bad(`Node ${process.version} خیلی قدیمی است`, 'Node 22 LTS را از nodejs.org نصب کنید');

/* «npm doctor» پیشنهاد می‌کند آخرین نسخه npm/node را نصب کنید؛ برای این پروژه لازم نیست */
console.log('  ℹ اگر npm doctor نسخه نود/npm تازه‌تری پیشنهاد داد، نادیده بگیرید — این پروژه با Node 22 کار می‌کند.');

console.log('\n— ۲) Rust و Cargo —');
const rustc = run('rustc --version');
const cargo = run('cargo --version');

/*
 * حالت سوم (که پیام گمراه‌کننده‌ی «program not found» از آن می‌آید):
 * Rust نصب است و فایل cargo.exe روی دیسک هست، ولی مسیرش در PATH این
 * ترمینال نیست — چون ترمینال پیش از نصب باز شده بود. اینجا همان را
 * تشخیص می‌دهیم و راه حل دقیق می‌دهیم.
 */
const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();
const cargoBinDir = path.join(process.env.CARGO_HOME || path.join(homeDir, '.cargo'), 'bin');
const cargoExe = path.join(cargoBinDir, isWin ? 'cargo.exe' : 'cargo');
let cargoOnDisk = false;
try { cargoOnDisk = fs.statSync(cargoExe).isFile(); } catch { cargoOnDisk = false; }

if (rustc) ok(rustc);
else if (cargoOnDisk) {
  bad(`${cargoExe} هست ولی «cargo» در PATH نیست — ساخت با خطای «program not found» شکست می‌خورد`,
    isWin
      ? `ترمینال را ببندید و باز کنید؛ یا موقتاً: set PATH=%USERPROFILE%\\.cargo\\bin;%PATH%  — یا فقط npm run build:desktop را بزنید (خودش PATH را درست می‌کند)`
      : `export PATH="$HOME/.cargo/bin:$PATH"  — یا فقط npm run build:desktop را بزنید`);
} else {
  bad('Rust نصب نیست', 'از https://rustup.rs نصب کنید (یا: winget install Rustlang.Rustup) — یا فایل scripts/install-rust.ps1 را اجرا کنید');
}

if (cargo) ok(cargo);
else if (cargoOnDisk) {
  /* پیام دقیق: همین حالت منشأ خطای cargo metadata است */
  warn(`cargo در ${cargoBinDir} نصب است ولی این پنجره‌ی ترمینال آن را نمی‌بیند`);
  console.log(`     راه حل فوری: ترمینال را ببندید و دوباره باز کنید.`);
  if (isWin) console.log(`     یا همین حالا:  set PATH=%USERPROFILE%\\.cargo\\bin;%PATH%`);
  console.log(`     یا از اسکریپت استفاده کنید که PATH را خودش اصلاح می‌کند:  npm run build:desktop`);
} else if (rustc) {
  warn('rustc هست ولی cargo پیدا نشد — نصب Rust نیمه‌کاره است؛ rustup را دوباره اجرا کنید');
}

if (isWin) {
  console.log('\n— ۳) ابزارهای ساخت ویندوز (MSVC) —');
  const vs = run('"C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath');
  if (vs) ok(`Visual Studio Build Tools: ${vs.split('\n')[0]}`);
  else bad('C++ Build Tools نصب نیست', 'Visual Studio Build Tools + «Desktop development with C++» را نصب کنید');

  console.log('\n— ۴) WebView2 —');
  const wv = run('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv');
  if (wv.includes('pv')) ok('WebView2 Runtime نصب است');
  else warn('WebView2 پیدا نشد — ویندوز ۱۰/۱۱ معمولاً دارد؛ اگر نبود از لینک مایکروسافت نصب کنید');
} else {
  console.log('\n— ۳) بسته‌های سیستمی لینوکس —');
  warn('برای لینوکس: libwebkit2gtk-4.1-dev، build-essential، libssl-dev، libayatana-appindicator3-dev، librsvg2-dev');
}

console.log('\n— ۵) بسته‌های پروژه —');
// npm workspaces hoist to the root, but a missing workspace folder is the real signal.
const nmRoot = path.join(root, 'node_modules');
const have = (rel) => fs.existsSync(path.join(nmRoot, rel));
const rootDeps = fs.existsSync(path.join(root, 'package-lock.json'));
if (fs.existsSync(nmRoot) && have('@nestjs/core') && have('vite')) {
  ok('node_modules نصب است (api + web)');
} else if (fs.existsSync(nmRoot)) {
  const missing = [!have('@nestjs/core') && '@nestjs/core', !have('vite') && 'vite'].filter(Boolean);
  bad(`بسته‌های پروژه ناقص است (${missing.join(', ')} پیدا نشد)`, 'در پوشه پروژه: npm install');
} else if (fs.existsSync(path.join(root, 'apps/api/node_modules')) && fs.existsSync(path.join(root, 'apps/web/node_modules'))) {
  /* ویندوز/workspaces گاهی به‌جای hoist کردن، داخل هر پکیج نصب می‌کند */
  ok('بسته‌ها داخل apps/api و apps/web نصب شده‌اند');
} else {
  bad('npm install اجرا نشده (یا ناقص است)', 'در پوشه پروژه: npm install   — یا: npm run setup');
}

console.log('\n— ۶) ساخته‌های API و رابط —');
const apiBuilt = fs.existsSync(path.join(root, 'apps/api/dist/main.js'));
const webBuilt = fs.existsSync(path.join(root, 'apps/web/dist/index.html'));
if (apiBuilt) ok('API ساخته شده (apps/api/dist)');
else warn('API ساخته نشده — npm run build');
if (webBuilt) ok('رابط ساخته شده (apps/web/dist)');
else warn('رابط ساخته نشده — npm run build');
if (!apiBuilt || !webBuilt) todos.push('npm run build');

console.log('\n— ۷) بسته نصبی (src-tauri/api) —');
const pkg = path.join(root, 'src-tauri/api/app.js');
const binDir = path.join(root, 'src-tauri', 'binaries');
if (fs.existsSync(pkg)) ok('بسته API آماده است');
else warn('آماده نشده — npm run desktop:build این را خودکار می‌سازد');
if (!fs.existsSync(binDir)) {
  warn('پوشه src-tauri/binaries نیست (tauri.conf آن را منبع اعلام کرده) — npm run package:api می‌سازد');
  todos.push('npm run package:api');
}
if (isWin && fs.existsSync(pkg) && !fs.existsSync(path.join(root, 'src-tauri/api/node.exe'))) {
  warn('node.exe داخل بسته نیست — کمپیوتر مقصد باید Node.js داشته باشد (package:api با انترنت آن را دانلود می‌کند)');
}

console.log('\n— ۸) تنظیمات نصب‌کننده ویندوز (NSIS) —');
/* این بررسی از خطای واقعیِ ساخت نصب‌کننده می‌آید:
   «Can't open language file - ...\Persian.nlf» — یعنی نام زبان در
   tauri.conf.json با نام فایل زبانِ NSIS یکی نبود. */
if (isWin) {
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    const nsis = conf?.bundle?.windows?.nsis || {};
    const langs = nsis.languages || ['English'];
    /* NSIS زبان فارسی را «Farsi» می‌شناسد؛ «Persian» فایل .nlf ندارد */
    const badNames = langs.filter((l) => /^persian$/i.test(l));
    if (badNames.length) {
      bad(`نام زبان «${badNames.join(', ')}» در NSIS وجود ندارد`,
        'در src-tauri/tauri.conf.json مقدار languages را از Persian به Farsi تغییر دهید (Contrib\\Language files\\Farsi.nlf)');
    } else {
      ok(`زبان‌های نصب‌کننده: ${langs.join(', ')}`);
    }
    for (const [lang, rel] of Object.entries(nsis.customLanguageFiles || {})) {
      const abs = path.resolve(root, 'src-tauri', rel);
      if (fs.existsSync(abs)) ok(`پیام‌های فارسی ${rel} موجود است`);
      else bad(`فایل پیام زبان «${lang}» پیدا نشد (${rel})`, 'npm run setup را اجرا کنید یا فایل را از مخزن بگیرید');
    }
    if (langs.some((l) => /^farsi$/i.test(l)) && !(nsis.customLanguageFiles || {}).Farsi && !(nsis.customLanguageFiles || {}).farsi) {
      warn('برای Farsi فایل پیام سفارشی تعریف نشده — متن دکمه‌های نصب‌کننده انگلیسی می‌ماند (ساخت موفق است)');
    }
  } catch (e) {
    bad('tauri.conf.json خوانده نشد', e.message);
  }
} else {
  warn('ساخت نصب‌کننده NSIS فقط روی ویندوز انجام می‌شود');
}

console.log('\n— ۹) ابزار Tauri CLI —');
const cli = run('npx --no-install tauri --version') || run('npx --no-install @tauri-apps/cli --version');
if (cli) ok(cli);
else { warn('نصب نشده — یک بار: npm run desktop:setup'); todos.push('npm run desktop:setup'); }

console.log('');
if (problems.length === 0) {
  if (todos.length) {
    console.log('✅ پیش‌نیازهای سیستمی کامل است. چند قدم آماده‌سازی باقی مانده (به ترتیب):\n');
    [...new Set(todos)].forEach((t, i) => console.log(`   ${i + 1}) ${t}`));
    console.log('\n   بعد:  npm run desktop:build\n');
  } else {
    console.log('✅ همه چیز برای ساخت نسخه دسکتاپ آماده است.\n   مرحله بعد:  npm run desktop:build\n');
  }
} else {
  console.log(`⛔ ${problems.length} مورد باید درست شود:\n`);
  for (const p of problems) console.log(`• ${p.s}\n  راه‌حل: ${p.fix}\n`);
  console.log('بعد از رفع، دوباره: npm run doctor\n');
}
