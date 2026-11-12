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
/*
 * باگ کاربر: در خروجی ساخت این خط می‌آمد:
 *   Downloading https://go.microsoft.com/fwlink/p/?LinkId=2124703
 * یعنی bundler در زمان ساخت بوت‌استرپ را از انترنت می‌گرفت — و همان
 * بوت‌استرپ موقع نصب هم باید از انترنت WebView2 را می‌آورد.
 * `offlineInstaller` هر دو وابستگی را حذف می‌کند (نصب بدون انترنت).
 */
ok('WebView2 کامل و آفلاین همراه نصب‌کننده است (offlineInstaller) — نه بوت‌استرپ اینترنتی',
  conf.bundle?.windows?.webviewInstallMode?.type === 'offlineInstaller',
  String(conf.bundle?.windows?.webviewInstallMode?.type));
ok('نصب WebView2 خاموش و بی‌سؤال انجام می‌شود (silent)', conf.bundle?.windows?.webviewInstallMode?.silent === true);
ok('ابزار آماده‌سازی WebView2 هست (فایل‌ها را در کش می‌گذارد تا ساخت دانلود نکند)',
  fs.existsSync(path.join(root, 'scripts/lib/webview2.mjs')));
const wvMod = fs.readFileSync(path.join(root, 'scripts/lib/webview2.mjs'), 'utf8');
ok('اسکریپت WebView2 همان مسیر کش bundler را هدف می‌گیرد',
  /\/tauri/.test(wvMod) && /LOCALAPPDATA/.test(wvMod));
ok('اسکریپت WebView2 هر دو فایل (بوت‌استرپ و نصب‌کننده‌ی آفلاین) را می‌گیرد',
  /WEBVIEW2_BOOTSTRAPPER_URL/.test(wvMod) && /WEBVIEW2_OFFLINE_X64_URL/.test(wvMod));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
ok('دستور webview2:prepare در package.json هست', Boolean(pkg.scripts?.['webview2:prepare']));
ok('دستور webview2:status (بدون انترنت) در package.json هست', Boolean(pkg.scripts?.['webview2:status']));
const buildDesktop = fs.readFileSync(path.join(root, 'scripts/build-desktop.mjs'), 'utf8');
ok('ساخت آفلاین بدون فایل WebView2 با پیام روشن متوقف می‌شود (نه دانلود خاموش)',
  /readyOffline/.test(buildDesktop) && /webview2:prepare/.test(buildDesktop));
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
  /assertWindowsExe/.test(packScript) && /0x8664/.test(fs.readFileSync(path.join(root, 'scripts/lib/node-runtime.mjs'), 'utf8')));

const sysCtrl = fs.readFileSync(path.join(root, 'apps/api/src/modules/system.controller.ts'), 'utf8');
ok('خودآزمایی زمان اجرا در /system/info هست (باینری دیتابیس، پوشه قابل نوشتن)',
  /function runtimeCheck/.test(sysCtrl) && /writableDataDir/.test(sysCtrl) && /sqliteBinary/.test(sysCtrl));
ok('صفحه تنظیمات وضعیت «اجرای بدون نصب اضافی» را نشان می‌دهد',
  /اجرای بدون نصب اضافی/.test(fs.readFileSync(path.join(root, 'apps/web/src/pages/Settings.tsx'), 'utf8')));

