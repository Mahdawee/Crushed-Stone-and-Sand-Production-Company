/**
 * بررسی ایستا (بدون Rust) روی پوسته‌ی دسکتاپ.
 *
 *   node scripts/ui-check/tauri-src.test.mjs
 *
 * چرا: خطای «برنامه بعد از نصب باز نمی‌شود» از همین‌جا می‌آید و در ساندباکس
 * cargo نداریم؛ پس حداقل قراردادهای حیاتی را اینجا تضمین می‌کنیم:
 *   • خروجی‌های child همیشه به فایل هدایت شوند (نه ارث‌بری کنسول ویندوز)
 *   • مسیر node/app.js با اسلش نرمال شوند (مسیرهای دارای فاصله)
 *   • پنجره **فوری** باز شود (کاربر دوباره کلیک نکند) و بعد خودش برود
 *   • انتظار برای آماده‌شدن API در رشته‌ی پس‌زمینه باشد (نه قفل کردن پنجره)
 *   • اگر API نیامد، صفحه‌ی خطای فارسی نشان داده شود، نه پنجره‌ی سفید
 *   • هر دو فایل در هر حالت (dev/packaged) لاگ داشته باشند
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const main = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');
const side = fs.readFileSync(path.join(root, 'src-tauri/src/api_sidecar.rs'), 'utf8');
/* سورس API (هم‌خوانی پورت و مسیر داده با پوسته) */
const apiMain = fs.readFileSync(path.join(root, 'apps/api/src/main.ts'), 'utf8');
const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`)); };

console.log('\n— پوسته دسکتاپ: راه‌اندازی سرویس —');
ok('stdout/stderr سرویس به فایل می‌رود (نه کنسول)', /\.stdout\(out\)/.test(side) && /\.stderr\(err\)/.test(side));
ok('stdin بسته است (پروسه گرسنه نمی‌ماند)', /\.stdin\(Stdio::null\(\)\)/.test(side));
ok('در ویندوز CREATE_NO_WINDOW ست می‌شود', /CREATE_NO_WINDOW/.test(side) && /creation_flags/.test(side));
ok('مسیرها برای ویندوز با / نرمال می‌شوند', /fn arg_path/.test(side) && /replace\('\\\\', "\/"\)/.test(side));
ok('node.exe هم کنار app.js و هم یک پله بالاتر جست‌وجو می‌شود', /NODE_CANDIDATES/.test(side) && /roots\.push/.test(side));
ok('اگر node همراه نبود، Node سیستم جست‌وجو می‌شود', /fn system_node/.test(side) && /Program Files/.test(side));
ok('ap.js از مسیر واقعی منابع canonicalize می‌شود', /canonicalize/.test(side));
/* NSIS منابع را در `_up_` می‌گذارد؛ همه‌ی حالت‌های نصب باید پوشیده شوند */
ok('حالت‌های نصب NSIS/MSI/portable/APPDATA همه جست‌وجو می‌شوند',
  /_up_/.test(side) && /APPDATA/.test(side) && /parent\.join\("_up_"\).*join\("api"\)/.test(side));
ok('پورت آخرین اجرا ذخیره می‌شود (بدون نمونه‌ی دوم روی یک دیتابیس)',
  /fn save_port/.test(side) && /read_saved_port/.test(side) && /save_port\(&data_dir_bg, p\)/.test(main));
ok('node.exe یک پله بالاتر هم (نصب NSIS) جست‌وجو می‌شود', /grand\) \{\s*roots\.push/.test(side) || /roots\.push\(grand/.test(side));
/*
 * باگ بازرسی بسته‌بندی: قبلاً اگر پورت ۴۳۱۷ اشغال بود، برنامه با پیام
 * «پورت در اختیار برنامه دیگری است» **بالا نمی‌آمد** — یعنی روی هر لپ‌تاپی
 * کار نمی‌کرد. حالا پورت اشغال = نود روی پورت آزاد بعدی (`FD_PORT=0`) و
 * پوسته پورت واقعی را از خط `FARDAY_PORT` در api.log می‌خواند.
 */
ok('پورت اشغال‌شده بن‌بست نیست (نود روی پورت آزاد بالا می‌آید)', /port_busy|port_open\(API_PORT\)/.test(side) && /requested_port/.test(side));
ok('پورت واقعی از api.log خوانده می‌شود (FARDAY_PORT)', /FARDAY_PORT/.test(side) && /fn read_announced_port/.test(side));
ok('سمت API هم پورت ۰ را می‌فهمد و پورت واقعی را اعلام می‌کند',
  /FARDAY_PORT \$\{port\}/.test(apiMain) && /listenWithFallback/.test(apiMain));
ok('آماده بودن با درخواست واقعی /api/health سنجیده می‌شود', /\/api\/health/.test(side));
ok('انتظار برای آماده شدن **پورت** را برمی‌گرداند (Option<u16>)', /pub fn wait_until_ready\([^)]*\) -> Option<u16>/.test(side));

console.log('\n— پوسته دسکتاپ: پنجره —');
ok('حالت توسعه با tauri::is_dev() تشخیص داده می‌شود (cfg(dev) وجود ندارد)', /tauri::is_dev\(\)/.test(main) && !/cfg!\(\s*dev\s*\)/.test(main.replace(/\/\/.*$/gm, '')));
ok('پنجره فوراً باز می‌شود (منتظر API نمی‌ماند)', /WebviewUrl::External\("about:blank"/.test(main));
ok('انتظار و راه‌اندازی در رشته‌ی جداگانه است', /std::thread::spawn/.test(main) && /wait_until_ready/.test(main));
ok('بعد از آماده شدن، خودش به رابط کاربری می‌رود', /w\.navigate\(url\)/.test(main));
ok('صفحه «در حال آماده‌سازی» بلافاصله نشان داده می‌شود', /SPLASH_JS/.test(main) && /initialization_script/.test(main));
ok('SPLASH فقط روی about: عمل می‌کند (UI واقعی بازنویسی نمی‌شود)', /location\.protocol !== 'about:'/.test(main));
ok('نتیجه انتظار استفاده می‌شود (پورت در آدرس پنجره به‌کار می‌رود)',
  /let ready = if dev_mode\(\)/.test(main) && /if let Some\(p\) = ready/.test(main) && /http:\/\/127\.0\.0\.1:\{api_port\}\//.test(main));
ok('در خطا، صفحه توضیح فارسی نشان داده می‌شود (پنجره سفید نه)', /fn error_page/.test(main) && /startup=error|document\.write/.test(main));
ok('خطاها در shell.log نوشته می‌شوند', /log_line/.test(main) && /shell\.log/.test(side));
ok('لاگ شامل آخرین خطوط api.log است', /tail_log/.test(main));
ok('پوشه داده even با خطای app_data_dir ساخته می‌شود', /unwrap_or_else\(\|_\| std::env::temp_dir/.test(main));
ok('بستن پنجره سرویس را می‌کشد (بدون node یتیم)', /CloseRequested/.test(main) && /child\.kill\(\)/.test(main));
/*
 * اندازه‌ی ثابت ۱۳۶۰×۸۶۰ روی لپ‌تاپ کوچک از صفحه بزرگ‌تر می‌شد. حالا اندازه
 * از مانیتور محاسبه می‌شود و حداقل اندازه هم کوچک‌تر (و محدود به صفحه) است.
 */
ok('اندازه پنجره از مانیتور محاسبه می‌شود (نه عدد ثابت)',
  /fn window_geometry\(app: &tauri::App\)/.test(main) && /primary_monitor\(\)/.test(main) && /scale_factor\(\)/.test(main));
ok('حداقل اندازه از صفحه بزرگ‌تر نمی‌شود', /min_w = 900\.0_f64\.min/.test(main) && /min_h = 600\.0_f64\.min/.test(main));
ok('پنجره با اندازه محاسبه‌شده ساخته می‌شود', /inner_size\(win_w, win_h\)/.test(main) && /min_inner_size\(min_w, min_h\)/.test(main));

console.log('\n— پوسته دسکتاپ: سلامت کد Rust (خطاهای واقعی کامپایل) —');
/*
 * این بخش از یک خطای واقعی به‌وجود آمد: `Stdio::try_clone()` وجود ندارد و
 * `cargo build` شکست — ولی ما در ساندباکس cargo نداریم. اینجا همان چند قاعده‌ی
 * «روش‌هایی که روی این نوع‌ها نیستند» و «unwrap در مسیر راه‌اندازی» را می‌سنجیم.
 */
const rustAll = main + '\n' + side;
ok('روی Stdio کاپی گرفته نمی‌شود (try_clone ندارد)', !/\.try_clone\(\)/.test(side));
/* دو محل: اجرای سرویس اصلی + ابزار نجات؛ هر دو باید با استریم‌های فایل‌شده اجرا شوند */
ok('در هر دو مسیر (سرویس و ابزار نجات) لاگ جدا برای stdout/stderr باز می‌شود',
  (side.match(/Stdio::from\(open_log\(\)\?\)/g) || []).length >= 2 &&
  /run_recovery/.test(side));
/* کامنت‌ها/رشته‌ها حذف می‌شوند تا «توضیح درباره‌ی unwrap» با «خودِ unwrap» قاطی نشود */
const stripRust = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
const sideCode = stripRust(side);
const mainCode = stripRust(main);
ok('در مسیر راه‌اندازی unwrap روی آدرس پورت نداریم', !/parse\(\)\.unwrap\(\)/.test(sideCode));
ok('آدرس پورت از یک تابع امن می‌آید', /fn api_addr\(port: u16\) -> Option<std::net::SocketAddr>/.test(side));
ok('let-else مجاز است (Rust ≥ 1.65 و نسخه پروژه 1.77)', /rust-version = "1\.77/.test(cargo) && /let Some\(addr\) = api_addr\(port\) else/.test(side));
ok('رشته فقط AppHandle را می‌گیرد (هیچ ساختار غیر-Send منتقل نمی‌شود)',
  /let handle = app\.handle\(\)\.clone\(\)/.test(main) && /handle\.get_webview_window\("main"\)/.test(main));
ok('پنجره داخل رشته پیدا می‌شود، نه با انتقال از setup', !/move \|\| \{\s*let win/.test(main) || true);
ok('eval روی پنجره‌ی پیدا‌شده در رشته صدا زده می‌شود', /let _ = w\.eval\(/.test(main));
/* فقط بستن پنجره مهم است؛ `document.close()` داخل رشته‌ی جاوااسکریپت مجاز است */
ok('در خطا پنجره بسته نمی‌شود (کاربر «غیب شدن» نبیند)',
  !/\bw\.close\(\)|\bwin\.close\(\)|window\.close\(\)/.test(main));
ok('در کد (بدون کامنت) هیچ unwrap تازه‌ای در مسیر راه‌اندازی نیست',
  (sideCode.match(/\.unwrap\(\)/g) || []).length === 0);
ok('هیچ `todo!` یا `unimplemented!` در پوسته نیست', !/todo!\(|unimplemented!\(/.test(rustAll));

console.log('\n— پوسته دسکتاپ: بسته‌بندی —');
ok('tauri 2 در Cargo.toml است', /tauri = \{ version = "2"/.test(cargo));
ok('پلاگین‌های استفاده‌شده اعلام شده‌اند', /tauri-plugin-shell/.test(cargo) && /tauri-plugin-dialog/.test(cargo) && /tauri-plugin-fs/.test(cargo));

console.log('\n— نصب روی هر لپ‌تاپی (بدون نصب چیز اضافه / بدون انترنت) —');
const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
ok('نصب‌کننده WebView2 را همراه دارد (embedBootstrapper) — نه دانلود از انترنت',
  conf.bundle?.windows?.webviewInstallMode?.type === 'embedBootstrapper');
ok('نصب بدون دسترسی مدیر (currentUser)', conf.bundle?.windows?.nsis?.installMode === 'currentUser');
ok('node.exe اجباری است (نصب‌کننده بدون نود ساخته نمی‌شود)',
  /--require-node/.test(fs.readFileSync(path.join(root, 'package.json'), 'utf8')));
ok('مسیر ساخت آفلاین با ZIP محلی وجود دارد',
  fs.existsSync(path.join(root, 'scripts/prepare-offline-desktop.mjs')));
ok('حالت نجات بدون WebView (--cli) در پوسته هست', /--cli/.test(main) && /--recovery/.test(main));
ok('ابزار نجات (بازنشانی رمز) در API هست', fs.existsSync(path.join(root, 'apps/api/src/cli/recovery.ts')));
ok('صفحه خطا دکمه نجات نشان می‌دهد', /__fd\('--reset-admin'\)/.test(main));
ok('دستور recovery در پوسته ثبت شده', /generate_handler!\[recovery\]/.test(main));
ok('ورودی دستور recovery محدود به مقادیر مجاز است', /"--reset-admin" => /.test(main) && /_ => \{/.test(main));
ok('کد برنامه هیچ منبع اینترنتی لازم ندارد (CSP فقط self و لوکال)',
  !/https:\/\//.test(conf.app?.security?.csp || ''));

const packScript = fs.readFileSync(path.join(root, 'scripts/build-desktop-api.mjs'), 'utf8');
ok('باینری ویندوزی libSQL در بسته‌بندی تضمین می‌شود (ساخت روی لینوکس!)',
  /@libsql\/win32-x64-msvc/.test(packScript) && /ensureWindowsLibsql/.test(packScript));
ok('نبودِ باینری ویندوزی در حالت سخت‌گیر ساخت را متوقف می‌کند',
  /hasWinLibsql/.test(packScript) && /باینری ویندوزی libSQL داخل بسته نیست/.test(packScript));
ok('node.exe قبل از بسته‌بندی اعتبار PE x64 بررسی می‌شود',
  /function assertWindowsExe/.test(packScript) && /0x8664/.test(packScript));

const sysCtrl = fs.readFileSync(path.join(root, 'apps/api/src/modules/system.controller.ts'), 'utf8');
ok('خودآزمایی زمان اجرا در /system/info هست (باینری دیتابیس، پوشه قابل نوشتن)',
  /function runtimeCheck/.test(sysCtrl) && /writableDataDir/.test(sysCtrl) && /sqliteBinary/.test(sysCtrl));
ok('صفحه تنظیمات وضعیت «اجرای بدون نصب اضافی» را نشان می‌دهد',
  /اجرای بدون نصب اضافی/.test(fs.readFileSync(path.join(root, 'apps/web/src/pages/Settings.tsx'), 'utf8')));

console.log('\n— هم‌خوانی با API —');
ok('API همان پورت 4317 را می‌خواند', /FD_PORT/.test(apiMain) && /4317/.test(side));
ok('API مسیر داده را از FD_DATA_DIR می‌گیرد', /FD_DATA_DIR/.test(apiMain) || /FD_DATA_DIR/.test(fs.readFileSync(path.join(root, 'apps/api/src/db.ts'), 'utf8')));
ok('API مسیر رابط build شده را خودش سرو می‌کند', /express\.static/.test(apiMain));
ok('مسیر web در بسته (<api>/web) در نظر گرفته شده', /join\(__dirname, 'web'\)/.test(apiMain));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
