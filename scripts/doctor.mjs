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
if (major >= 20) ok(`Node ${process.version}`);
else bad(`Node ${process.version} خیلی قدیمی است`, 'Node 22 LTS را از nodejs.org نصب کنید');

console.log('\n— ۲) Rust و Cargo —');
const rustc = run('rustc --version');
const cargo = run('cargo --version');
if (rustc) ok(rustc); else bad('Rust نصب نیست', 'از https://rustup.rs نصب کنید (یا: winget install Rustlang.Rustup)');
if (cargo) ok(cargo);

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
if (fs.existsSync(path.join(root, 'node_modules'))) ok('node_modules موجود است');
else bad('npm install اجرا نشده', 'در پوشه پروژه: npm install');

console.log('\n— ۶) ساخته‌های API و رابط —');
if (fs.existsSync(path.join(root, 'apps/api/dist/main.js'))) ok('API ساخته شده (apps/api/dist)');
else warn('API ساخته نشده — npm run build -w @farday/api');
if (fs.existsSync(path.join(root, 'apps/web/dist/index.html'))) ok('رابط ساخته شده (apps/web/dist)');
else warn('رابط ساخته نشده — npm run build -w @farday/web');

console.log('\n— ۷) بسته نصبی (src-tauri/api) —');
const pkg = path.join(root, 'src-tauri/api/app.js');
if (fs.existsSync(pkg)) ok('بسته API آماده است');
else warn('آماده نشده — npm run package:api (قبل از desktop:build)');
if (isWin && !fs.existsSync(path.join(root, 'src-tauri/api/node.exe'))) {
  warn('node.exe کاپی نشده — برای نصب‌کننده‌ای که به Node نیاز ندارد: npm run package:api');
}

console.log('\n— ۸) ابزار Tauri CLI —');
const cli = run('npx --no-install tauri --version') || run('npx --no-install @tauri-apps/cli --version');
if (cli) ok(cli);
else warn('نصب نشده — یک بار: npm run desktop:setup');

console.log('');
if (problems.length === 0) {
  console.log('✅ همه چیز برای ساخت نسخه دسکتاپ آماده است.\n   مرحله بعد:  npm run desktop:build\n');
} else {
  console.log(`⛔ ${problems.length} مورد باید درست شود:\n`);
  for (const p of problems) console.log(`• ${p.s}\n  راه‌حل: ${p.fix}\n`);
  console.log('بعد از رفع، دوباره: npm run doctor\n');
}
