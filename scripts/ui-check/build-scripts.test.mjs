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

const pkgJson = read('package.json');
const pkg = JSON.parse(pkgJson);
const scripts = pkg.scripts || {};
const build = read('scripts/build-desktop.mjs');
const off = read('scripts/prepare-offline-desktop.mjs');
const doctor = read('scripts/doctor.mjs');
const docs = read('docs/TAURI-BUILD.md');
const apiPack = read('scripts/build-desktop-api.mjs');
const ps1 = read('scripts/install-rust.ps1');
const msvcLib = read('scripts/lib/msvc.mjs');
const findMsvc = read('scripts/find-msvc.mjs');
const envScript = read('scripts/show-msvc-env.mjs');

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

console.log('\n— لینکر C++ (link.exe) — خطای واقعی کاربر —');
ok('خطای «linker link.exe not found» در توضیح اسکریپت آمده', /linker `link\.exe` not found|linker .link\.exe. not found/.test(build));
ok('پیام راهنمای اختصاصی لینکر وجود دارد', /function linkerHelp/.test(build));
ok('علت «VS هست ولی کامپوننت C++ ندارد» جدا تشخیص داده می‌شود', /vs-no-cpp/.test(build));
ok('به اینکه VS Code کافی نیست اشاره می‌شود', /VS Code کافی نیست/.test(build));
ok('لینک دانلود Build Tools داده می‌شود', /visual-cpp-build-tools/.test(build));
ok('نام کامپوننت دقیق گفته می‌شود', /Desktop development with C\+\+/.test(build));
ok('Windows SDK هم یادآوری می‌شود', /Windows 11 SDK|Windows 10 SDK/.test(build));
ok('نسخه MSVC از روی پوشه خوانده می‌شود (نه حدس)', /function newestMsvcVersion/.test(msvcLib) || /readdirSync\(msvcRoot\)/.test(msvcLib));
ok('link.exe واقعاً وجودش چک می‌شود', /Hostx64['"],\s*'x64['"],\s*'link\.exe'/.test(msvcLib));
ok('vcvars64.bat استفاده می‌شود (نه فقط PATH)', /vcvars64\.bat/.test(msvcLib) && /call "\$\{msvc\.vcvars\}"/.test(msvcLib));
ok('LIB و INCLUDE از vcvars برداشته می‌شود', /LIB\|INCLUDE/.test(msvcLib) && /env\.LIB = libs\.join/.test(msvcLib));
ok('vswhere با همه‌ی نصب‌ها صدا زده می‌شود', /'-all', '-products', '\*', '-format', 'json'/.test(msvcLib));
ok('اگر vswhere نبود، مسیرهای متداول گشته می‌شوند', /scanVsDirs/.test(msvcLib));
ok('مسیر دستی FD_MSVC_ROOT پشتیبانی می‌شود', /FD_MSVC_ROOT/.test(build));
ok('پیش‌بررسی لینکر قبل از شروع ساخت انجام می‌شود', /پیش‌بررسی لینکر/.test(build));
ok('خطای لینکر در خروجی ساخت خودکار تشخیص داده می‌شود', /msvc linker but/.test(build));
ok('خروجی ساخت برای تشخیص نگه داشته می‌شود', /function appendLog/.test(build) && /buildLogHas/.test(build));
ok('خروجی هم‌زمان چاپ و ذخیره می‌شود (تجربه کاربر عوض نشده)', /process\.stdout\.write\(b\)/.test(build));
ok('حجم بافر لاگ محدود است', /LOG_LIMIT/.test(build));
ok('راه «x64 Native Tools Command Prompt» هم گفته می‌شود', /Native Tools Command Prompt/.test(build));
ok('doctor وجود واقعی link.exe را می‌سنجد', /findMsvc\(\)/.test(doctor) && /Hostx64['"],\s*'x64['"],\s*'link\.exe'/.test(msvcLib));
ok('doctor حالت «VS بدون کامپوننت C++» را جدا می‌گوید', /sawVisualStudio \|\| msvc\.instances\.length/.test(doctor));
ok('doctor وجود Windows SDK را چک می‌کند', /sdkVersion/.test(doctor) && /Windows Kits/.test(msvcLib));
ok('doctor خطای لینکر را در راه‌حل ذکر می‌کند', /linker link\.exe not found/.test(doctor));

console.log('\n— کشف MSVC: چیدمان‌های غیر ۲۰۲۲ (درس دور سیزدهم) —');
/* کاربر همه‌ی کامپوننت‌ها را داشت ولی نسخه‌ی قبلی فقط …\\2019\\… و …\\2022\\… را می‌گشت */
ok('پوشه‌های VS دیگر هارد‌کد ۲۰۲۲/۲۰۱۹ نیستند', /scanVsDirs/.test(msvcLib) && !/Visual Studio\\\\2022\\\\BuildTools/.test(msvcLib));
ok('هر نام نسخه‌ای پیمایش می‌شود (نه فقط ۲۰۲۲)', /NOT_A_PRODUCT/.test(msvcLib) && /مثل نسخه/.test(msvcLib));
ok('vswhere با -all همه‌ی نصب‌ها را می‌گیرد (نه فقط -latest)', /'-all', '-products', '\*', '-format', 'json'/.test(msvcLib));
ok('vswhere -find برای پیدا کردن link.exe مستقل از چیدمان', /'-find', pat/.test(msvcLib) || /-find/.test(msvcLib));
ok('جست‌وجوی محدود (BFS) داخل نصب وجود دارد', /function searchFile/.test(msvcLib));
ok('اگر vcvars نبود، LIB/INCLUDE دستی ساخته می‌شود', /function manualEnv/.test(msvcLib));
ok('نتیجه فهرست «مسیرهای بررسی‌شده» را نگه می‌دارد', /checked: \[\]/.test(msvcLib) && /result\.checked\.push/.test(msvcLib));
ok('مسیر سفارشی با FD_MSVC_ROOT', /FD_MSVC_ROOT/.test(msvcLib));
ok('ریشه‌ی VS قابل تغییر با FD_VS_BASE', /FD_VS_BASE/.test(msvcLib));
ok('build-desktop از ماژول مشترک استفاده می‌کند (نه کد تکراری)', /from '\.\/lib\/msvc\.mjs'/.test(build));
ok('doctor از ماژول مشترک استفاده می‌کند', /from '\.\/lib\/msvc\.mjs'/.test(doctor));
ok('دستور عیب‌یابی npm run find:msvc وجود دارد', /find-msvc\.mjs/.test(scripts['find:msvc'] || ''));
ok('مسیر نسخه‌های MSVC عددی مقایسه می‌شوند (۱۴٫۹ < ۱۴٫۴۴)', /function newerVersion/.test(msvcLib) && /Number\(v\) \|\| 0/.test(msvcLib));
ok('پیام «پیدا نشد» مسیرهای بررسی‌شده را چاپ می‌کند', /مسیرهایی که بررسی شد/.test(build));
ok('پیام «پیدا نشد» دیگر ادعای قطعی «کامپوننت ندارد» نمی‌کند', /این لزوماً یعنی نصب ناقص نیست/.test(build));
ok('find-msvc پنج بخش تشخیص دارد', /۱\) آیا link\.exe در PATH/.test(findMsvc) && /۵\) Windows SDK/.test(findMsvc));
ok('find-msvc دستور FD_MSVC_ROOT را آماده چاپ می‌کند', /set FD_MSVC_ROOT=/.test(findMsvc));

console.log('\n— سه باگ واقعی از گزارش کاربر (VS 2026 / دو نسخه MSVC / HostX64) —');
/* گزارش واقعی: …\\Microsoft Visual Studio\\18\\BuildTools با
   MSVC 14.51.36231 (بدون link.exe) و 14.44.35207 (سالم) */
ok('اولین نسخه‌ی MSVC که link.exe دارد انتخاب می‌شود (نه صرفاً جدیدترین)', /function pickMsvc/.test(msvcLib));
ok('نسخه‌های بدون link.exe رد می‌شوند و بعدی امتحان می‌شود', /for \(const ver of msvcVersions\(root\)\)/.test(msvcLib));
ok('نام پوشه بدون حساسیت به حرف بزرگ/کوچک حل می‌شود (HostX64)', /function resolveCi/.test(msvcLib));
ok('Hostx64/HostX64 هارد‌کد نشده (resolveCi استفاده می‌شود)', /resolveCi\(path\.join\(msvcRoot, ver\), 'bin', 'Hostx64', 'x64', 'link\.exe'\)/.test(msvcLib));
ok('vcvarsall.bat هم پذیرفته می‌شود (نه فقط vcvars64)', /function findVcvars/.test(msvcLib) && /vcvarsall\.bat/.test(msvcLib));
ok('vcvarsall با آرگومان x64 اجرا می‌شود', /isAll \? ' x64' : ''/.test(msvcLib));
ok('پوشه‌های Installer/Shared به‌عنوان نصب VS حساب نمی‌شوند', /NOT_A_PRODUCT/.test(msvcLib) && /installer\|shared/.test(msvcLib));
ok('فقط پوشه‌های عددی (18 / 2022) به‌عنوان نسخه پیمایش می‌شوند',
  /if \(!\/\^\\d\+\(\\\.\\d\+\)\*\$\/\.test\(v\)\) continue;/.test(msvcLib));
ok('گزارش per-version می‌گوید «این نسخه link.exe ندارد» نه «کامپوننت نصب نشده»', /link\.exe ندارد \(این نسخه ناقص است/.test(findMsvc));
ok('گزارش نشان می‌دهد کدام نسخه استفاده می‌شود', /← استفاده می‌شود/.test(findMsvc));

console.log('\n— خطای C1083 / winapifamily.h (دور پانزدهم) —');
ok('INCLUDE شامل پوشه‌ی shared است (محل winapifamily.h)', /'ucrt', 'shared', 'um', 'winrt'/.test(msvcLib));
ok('ترتیب INCLUDE مثل vcvars64 است (ucrt → shared → um → winrt)', /\[\s*'ucrt',\s*'shared',\s*'um',\s*'winrt'\s*\]/.test(msvcLib));
ok('LIB شامل ucrt و um x64 است', /for \(const sub of \['ucrt', 'um'\]\)/.test(msvcLib));
ok('VCINSTALLDIR به پوشه‌ی VC اشاره می‌کند (نه VC\\Tools)', /vcRoot = path\.resolve\(msvcDir, '\.\.', '\.\.', '\.\.'\)/.test(msvcLib));
ok('VCINSTALLDIR/ToolsVersion/Platform به محیط اضافه می‌شوند', /env\.VCToolsVersion/.test(msvcLib) && /env\.Platform = 'x64'/.test(msvcLib));
ok('WindowsSDKVersion و WindowsSdkDir تنظیم می‌شوند', /env\.WindowsSdkDir/.test(msvcLib) && /env\.WindowsSDKVersion/.test(msvcLib));
ok('موفقیت vcvars با LIB/INCLUDE سنجیده می‌شود (نه فقط PATH)', /libOk && incOk/.test(msvcLib));
ok('اگر vcvars کار نکرد، دلیلش نگه داشته می‌شود', /vcvarsFailed/.test(msvcLib) && /vcvarsReason/.test(msvcLib));
ok('بازگشت به ساخت دستی وقتی vcvars ناقص است', /const fb = manualEnv\(msvc\)/.test(msvcLib));
ok('نسخه‌های SDK عددی مرتب می‌شوند (26100 > 19041)', /versions\.sort\(\(a, b\) => -newerVersion\(a, b\)\)/.test(msvcLib));
ok('مسیر SDK روی درایو دیگر با FD_SDK_ROOT', /FD_SDK_ROOT/.test(msvcLib));

console.log('\n— خودآزمایی محیط قبل از ساخت —');
ok('وجود windows.h بررسی می‌شود', /windows\.h/.test(build) && /checkCompileEnv/.test(build));
ok('وجود winapifamily.h بررسی می‌شود', /winapifamily\.h/.test(build));
ok('وجود kernel32.lib بررسی می‌شود', /kernel32\.lib/.test(build));
ok('کمبود محیط قبل از کامپایل متوقف می‌کند (نه بعد از ۱۰ دقیقه)', /محیط کامپایل ناقص است/.test(build));
ok('دستور npm run desktop:env وجود دارد', /show-msvc-env\.mjs/.test(scripts['desktop:env'] || ''));
ok('desktop:env فهرست INCLUDE/LIB را با ✔/✘ چاپ می‌کند', /existsDir\(d\)/.test(envScript));
ok('desktop:env پنج فایل کلیدی را می‌سنجد', /winapifamily\.h/.test(envScript) && /kernel32\.lib/.test(envScript) && /ucrt\.lib/.test(envScript));
ok('desktop:env راه‌حل Modify در Visual Studio Installer می‌دهد', /Modify/.test(envScript));
ok('خطای C1083 در خروجی ساخت خودکار تشخیص داده می‌شود', /C1083\|Cannot open include file/.test(build));
ok('نام هدر گم‌شده از خروجی استخراج و چاپ می‌شود', /Cannot open include file: '\(\[\^'\]\+\)'/.test(build));

console.log('\n— doctor —');
ok('حالت «cargo روی دیسک ولی نه در PATH» تشخیص داده می‌شود', /cargoOnDisk/.test(doctor));
ok('راه‌حل PATH در doctor چاپ می‌شود', /set PATH=%USERPROFILE%/.test(doctor) || /export PATH=/.test(doctor));
ok('doctor به build:desktop ارجاع می‌دهد', /npm run build:desktop|npm run desktop:build/.test(doctor));

console.log('\n— نصب‌کننده PowerShell —');
ok('install-rust.ps1 وجود دارد', ps1.length > 500);
ok('نصب بی‌صدا (بدون پرسش) انجام می‌شود', /-y --default-toolchain/.test(ps1));
ok('PATH همین پنجره اصلاح می‌شود', /\$env:PATH\s*=\s*"\$cargoBin;/.test(ps1));
ok('اگر از قبل نصب بود، دوباره نصب نمی‌کند', /Test-Path \$cargoExe/.test(ps1));
ok('install-rust.ps1 لینکر C++ را هم چک می‌کند', /link\.exe/.test(ps1) && /vcpp-build-tools|VisualStudio\.2022\.BuildTools/.test(ps1));

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

/* ------------------------------------------------------------------ *
 * ساخت آفلاین (دور ۱۶) — باینری ویندوزی libSQL
 *
 * باگ واقعی: ساخت نصب‌کننده همیشه سعی می‌کرد از registry دانلود کند. روی
 * کمپیوتر آفلاین این مرحله شکست می‌خورد ولی ساخت «موفق» گزارش می‌شد و
 * نصب‌کننده روی ویندوز با «Cannot find module @libsql/win32-x64-msvc»
 * صفحه‌ی سفید می‌داد. این تست‌ها تضمین می‌کنند مسیر کش و توقف سخت سر جایش
 * بماند.
 * ------------------------------------------------------------------ */
console.log('\n— ساخت آفلاین: libSQL ویندوزی —');
{
  const prefetchPath = path.join(root, 'scripts', 'prefetch-libsql.mjs');
  const hasPrefetch = fs.existsSync(prefetchPath);
  ok('اسکریپت prefetch-libsql وجود دارد', hasPrefetch);
  const prefetch = hasPrefetch ? fs.readFileSync(prefetchPath, 'utf8') : '';
  ok('prefetch در .cache/libsql ذخیره می‌کند', /\.cache['"],\s*['"]libsql|libsqlCacheDir/.test(prefetch) || /'\.cache',\s*'libsql'/.test(prefetch));
  ok('prefetch نسخه را از npm می‌پرسد', /npm.*view|resolveVersion/.test(prefetch));
  ok('prefetch اگر بسته از قبل هست کاری نمی‌کند', /index\.node/.test(prefetch));
  ok('prefetch خطا را به کاربر می‌گوید', /process\.exit\(1\)/.test(prefetch));

  ok('ساخت API کش libSQL را می‌شناسد', /libsqlCacheDir|\.cache.*libsql/.test(apiPack));
  ok('ساخت API اول از کش نصب می‌کند', /از کش محلی|extractLibsqlTgz/.test(apiPack));
  ok('حالت آفلاین تشخیص داده می‌شود', /offlineMode|--offline/.test(apiPack));
  ok('در حالت آفلاین بدون کش، ساخت متوقف می‌شود', /process\.exit\(1\)/.test(apiPack) && /offlineMode/.test(apiPack));
  ok('پیام توقف راه‌حل prefetch را می‌دهد', /desktop:prefetch/.test(apiPack));

  ok('npm script برای prefetch هست', /"desktop:prefetch"/.test(pkgJson));
  ok('build-desktop هم prefetch-libsql را صدا می‌زند', /prefetch-libsql/.test(build));

  /* مستندات */
  ok('راهنمای ساخت آفلاین، کش libsql را توضیح می‌دهد', /libsql/i.test(docs) && /\.cache\/libsql/.test(docs));
  ok('جدول خطاهای آفلاین ردیف libSQL دارد', /ساخت آفلاین بدون باینری ویندوزی libSQL/.test(docs));
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
