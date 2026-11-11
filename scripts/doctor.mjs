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
import { findMsvc } from './lib/msvc.mjs';
import { projectRoot } from './lib/project-root.mjs';

const ok = (s) => console.log(`  ✔ ${s}`);
const bad = (s, fix) => { problems.push({ s, fix }); console.log(`  ✘ ${s}`); };
const warn = (s) => console.log(`  ⚠ ${s}`);
const problems = [];
const todos = [];

function run(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
}

/* مسیر پروژه از `scripts/lib/project-root.mjs` — نگاه کنید به توضیح همان فایل:
   الگوی `new URL(import.meta.url).pathname` روی ویندوز `C:\C:\...` می‌سازد. */
const root = projectRoot(import.meta.url, 1);
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
  console.log('\n— ۳) ابزارهای ساخت ویندوز (MSVC / link.exe) —');
  /*
   * منطق جست‌وجو در `scripts/lib/msvc.mjs` است (مشترک با build-desktop و
   * find-msvc) تا هر سه یک رفتار داشته باشند.
   *
   * تجربه‌ی واقعی دور سیزدهم: کاربر همه‌ی کامپوننت‌ها را نصب داشت ولی
   * نسخه‌ی قبلی فقط پوشه‌های `2019`/`2022` را می‌گشت و می‌گفت «پیدا نشد».
   */
  const msvc = findMsvc();
  if (msvc.found) {
    ok(`لینکر C++ (link.exe): MSVC ${msvc.msvcVersion || '?'}`);
    console.log(`     ${msvc.linkExe}`);
    console.log(`     ${msvc.source}${msvc.how ? ' · ' + msvc.how : ''}`);
    if (!msvc.vcvars) warn('vcvars64.bat پیدا نشد — LIB/INCLUDE دستی ساخته می‌شود');
    if (msvc.sdkVersion) ok(`Windows SDK: ${msvc.sdkVersion}`);
    else warn('Windows SDK پیدا نشد — «Windows 11 SDK» را در Build Tools تیک بزنید (وگرنه LNK1104)');
  } else if (msvc.sawVisualStudio || msvc.instances.length) {
    bad('نصب Visual Studio/ Build Tools دیده شد ولی link.exe در مسیرهای بررسی‌شده پیدا نشد',
      'npm run find:msvc را بزنید — مسیرهای بررسی‌شده و راه‌حل دقیق را چاپ می‌کند (ممکن است فقط نیاز به set FD_MSVC_ROOT باشد)');
    for (const c of msvc.checked.slice(0, 5)) console.log(`     بررسی شد: ${c.path} — ${c.why}`);
  } else {
    bad('لینکر C++ (link.exe) نصب نیست — ساخت با خطای «linker link.exe not found» می‌شکند',
      'Visual Studio Build Tools از https://visualstudio.microsoft.com/visual-cpp-build-tools/ با تیک «Desktop development with C++» — یا: winget install Microsoft.VisualStudio.2022.BuildTools');
  }
  console.log('\n— ۴) WebView2 —');
  const wv = run('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv');
  if (wv.includes('pv')) ok('WebView2 Runtime نصب است');
  else warn('WebView2 پیدا نشد — ویندوز ۱۰/۱۱ معمولاً دارد؛ اگر نبود از لینک مایکروسافت نصب کنید');
} else {
  console.log('\n— ۳) بسته‌های سیستمی لینوکس —');
  warn('برای لینوکس: libwebkit2gtk-4.1-dev، build-essential، libssl-dev، libayatana-appindicator3-dev، librsvg2-dev');
}

console.log('\n— ۵) بسته‌های پروژه —');
/*
 * ⚠ باگ «npm install اجرا نشده» با وجود نصب کامل.
 *
 * کد قبلی فقط `node_modules` ریشه را نگاه می‌کرد. روی ویندوز (و با
 * npm workspaces) بسته‌ها گاهی داخل `apps/api/node_modules` و
 * `apps/web/node_modules` می‌نشینند و ریشه فقط پوشه‌ی خالی/جزئی دارد. نتیجه:
 * doctor می‌گفت «نصب نشده» و کاربر بی‌دلیل `npm install` را تکرار می‌کرد.
 *
 * حالا هر سه جا بررسی می‌شود و پیام هم می‌گوید **کجا** پیدا شد.
 */
const nmRoots = [
  path.join(root, 'node_modules'),
  path.join(root, 'apps', 'api', 'node_modules'),
  path.join(root, 'apps', 'web', 'node_modules'),
];
const hasPkg = (rel) => nmRoots.some((d) => fs.existsSync(path.join(d, rel, 'package.json')));
const missingPkgs = [
  ['@nestjs/core', '@nestjs/core'],
  ['vite', 'vite'],
  ['react', 'react'],
  [path.join('@prisma', 'client'), '@prisma/client'],
].filter(([rel]) => !hasPkg(rel)).map(([, name]) => name);

/*
 * نشانه‌ی «نصب واقعی»: وجود پکیج‌ها، **یا** وجود `node_modules/.package-lock.json`
 * که npm بعد از هر نصب موفق می‌نویسد (حتی وقتی همه‌چیز hoist شده).
 */