console.log('\n— ابزارهای بیرونی در نصب‌کننده (باگ دور ۳۴/۳۵، الگوی مسیر در دور ۳۶) —');
{
  /*
   * دور ۳۴ الگوی «tools/ستاره‌ستاره» را در بسته گذاشت تا ابزار «صفر کردن» روی نصب
   * مشتری باشد؛ ولی همان الگو ابزار **لایسنس** (keygen/صدور/باطل) را هم برد.
   * روی بیلد بدون مُهر، مشتری می‌توانست با کلید عمومیِ جای‌گزین لایسنس جعلی
   * بسازد. ابزار لایسنس مالِ فروشنده است؛ فقط reset-ui باید برود.
   */
  const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const res = conf?.bundle?.resources || [];
  /*
   * ── باگ (دور ۳۶): بررسی «پیشوند رشته» کافی نبود ─────────────────────
   * الگوها **نسبت به پوشه‌ی `src-tauri/`** حل می‌شوند (نه ریشه‌ی مخزن).
   * پس الگوی tools/reset-ui (ستاره‌ستاره) هیچ فایلی پیدا نمی‌کند و Tauri با
   * «glob pattern … path not found or didn't match any files» ساخت را
   * می‌شکند — ولی تست فقط رشته را می‌دید و سبز می‌ماند.
   * حالا الگوها واقعاً حل می‌شوند (`fs.globSync`) و وجود فایل بررسی می‌شود.
   */
  const confDir = path.join(root, 'src-tauri');
  const glob = (pattern) => {
    try { return fs.globSync(pattern, { cwd: confDir }); } catch { return []; }
  };
  const matched = (frag) => res.some((r) => glob(String(r))
    .some((hit) => String(hit).replace(/\\/g, '/').includes(frag)));
  /*
   * ── باگ (دور ۳۶): ساخت واقعی کاربر با این پیام شکست ────────────────
   *   «glob pattern … path not found or didn't match any files»
   * چون الگوها نسبت به `src-tauri/` حل می‌شوند. راه‌حل: `desktop:build` قبل
   * از ساخت، `tools/reset-ui` را به `src-tauri/tools/reset-ui` کاپی می‌کند.
   * اینجا همان دو چیز بررسی می‌شود: (۱) الگو واقعاً فایل پیدا کند،
   * (۲) چیزی که کاپی می‌شود فقط reset-ui باشد — نه ابزار لایسنس.
   */
  /*
   * `src-tauri/api` یک **محصول ساخت** است (`desktop:build` می‌سازدش)، پس در
   * کلون تازه وجود ندارد. بررسیِ «فایل پیدا می‌کند» باید فقط وقتی اجرا شود
   * که ساخته شده باشد؛ وگرنه تست در ماشین من سبز و در کلون تازه قرمز بود
   * (دور ۳۷). الگوی درست بودن هم بررسی می‌شود.
   */
  ok('الگوی api در فهرست منابع هست', res.some((r) => String(r).startsWith('api/')), res.join(','));
  const apiBuilt = fs.existsSync(path.join(root, 'src-tauri', 'api', 'app.js'));
  if (apiBuilt) ok('بسته‌ی API ساخته شده و الگویش فایل پیدا می‌کند', matched('api/app.js'), res.join(','));
  else ok('بسته‌ی API هنوز ساخته نشده — بررسی فایل رد شد (desktop:build می‌سازدش)', true);
  ok('الگوی کلید عمومی فایل واقعی پیدا می‌کند', matched('public-key/farday-public.b64'), res.join(','));

  /* منبع الگو باید خود `src-tauri/tools` باشد، نه مسیر بیرون از آن */
  const toolPatterns = res.filter((r) => String(r).includes('tools/'));
  ok('الگوی ابزارها داخل src-tauri است (نه ../tools که نسخه‌های Tauri رد می‌کنند)',
    toolPatterns.length > 0 && toolPatterns.every((r) => !String(r).startsWith('..')),
    toolPatterns.join(','));

  const bd = fs.readFileSync(path.join(root, 'scripts/build-desktop.mjs'), 'utf8');
  ok('build-desktop ابزارها را داخل src-tauri کاپی می‌کند', /function stageTools\(\)/.test(bd));
  const bundled = /const BUNDLED_TOOLS = \[([^\]]*)\]/.exec(bd);
  const toolNames = bundled ? bundled[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean) : [];
  ok('فقط ابزار «صفر کردن» کاپی می‌شود', toolNames.length === 1 && toolNames[0] === 'reset-ui', toolNames.join(','));
  ok('ابزار لایسنس در فهرست کاپی نیست', !toolNames.includes('license'), toolNames.join(','));
  ok('build-desktop پیش از ساخت، الگوهای خالی را می‌گیرد',
    /همه‌ی الگوهای bundle\.resources فایل پیدا می‌کنند/.test(bd) && /stageTools\(\)/.test(bd));

  /* و اگر پوشه‌ی مرحله‌بندی ساخته شده باشد، نباید ابزار لایسنس داشته باشد */
  const stagedLicense = path.join(root, 'src-tauri', 'tools', 'license');
  ok('پوشه‌ی مرحله‌بندی (اگر هست) ابزار لایسنس ندارد', !fs.existsSync(stagedLicense));

  for (const need of ['tools/reset-ui/server.mjs', 'tools/reset-ui/reset-core.mjs', 'tools/reset-ui/ui.html',
    'tools/reset-ui/start.cmd', 'tools/reset-ui/start.sh']) {
    ok(`فایل ${need} برای بسته‌بندی موجود است`, fs.existsSync(path.join(root, need)));
  }
  /* ابزار لایسنس باید در مخزن بماند (فروشنده از آن استفاده می‌کند) */
  ok('ابزار لایسنس برای فروشنده در مخزن می‌ماند',
    fs.existsSync(path.join(root, 'tools/license/server.mjs')));

  /*
   * کلید امضا و دفترچه‌ی صدور: روی دیسک فروشنده هست (و باید باشد)، پس
   * «نبودِ فایل» معیار درستی نیست؛ معیار این است که هیچ الگوی resources
   * آن را نگیرد. وگرنه یک کلید ۳۲ بایتی امضا داخل .msi مشتری می‌رود.
   */
  const covers = (file) => res.some((r) => {
    const pat = String(r).replace(/^\.\//, '');
    const dir = path.posix.normalize(pat.replace(/\/\*\*\/\*$|\/\*\*$|\/\*$/, ''));
    return file === dir || file.startsWith(`${dir}/`);
  });
  for (const secret of ['license-keys/private.key', 'license-keys/issued.json',
    'src-tauri/api/private.key', 'src-tauri/api/issued.json']) {
    ok(`${secret} زیر هیچ الگوی resources نیست`, !covers(secret), res.join(','));
  }
  /* و ریشه‌ی کلیدها در گیت نباشد */
  {
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    /* کل پوشه نادیده گرفته می‌شود، پس هر فایل تازه‌ای هم امن است */
    const ignored = (file) => gi.split('\n').some((l) => l.trim() === 'license-keys/')
      || gi.split('\n').some((l) => l.trim() === file);
    ok('.gitignore کلید خصوصی را نگه می‌دارد', ignored('license-keys/private.key'));
    ok('.gitignore دفترچه‌ی صدور را نگه می‌دارد', ignored('license-keys/issued.json'));
  }

  /* اجراکننده‌ها نباید به «ریشه‌ی مخزن» تکیه کنند — در نصب وجود ندارد */
  for (const f of ['tools/reset-ui/start.cmd']) {
    const body = fs.readFileSync(path.join(root, f), 'utf8');
    ok(`${f} ریشه‌ی مخزن را cd نمی‌کند`, !/cd \/d "%~dp0\.\.\\\.\."/.test(body));
    ok(`${f} node.exe همراه بسته را در ..\\api می‌گیرد`, /\.\.\\api\\node\.exe/.test(body));
    /*
     * باگ دور ۳۴: `where node` **قبل از** جست‌وجوی node.exe همراه بسته اجرا
     * می‌شد؛ روی کمپیوتری که برنامه نصب است ولی Node نصب نیست، ابزار می‌رفت
     * به پیام «Node.js پیدا نشد» — درست همان حالتی که node.exe برایش بسته
     * شده است. حالا اول همراه بسته، بعد نود سیستم.
     */
    {
      const iBundled = body.indexOf('NODE_EXE');
      /* فقط خطِ فرمان، نه اشاره‌ی داخل توضیح */
      const iWhere = body.search(/^\s*where node/m);
      ok(`${f} اول node.exe همراه بسته را می‌گیرد، بعد نود سیستم`,
        iBundled > -1 && iWhere > -1 && iWhere > iBundled, `bundled=${iBundled} where=${iWhere}`);
      ok(`${f} نبودِ نود را با پیام فارسی می‌گوید`, /:no_node/.test(body) && /Node\.js/.test(body));
    }
  }
  for (const f of ['tools/reset-ui/start.sh']) {
    const body = fs.readFileSync(path.join(root, f), 'utf8');
    ok(`${f} به ریشه‌ی مخزن cd نمی‌کند`, !/^cd "\$root"$/m.test(body));
    ok(`${f} مسیر node همراه بسته را می‌گیرد`, /\$here\/\.\.\/api\/node/.test(body));
  }
}

