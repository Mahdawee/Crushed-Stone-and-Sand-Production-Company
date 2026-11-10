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
ok('پورت اشغال‌شده با پیام روشن گزارش می‌شود', /port_busy/.test(side) && /در اختیار برنامه دیگری/.test(side));
ok('آماده بودن با درخواست واقعی /api/health سنجیده می‌شود', /\/api\/health/.test(side));
ok('انتظار برای آماده شدن مقدار برمی‌گرداند (bool)', /pub fn wait_until_ready\(seconds: u64\) -> bool/.test(side));

console.log('\n— پوسته دسکتاپ: پنجره —');
ok('حالت توسعه با tauri::is_dev() تشخیص داده می‌شود (cfg(dev) وجود ندارد)', /tauri::is_dev\(\)/.test(main) && !/cfg!\(\s*dev\s*\)/.test(main.replace(/\/\/.*$/gm, '')));
ok('پنجره فوراً باز می‌شود (منتظر API نمی‌ماند)', /WebviewUrl::External\("about:blank"/.test(main));
ok('انتظار و راه‌اندازی در رشته‌ی جداگانه است', /std::thread::spawn/.test(main) && /wait_until_ready/.test(main));
ok('بعد از آماده شدن، خودش به رابط کاربری می‌رود', /win\.navigate\(url\)/.test(main));
ok('صفحه «در حال آماده‌سازی» بلافاصله نشان داده می‌شود', /SPLASH_JS/.test(main) && /initialization_script/.test(main));
ok('SPLASH فقط روی about: عمل می‌کند (UI واقعی بازنویسی نمی‌شود)', /location\.protocol !== 'about:'/.test(main));
ok('نتیجه انتظار استفاده می‌شود (قبلاً نادیده گرفته می‌شد)', /let ready = api_sidecar::wait_until_ready/.test(main) && /if ready \{/.test(main));
ok('در خطا، صفحه توضیح فارسی نشان داده می‌شود (پنجره سفید نه)', /fn error_page/.test(main) && /startup=error|document\.write/.test(main));
ok('خطاها در shell.log نوشته می‌شوند', /log_line/.test(main) && /shell\.log/.test(side));
ok('لاگ شامل آخرین خطوط api.log است', /tail_log/.test(main));
ok('پوشه داده even با خطای app_data_dir ساخته می‌شود', /unwrap_or_else\(\|_\| std::env::temp_dir/.test(main));
ok('بستن پنجره سرویس را می‌کشد (بدون node یتیم)', /CloseRequested/.test(main) && /child\.kill\(\)/.test(main));
ok('پنجره با اندازه و حداقل اندازه ساخته می‌شود', /inner_size\(1360\.0, 860\.0\)/.test(main) && /min_inner_size/.test(main));

console.log('\n— پوسته دسکتاپ: بسته‌بندی —');
ok('tauri 2 در Cargo.toml است', /tauri = \{ version = "2"/.test(cargo));
ok('پلاگین‌های استفاده‌شده اعلام شده‌اند', /tauri-plugin-shell/.test(cargo) && /tauri-plugin-dialog/.test(cargo) && /tauri-plugin-fs/.test(cargo));

console.log('\n— هم‌خوانی با API —');
const apiMain = fs.readFileSync(path.join(root, 'apps/api/src/main.ts'), 'utf8');
ok('API همان پورت 4317 را می‌خواند', /FD_PORT/.test(apiMain) && /4317/.test(side));
ok('API مسیر داده را از FD_DATA_DIR می‌گیرد', /FD_DATA_DIR/.test(apiMain) || /FD_DATA_DIR/.test(fs.readFileSync(path.join(root, 'apps/api/src/db.ts'), 'utf8')));
ok('API مسیر رابط build شده را خودش سرو می‌کند', /express\.static/.test(apiMain));
ok('مسیر web در بسته (<api>/web) در نظر گرفته شده', /join\(__dirname, 'web'\)/.test(apiMain));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