const lockInstalled = nmRoots.some((d) => fs.existsSync(path.join(d, '.package-lock.json')));

if (missingPkgs.length === 0 || (lockInstalled && missingPkgs.length === 0)) {
  ok('بسته‌های پروژه نصب است (api + web + vite + prisma)');
} else if (missingPkgs.length === 0) {
  ok('بسته‌های پروژه نصب است');
} else if (missingPkgs.length < 4 && lockInstalled) {
  warn(`نصب هست ولی چند بسته پیدا نشد (${missingPkgs.join(', ')}) — اگر ساخت خطا داد: npm install`);
} else {
  bad(`بسته‌های پروژه ناقص است (${missingPkgs.join(', ')} پیدا نشد)`,
    'در پوشه پروژه: npm install   — یا: npm run setup');
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
  const confFile = path.join(root, 'src-tauri', 'tauri.conf.json');
  try {
    if (!fs.existsSync(confFile)) {
      /*
       * پیام باید بگوید **کجا** را نگاه کرده است، نه «ENOENT» خالی.
       * (باگ مسیر ویندوزی همین‌جا خودش را نشان می‌داد: C:\C:\Users\…)
       */
      throw new Error(`فایل پیدا نشد: ${confFile}\n     پوشه‌ی پروژه: ${root}`);
    }
    const conf = JSON.parse(fs.readFileSync(confFile, 'utf8'));
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
    bad('tauri.conf.json خوانده نشد', `${e.message}\n  اگر مطمئنید فایل هست: در پوشه‌ی پروژه دستور را اجرا کنید (نه از پوشه‌ی دیگر)، و npm run setup را بزنید.`);
  }
} else {
  warn('ساخت نصب‌کننده NSIS فقط روی ویندوز انجام می‌شود');
}

console.log('\n— ۹) موتور دیتابیس در بسته نصبی —');
/*
 * «موتور دیتابیس — missing (@libsql/win32-x64-msvc)» روی ویندوزِ کاربر.
 *
 * چرا این‌جا هم بررسی می‌شود: دو باگ قبلی هر دو در «زمان اجرا» ظاهر می‌شدند
 * و هیچ‌کدام در زمان ساخت دیده نمی‌شد:
 *   ۱) مسیر جست‌وجو (`__dirname/../../node_modules`) در بسته اشتباه بود؛
 *   ۲) اگر باینری ویندوزی جا می‌افتاد، فقط روی ویندوز معلوم می‌شد.
 * اکنون doctor دقیقاً همان چیزی را می‌سنجد که برنامه در زمان اجرا می‌بیند:
 * فایل `<src-tauri/api>/node_modules/@libsql/win32-x64-msvc/index.node`
 * و همچنین مسیری که `sqlite-engine` واقعاً استفاده می‌کند.
 */
{
  const apiBundle = path.join(root, 'src-tauri', 'api');
  const winBin = path.join(apiBundle, 'node_modules', '@libsql', 'win32-x64-msvc', 'index.node');
  if (!fs.existsSync(apiBundle)) {
    warn('بسته‌ی API ساخته نشده — بررسی موتور دیتابیس انجام نشد (npm run package:api)');
  } else if (fs.existsSync(winBin)) {
    const mb = (fs.statSync(winBin).size / (1024 * 1024)).toFixed(1);
    ok(`باینری ویندوزی موتور دیتابیس داخل بسته هست (${mb} MB)`);
  } else {
    /*
     * اگر این‌جا نباشد، نصب‌کننده روی ویندوز بالا نمی‌آید. پیام باید بگوید
     * *کدام* فایل و *چگونه* بسازد — نه یک «missing» خشک.
     */
    bad('باینری ویندوزی موتور دیتابیس در بسته نیست (@libsql/win32-x64-msvc)',
      `npm run package:api   ← خودش دانلود/کاپی می‌کند\n     مسیر مورد انتظار: ${path.relative(root, winBin)}`);
  }

  /* همان تابعی که برنامه در زمان اجرا صدا می‌زند — بدون راه‌اندازی سرور */
  const engineFile = path.join(root, 'apps', 'api', 'dist', 'common', 'sqlite-engine.js');
  if (fs.existsSync(engineFile)) {
    try {
      const { ensureSqliteEngine } = await import(engineFile);
      const st = ensureSqliteEngine();
      if (st.ok) ok(`موتور دیتابیس روی همین سیستم بارگذاری می‌شود (${st.package})`);
      else {
        bad(`موتور دیتابیس روی همین سیستم بارگذاری نشد (${st.package})`,
          `${st.detail}\n     بررسی‌شده: ${st.checked.slice(0, 3).join(' , ')}`);
      }
    } catch (e) {
      warn(`بارگذاری آزمون موتور دیتابیس انجام نشد: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    warn('apps/api/dist نیست — آزمون بارگذاری موتور دیتابیس انجام نشد (npm run build)');
  }
}

console.log('\n— ۱۰) ابزار Tauri CLI —');
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