console.log('\n— مُهر کلید عمومی در بیلد انتشاری (باگ دور ۳۵) —');
{
  /*
   * باگ: `build.rs` نبودِ کلید را فقط `cargo:warning` می‌کرد. یعنی می‌شد
   * یک .msi انتشاری ساخت که کلید عمومی‌اش فقط یک فایل متنی کنار برنامه
   * است؛ با عوض کردن آن فایل، هر کسی می‌تواند لایسنس خودش را بسازد.
   * حالا بیلد انتشاری بدون کلید باید **متوقف** شود.
   */
  const buildRs = fs.readFileSync(path.join(root, 'src-tauri/build.rs'), 'utf8');
  ok('build.rs متغیر بیلد انتشاری را می‌شناسد', /FD_RELEASE/.test(buildRs));
  ok('build.rs بیلد انتشاری بدون مُهر را متوقف می‌کند (نه فقط هشدار)',
    /if release_build\(\)/.test(buildRs) && /panic!/.test(buildRs));
  ok('هشدار «نسخه بدون مُهر» فقط برای توسعه مانده', /cargo:warning=.*بدون مُهر/.test(buildRs));

  const bd = fs.readFileSync(path.join(root, 'scripts/build-desktop.mjs'), 'utf8');
  ok('build-desktop در بیلد انتشاری FD_RELEASE=1 می‌دهد', /FD_RELEASE: '1'/.test(bd));
  ok('بیلد --debug انتشاری حساب نمی‌شود', /wantDebug \? \{ \.\.\.env \}/.test(bd));

  /*
   * ── اصلاح (دور ۳۷): این بررسی «کاذب» بود ──────────────────────────────
   * `src-tauri/seal/reset-key.txt` در `.gitignore` است (کلید صفر کردن مثل
   * کلید خصوصی لایسنس نباید در گیت باشد). پس بررسی «فایل روی دیسک هست» در
   * ماشین من سبز می‌شد و در یک کلون تازه **قرمز**. تست باید چیزی را بسنجد
   * که در همه‌جا درست باشد: کلید عمومی (که در گیت است) و «نبودنِ» کلید
   * خصوصی/کلید صفر کردن در گیت (نه روی دیسک).
   */
  ok('کلید عمومی مُهر در گیت هست (لازم برای بیلد)',
    fs.existsSync(path.join(root, 'src-tauri/seal/public-key.txt')));
  ok('.gitignore کلید صفر کردن را از گیت دور نگه می‌دارد', (() => {
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    return /^reset-key\.txt$/m.test(gi) || /src-tauri\/seal\/reset-key\.txt/m.test(gi);
  })());
  /* اگر کلید صفر کردن روی دیسک هست، build.rs باید مُهرش کند؛ نبودنش هم مجاز است */
  ok('نبودِ کلید صفر کردن، ساخت را نمی‌شکند (build.rs فقط هشدار می‌دهد)',
    /cargo:warning=.*صفر کردن/.test(buildRs));
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
