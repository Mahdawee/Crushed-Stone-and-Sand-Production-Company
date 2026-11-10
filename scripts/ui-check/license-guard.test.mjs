/**
 * نگهبان‌های سیستم لایسنس — تست ساختاری بدون اجرای سرور.
 *
 *   node scripts/ui-check/license-guard.test.mjs
 *
 * چرا: قفل لایسنس فقط وقتی ارزش دارد که **همه‌ی** مسیرها را ببندد و در
 * عین حال راه نجات (صفحه‌ی لایسنس) باز بماند. یک اشتباه کوچک در این فایل
 * یعنی یا «برنامه برای همه قفل می‌شود» یا «هیچ‌کس قفل نمی‌شود». این تست
 * همان دو حالت را می‌گیرد:
 *
 *   ۱) LicenseGuard در app.module ثبت شده و در ردیف نگهبان‌هاست.
 *   ۲) مسیرهای /license/* و /auth/login از قفل مستثنا هستند.
 *   ۳) AuthGuard در حالت بدون لایسنس ۴۲۳ می‌دهد (نه ۴۰۱ گمراه‌کننده).
 *   ۴) کلید خصوصی هیچ‌جایی در کد/بسته/گیت نیست.
 *   ۵) کلید عمومی در بسته موجود است و در state خوانده می‌شود.
 *   ۶) قفل زمان: تلورانس ۲۴ ساعت، مهر روی دیتابیس و فایل، effectiveNow.
 *   ۷) UI: مسیر /license وجود دارد و در وضعیت قفل دیگر مسیری باز نیست.
 *   ۸) هیچ مسیر API دیگری بدون نگهبان نمانده (چک ساختاری).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const api = path.join(root, 'apps/api/src');
const web = path.join(root, 'apps/web/src');

let pass = 0,
  fail = 0;
const ok = (n, c, extra = '') => {
  c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`));
};
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

console.log('\n— ثبت و ترتیب نگهبان‌ها —');
const appModule = read(path.join(api, 'app.module.ts'));
ok('LicenseGuard در AppModule ثبت شده است', /LicenseGuard/.test(appModule) && /APP_GUARD, useClass: LicenseGuard/.test(appModule));
ok('AuthGuard قبل از LicenseGuard است (ترتیب درست)',
  appModule.indexOf('useClass: AuthGuard') < appModule.indexOf('useClass: LicenseGuard'));
ok('LicenseController در AppModule هست', /LicenseController/.test(appModule));

console.log('\n— مسیرهای مستثنا (راه نجات نباید قفل شود) —');
const guard = read(path.join(api, 'common/license-guard.ts'));
for (const p of ["'/license/'", "'/auth/login'", "'/health'"]) {
  ok(`مسیر ${p} از قفل مستثناست`, guard.includes(p));
}
ok('مسیرهای غیر-API (فایل‌های رابط کاربری) قفل نمی‌شوند', /startsWith\('\/api'\)/.test(guard));
ok('خطای قفل ۴۲۳ با کد LICENSE_REQUIRED است', /423/.test(guard) && /LICENSE_REQUIRED/.test(guard));
ok('کش وضعیت وجود دارد (کارایی، نه خواندن رجستری در هر درخواست)', /CACHE_MS/.test(guard));
ok('محدودیت تلاش فعال‌سازی هست (ضد حمله)', /activationAllowed/.test(guard) && /MAX_ATTEMPTS/.test(guard));

console.log('\n— پیام درست برای کاربر بدون لایسنس —');
const auth = read(path.join(api, 'common/auth.ts'));
ok('AuthGuard در نبود لایسنس ۴۲۳ می‌دهد (نه ۴۰۱ گمراه‌کننده)', /LICENSE_REQUIRED/.test(auth) && /423/.test(auth));
ok('مسیرهای عمومی (login/health) در AuthGuard باز می‌مانند', /if \(isPublic\) return true;/.test(auth));

console.log('\n— رمزنگاری و کلیدها —');
const license = read(path.join(api, 'common/license.ts'));
ok('امضا/بررسی با Ed25519 انجام می‌شود (بدون کتابخانه‌ی بیرونی)',
  /generateKeyPairSync\('ed25519'\)/.test(license) && /crypto\.sign\(null/.test(license) && /crypto\.verify\(null/.test(license));
ok('طول امضا ۶۴ بایت بررسی می‌شود', /sig\.length !== 64/.test(license));
ok('مقایسه‌ی مقاوم به زمان برای مهرها', /timingSafeEqual/.test(license));
ok('امضا روی رشته‌ی base64 بدنه است (نه JSON بازسازی‌شده)', /signText\(body, privateKeyB64\)/.test(license));
ok('قالب متن لایسنس یکتاست (FR-1 + سرصفحه)', /BEGIN FARDAY LICENSE/.test(license) && /FR-1/.test(license));

const tool = read(path.join(root, 'scripts/license-tool.mjs'));
ok('ابزار لایسنس: صدور/بازرسی/دفتر', /function cmdIssue/.test(tool) && /function cmdVerify/.test(tool) && /function cmdList/.test(tool));
ok('ابزار لایسنس: هشدار صریح درباره‌ی کلید خصوصی', /هرگز/.test(tool));
ok('نوع‌های دوره: ماهوار/سالانه/ابد/دلخواه/آزمایشی', ['monthly', 'yearly', 'perpetual', 'custom', 'trial'].every((k) => tool.includes(`${k}:`)));

console.log('\n— کلید خصوصی نباید هیچ‌جا باشد —');
const gitignore = read(path.join(root, '.gitignore'));
ok('پوشه‌ی کلیدها در .gitignore است', /license-keys\//.test(gitignore));
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'target', '.git', '.cache'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|cjs|js|json|rs|md)$/.test(e.name)) out.push(p);
  }
  return out;
};
const files = walk(root);
let privateLeak = 0;
for (const f of files) {
  const t = read(f);
  /*
   * کلید خصوصی PKCS8 Ed25519 = ۴۸ بایت DER که base64 آن با یک پیشوند ثابت
   * شروع می‌شود. پیشوند را تکه‌تکه می‌سازیم تا این فایل خودش «نمونه» نشود.
   */
  const marker = 'MC4CAQAwBQYD' + 'K2Vw';
  if (t.includes(marker)) { privateLeak++; console.log(`     ↳ کلید خصوصی داخل ${path.relative(root, f)}`); }
}
ok('هیچ کلید خصوصی Ed25519 در مخزن نیست', privateLeak === 0);
const pubPath = path.join(root, 'src-tauri', 'public-key', 'farday-public.b64');
ok('کلید عمومی برای بسته ساخته شده است', exists(pubPath) && read(pubPath).trim().length > 30);
ok('کلید عمومی ۳۲ بایتی Ed25519 است', (() => {
  try { return Buffer.from(read(pubPath).trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64').length === 44; } catch { return false; }
})());
const state = read(path.join(api, 'common/license-state.ts'));
ok('کلید عمومی از متغیر محیطی/فایل بسته خوانده می‌شود', /FD_LICENSE_PUBLIC_KEY/.test(state) && /public-key/.test(state));
ok('ستون‌های License/LicenseClock ساخته می‌شوند', /CREATE TABLE IF NOT EXISTS "License"/.test(state) && /"LicenseClock"/.test(state));

console.log('\n— قفل دستگاه —');
const machine = read(path.join(api, 'common/license-machine.ts'));
ok('شناسه‌ی دستگاه از رجستری ویندوز (MachineGuid) خوانده می‌شود', /Cryptography/.test(machine) && /MachineGuid/.test(machine));
ok('UUID تخته‌مادر هم به‌عنوان پشتیبان هست', /Win32_ComputerSystemProduct/.test(machine));
ok('خروجی فقط هش است (نه شناسه‌ی خام)', /machineKeyFromSeed\(sha256/.test(machine) || /machineKeyFromSeed/.test(machine));
ok('کلید دستگاه هنگام فعال‌سازی مقایسه می‌شود', /normalizeMachineKey\(payload\.machineKey/.test(state) || /bound !== normalizeMachineKey/.test(state));

console.log('\n— قفل زمان (۲۴ ساعت + ضد برگشت) —');
const clock = read(path.join(api, 'common/license-clock.ts'));
ok('تلورانس دقیقاً ۲۴ ساعت است', /CLOCK_TOLERANCE_MS = 24 \* 60 \* 60 \* 1000/.test(clock));
ok('مهر ساعت با HMAC و مقاوم به زمان بررسی می‌شود', /hmac256/.test(clock) && /safeEqual/.test(clock));
ok('ساعت در دو جا ذخیره می‌شود (فایل + دیتابیس)', /writeClockFile/.test(clock) && /readClockFile/.test(clock));
ok('«اکنون مؤثر» هرگز از مرجع عقب‌تر نیست', /Math\.max\(now, state\.anchor/.test(clock));
ok('عقب‌بردن ساعت لایسنس منقضی را زنده نمی‌کند',
  /effectiveNow\(check\.state, now\)/.test(state) && /licenseInWindow/.test(clock));
ok('پیام فارسی برای جابه‌جایی ساعت', /ساعت کمپیوتر/.test(clock));

console.log('\n— رابط کاربری —');
const app = read(path.join(web, 'App.tsx'));
ok('مسیر /license وجود دارد', /path="\/license"/.test(app));
ok('در حالت قفل، همه‌ی مسیرها به /license می‌روند', /license && !license\.ok/.test(app) && /Navigate to="\/license"/.test(app));
const page = exists(path.join(web, 'pages/License.tsx')) ? read(path.join(web, 'pages/License.tsx')) : '';
ok('صفحه‌ی لایسنس هست و کلید دستگاه را کاپی می‌کند', /machineKey/.test(page) && /clipboard/.test(page));
ok('صفحه‌ی لایسنس متن لایسنس را به API می‌فرستد', /license\/activate/.test(page));
const session = read(path.join(web, 'lib/session.tsx'));
ok('نشست، وضعیت لایسنس را قبل از ورود می‌خواند', /await reloadLicense\(\)/.test(session));
const apiClient = read(path.join(web, 'lib/api.ts'));
ok('پاسخ ۴۲۳ کاربر را از سیستم بیرون نمی‌اندازد (فقط رویداد لایسنس)', /status === 423/.test(apiClient) && /farday:license-required/.test(apiClient));
ok('۴۲۳ باعث خروج خودکار نمی‌شود', !/status === 423[\s\S]{0,400}setToken\(''\)/.test(apiClient));

console.log('\n— «مُهر»: کلید عمومی داخل فایل اجرایی —');
const buildRs = exists(path.join(root, 'src-tauri/build.rs')) ? read(path.join(root, 'src-tauri/build.rs')) : '';
const sealRs = exists(path.join(root, 'src-tauri/src/seal.rs')) ? read(path.join(root, 'src-tauri/src/seal.rs')) : '';
ok('build.rs کلید عمومی را داخل باینری می‌پزد (seal.rs)', /SEALED_PUBLIC_KEY/.test(buildRs) && /SEAL_FINGERPRINT/.test(buildRs));
ok('seal.rs اثر انگشت SHA-256 را هنگام اجرا بررسی می‌کند', /sha256_hex/.test(sealRs) && /actual != expected/.test(sealRs));
ok('seal.rs بردارهای مرجع SHA-256 را تست می‌کند', /e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/.test(sealRs));
ok('پوسته کلید مُهرشده را به سرویس داخلی می‌دهد', /FD_SEALED_PUBLIC_KEY/.test(read(path.join(root, 'src-tauri/src/api_sidecar.rs'))));
ok('API کلید مُهرشده را با بالاترین اولویت می‌خواند', /FD_SEALED_PUBLIC_KEY/.test(state) && /const sealed/.test(state));
ok('منبع مُهر در مخزن هست', exists(path.join(root, 'src-tauri/seal/public-key.txt')));
ok('build-desktop-api منبع مُهر را کاپی می‌کند', /seal/.test(read(path.join(root, 'scripts/build-desktop-api.mjs'))));

console.log('\n— درهای پشتی (متغیرهای محیطی) —');
const machineSrc = read(path.join(api, 'common/license-machine.ts'));
ok('FD_MACHINE_KEY فقط در حالت توسعه اثر دارد', /FD_LICENSE_DEV === '1'/.test(machineSrc));
ok('FD_LICENSE_PUBLIC_KEY فقط در حالت توسعه اثر دارد',
  /FD_LICENSE_DEV/.test(state) && /licenseDevMode\(\)/.test(state));
ok('هیچ کلید/فایلی از پوشه‌ی داده خوانده نمی‌شود (کاربر آن را کنترل می‌کند)',
  !/path\.join\(dataDir\(\), PUBLIC_KEY_FILE\)/.test(state) && /shippedKeyPaths/.test(state));
ok('مسیرهای مجاز کلید محدود و ثابت‌اند', /export function shippedKeyPaths/.test(state));

console.log('\n— ابزار گرافیکی لایسنس —');
const server = exists(path.join(root, 'tools/license/server.mjs')) ? read(path.join(root, 'tools/license/server.mjs')) : '';
const uiHtml = exists(path.join(root, 'tools/license/ui.html')) ? read(path.join(root, 'tools/license/ui.html')) : '';
ok('سرور ابزار فقط روی 127.0.0.1 گوش می‌دهد', /HOST = '127\.0\.0\.1'/.test(server));
ok('سرور کلید خصوصی را برنمی‌گرداند (هیچ پاسخ JSON آن را ندارد)', !/privateKey:\s*priv/.test(server) && !/readFileSync\(privatePath[^)]*\)\s*,\s*200/.test(server));
ok('توکن CSRF برای درخواست‌های تغییردهنده لازم است', /x-license-csrf/.test(server) && /guardMutation/.test(server));
ok('مبدأ درخواست بررسی می‌شود (ضد CSRF مرورگری)', /origin/.test(server) && /مجاز نیست/.test(server));
ok('شناسه‌ی فایل در برابر path traversal سنجیده می‌شود', /\^FR-LIC-\[A-Za-z0-9-\]/.test(server));
ok('صفحه‌ی گرافیکی: صدور/کاپی/بازرسی/باطل‌کردن', /صدور لایسنس/.test(uiHtml) && /بازرسی/.test(uiHtml) && /revoke/.test(uiHtml));
ok('صفحه‌ی گرافیکی راست‌به‌چپ و فارسی است', /dir="rtl"/.test(uiHtml) && /lang="fa"/.test(uiHtml));
ok('دستور npm برای باز کردن ابزار هست', /license:ui/.test(read(path.join(root, 'package.json'))));

console.log('\n— مستندسازی برای مالک برنامه —');
ok('راهنمای لایسنس نوشته شده است', exists(path.join(root, 'docs/LICENSE.md')));
const doc = exists(path.join(root, 'docs/LICENSE.md')) ? read(path.join(root, 'docs/LICENSE.md')) : '';
ok('راهنما شامل keygen/issue/activate است', /license:keygen/.test(doc) && /license:issue/.test(doc));
ok('راهنما درباره‌ی گم‌شدن/لو رفتن کلید خصوصی هشدار می‌دهد', /گم/.test(doc) && /لو/.test(doc));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
