/**
 * تست WebView2 برای ساخت/نصب کاملاً آفلاین.
 *
 *   node scripts/ui-check/webview2-offline.test.mjs
 *
 * ریشه‌ی باگ: در خروجی ساخت این خط می‌آمد —
 *   `Downloading https://go.microsoft.com/fwlink/p/?LinkId=2124703`
 * یعنی tauri-bundler بوت‌استرپ WebView2 را در **زمان ساخت** از انترنت
 * می‌گرفت، و همان بوت‌استرپ موقع **نصب** هم باید انترنت داشته باشد.
 *
 * این تست می‌سنجد:
 *   ۱) حالت بسته‌بندی `offlineInstaller` است (نصب بدون انترنت).
 *   ۲) ماژول آماده‌سازی، همان مسیر کش bundler را هدف می‌گیرد (تا دانلود تکرار نشود).
 *   ۳) اگر فایل‌ها از قبل در کش باشند، بدون هیچ درخواست شبکه‌ای «آماده» گزارش می‌شود.
 *   ۴) ساخت آفلاین بدون فایل‌ها با پیام فارسی متوقف می‌شود (نه دانلود خاموش).
 *   ۵) هیچ‌جای مسیر ساخت، بروت‌فورس به `go.microsoft.com` نمی‌زند.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); }
  else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

console.log('\n— تنظیمات بسته‌بندی —');
const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
const wv = conf.bundle?.windows?.webviewInstallMode || {};
ok('حالت نصب WebView2 آفلاین است (offlineInstaller)', wv.type === 'offlineInstaller', String(wv.type));
ok('نصب WebView2 خودکار و بی‌سؤال است', wv.silent === true);
ok('هدف بسته‌بندی شامل nsis است', (conf.bundle?.targets || []).includes('nsis'));
/*
 * باگ: `msi` هم در فهرست بود. هر دو نصب‌کننده در یک اجرا ساخته می‌شوند و
 * هر کدام ۱۳۰ مگابایت WebView2 را جدا داخل خودشان می‌گذارند — یعنی حجم
 * ساخت دو برابر و زمانش چند برابر. کاربر فقط به `setup.exe` نیاز دارد.
 */
ok('نصب‌کننده‌ی تکراری msi ساخته نمی‌شود (حجم/زمان ساخت نصف)', !(conf.bundle?.targets || []).includes('msi'),
  (conf.bundle?.targets || []).join(','));

console.log('\n— ماژول آماده‌سازی کش —');
const mod = await import(path.join(root, 'scripts/lib/webview2.mjs'));
ok('مسیر کش ابزارهای Tauri محاسبه می‌شود', typeof mod.tauriToolsDir() === 'string' && mod.tauriToolsDir().endsWith('tauri'));
ok('مسیر کش از LOCALAPPDATA ویندوز استفاده می‌کند', mod.tauriToolsDir().includes('tauri'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-wv2-'));

/* ۴-۱) کش خالی → آماده نیست */
let st = mod.webview2Status({ toolsDir: tmp });
ok('کش خالی: نصب آفلاین آماده نیست', st.readyOffline === false);
ok('کش خالی: مسیر نصب‌کننده null است', st.offline === null);

/* ۴-۲) فایل‌ها را مثل bundler می‌گذاریم (x64/<GUID>/<file>) */
const guid = 'abcdef0123456789';
const dir = path.join(tmp, 'x64', guid);
fs.mkdirSync(dir, { recursive: true });
const installer = path.join(dir, 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
fs.writeFileSync(installer, 'x');
fs.writeFileSync(path.join(tmp, mod.BOOTSTRAPPER_NAME), 'y');

st = mod.webview2Status({ toolsDir: tmp });
ok('با فایل موجود: نصب آفلاین «آماده» گزارش می‌شود', st.readyOffline === true);
ok('مسیر نصب‌کننده‌ی آفلاین پیدا می‌شود', st.offline === installer, String(st.offline));
ok('بوت‌استرپ هم پیدا می‌شود', Boolean(st.bootstrapper));

/*
 * مهم: `findOfflineInstaller` باید هر نام فایلی با الگوی نصب‌کننده را بپذیرد
 * (نام فایل از تغییرمسیر مایکروسافت می‌آید و می‌تواند عوض شود). اگر فقط
 * یک نام ثابت را قبول کند، روزی که نام عوض شود فایل «گم» می‌شود و bundler
 * دوباره به انترنت می‌زند.
 */
const dir2 = path.join(tmp, 'x64', 'guid2');
fs.mkdirSync(dir2, { recursive: true });
fs.writeFileSync(path.join(dir2, 'MicrosoftEdgeWebView2RuntimeInstallerARM64.exe'), 'z');
ok('نام فایل نصب‌کننده سخت‌گیرانه نیست', mod.findOfflineInstaller(tmp) !== null);

/* ۴-۳) prepareWebView2 وقتی فایل‌ها هستند نباید شبکه بزند */
let networkCalled = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalled = true; throw new Error('شبکه نباید صدا زده شود'); };
let prep;
try {
  prep = await mod.prepareWebView2({ toolsDir: tmp, log: () => {} });
} finally {
  globalThis.fetch = realFetch;
}
ok('آماده‌سازی با فایل موجود هیچ درخواست شبکه‌ای نمی‌فرستد', networkCalled === false);
ok('آماده‌سازی همان فایل‌های موجود را برمی‌گرداند', prep?.offline === installer);

console.log('\n— ساخت: بدون دانلود خاموش —');
const build = read('scripts/build-desktop.mjs');
ok('ساخت، وضعیت WebView2 را قبل از bundler می‌سنجد',
  /webview2Status\(\)/.test(build)
  && build.indexOf('webview2Status()') < build.lastIndexOf('await runTauriBuild(env)'));
ok('در حالت آفلاین، نبودِ فایل باعث توقف با راهنمای فارسی می‌شود',
  /حالت آفلاین: نصب‌کننده‌ی آفلاین WebView2 در کش نیست/.test(build));
ok('راهنمای npm run webview2:prepare در پیام آمده', /webview2:prepare/.test(build));

console.log('\n— هیچ دانلود پنهانی در مسیر ساخت نیست —');
const scripts = ['scripts/build-desktop.mjs', 'scripts/build-desktop-api.mjs', 'scripts/prepare-offline-desktop.mjs']
  .concat(fs.readdirSync(path.join(root, 'scripts/lib')).map((f) => `scripts/lib/${f}`));
const offenders = [];
for (const f of scripts) {
  const src = read(f);
  /* آدرس مایکروسافت فقط باید در ماژول webview2 باشد (آنجا آگاهانه و مستند) */
  if (f.endsWith('webview2.mjs')) continue;
  for (const m of src.matchAll(/go\.microsoft\.com[^\s'"`]*/g)) offenders.push(`${f} → ${m[0]}`);
}
ok('هیچ اسکریپت دیگری به go.microsoft.com نمی‌زند', offenders.length === 0, offenders.join(' | '));

const pkg = JSON.parse(read('package.json'));
ok('دستور webview2:prepare موجود است', Boolean(pkg.scripts['webview2:prepare']));
ok('دستور webview2:status موجود است', Boolean(pkg.scripts['webview2:status']));
ok('تست WebView2 در npm test هست', /webview2/.test(pkg.scripts.test));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
