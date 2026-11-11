/**
 * WebView2 — آماده‌سازی آفلاین برای ساخت و نصب.
 *
 * ## خطایی که این فایل حل می‌کند
 * کاربر در خروجی `npm run desktop:build` این خط را دید:
 *
 * ```
 * Downloading https://go.microsoft.com/fwlink/p/?LinkId=2124703
 * ```
 *
 * این یک «باگ ظاهری» نیست؛ خودِ **tauri-bundler** این دانلود را انجام می‌دهد.
 * در `tauri-bundler/src/bundle/windows/util.rs`:
 *
 * ```rust
 * pub fn download_webview2_bootstrapper(base_path) {
 *   let file_path = base_path.join("MicrosoftEdgeWebview2Setup.exe");
 *   if !file_path.exists() { std::fs::write(&file_path, download(WEBVIEW2_BOOTSTRAPPER_URL)?)?; }
 * }
 * ```
 *
 * یعنی در حالت `embedBootstrapper`، فایل بوت‌استرپ **در زمان ساخت** از
 * `go.microsoft.com` دانلود می‌شود و داخل نصب‌کننده گذاشته می‌شود (تنها
 * ۱٫۸ مگابایت). تازه همان بوت‌استرپ، اگر کمپیوتر مقصد WebView2 نداشته باشد،
 * **موقع نصب** هم باید از انترنت دانلود کند. پس با `embedBootstrapper`
 * برنامه هنوز دو جای وابسته به انترنت است — خلاف قاعده‌ی «کمپیوتر مقصد
 * انترنت ندارد».
 *
 * ## راه‌حل
 * `offlineInstaller` (مستند رسمی Tauri): نصب‌کننده‌ی کامل آفلاین WebView2
 * (~۱۳۰ مگابایت) داخل بسته‌ی ما می‌رود و نصب **بدون هیچ دانلودی** انجام
 * می‌شود. نوشته‌ی رسمی: «offlineInstaller | Requires Internet Connection? **No**».
 *
 * ## چطور بدون انترنت روی کمپیوتر سازنده؟
 * tauri-bundler قبل از دانلود، اگر فایل از قبل موجود باشد دانلود نمی‌کند
 * (`if !file_path.exists()`). پس کافی است آن دو فایل را **یک بار** با
 * انترنت گرفت و در پوشه‌ی کش گذاشت؛ این فایل همان مسیرها را می‌سازد:
 *
 *   <cache>/tauri/tauri/…  ← موجود نیست
 *   <cache>/tauri/MicrosoftEdgeWebview2Setup.exe                       (embedBootstrapper)
 *   <cache>/tauri/<arch>/<GUID>/MicrosoftEdgeWebView2RuntimeInstallerX64.exe  (offlineInstaller)
 *
 * ⚠ کش tauri برای هر اجرای bundler خالی **نمی‌شود** (برخلاف `target/release/nsis`
 * که پاک می‌شود) — `tools_directory()` یک مسیر پایدار در کش کاربر است.
 *
 * دستورها:
 *   npm run webview2:prepare     # یک بار با انترنت: گرفتن بوت‌استرپ + نصب‌کننده‌ی آفلاین
 *   npm run webview2:status      # آیا فایل‌ها آماده‌اند؟ (بدون انترنت)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WEBVIEW2_BOOTSTRAPPER_URL = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
/** نصب‌کننده‌ی آفلاین x64 (همان ثابتی که tauri-bundler استفاده می‌کند) */
export const WEBVIEW2_OFFLINE_X64_URL = 'https://go.microsoft.com/fwlink/?linkid=2124701';
export const BOOTSTRAPPER_NAME = 'MicrosoftEdgeWebview2Setup.exe';
export const OFFLINE_INSTALLER_NAME = 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe';

/**
 * مسیر کش ابزارهای Tauri — همان چیزی که `tools_directory()` در bundler برمی‌گرداند
 * (روی ویندوز: `%LOCALAPPDATA%`, روی لینوکس: `~/.cache`).
 */
export function tauriToolsDir() {
  const cache = process.env.LOCALAPPDATA
    || process.env.XDG_CACHE_HOME
    || (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.cache'));
  return path.join(cache, 'tauri');
}

/**
 * مسیری که bundler برای نصب‌کننده‌ی آفلاین می‌سازد.
 *
 * ساختار: `<tools>/<arch>/<GUID>/<filename>` که GUID از تغییرمسیر
 * `go.microsoft.com` می‌آید و بین نسخه‌ها عوض می‌شود. چون نمی‌توان پیش‌بینی‌اش
 * کرد، هر پوشه‌ای که در `<tools>/x64/*\/` فایل نصب‌کننده داشته باشد معتبر است
 * و همان را گزارش/استفاده می‌کنیم.
 */
export function findOfflineInstaller(toolsDir = tauriToolsDir()) {
  const archDir = path.join(toolsDir, 'x64');
  if (!fs.existsSync(archDir)) return null;
  for (const guid of fs.readdirSync(archDir)) {
    const dir = path.join(archDir, guid);
    if (!fs.statSync(dir).isDirectory()) continue;
    const match = fs.readdirSync(dir).find((f) => /WebView2RuntimeInstaller|WebView2.*\.exe$/i.test(f));
    if (match) return path.join(dir, match);
  }
  return null;
}

export function findBootstrapper(toolsDir = tauriToolsDir()) {
  const p = path.join(toolsDir, BOOTSTRAPPER_NAME);
  return fs.existsSync(p) ? p : null;
}

/** وضعیت آمادگی آفلاین */
export function webview2Status(opts = {}) {
  const toolsDir = opts.toolsDir || tauriToolsDir();
  const bootstrapper = findBootstrapper(toolsDir);
  const offline = findOfflineInstaller(toolsDir);
  return {
    toolsDir,
    bootstrapper,
    offline,
    /* نصب آفلاین بدون انترنت کامل است */
    readyOffline: Boolean(offline),
    readyBuild: Boolean(offline || bootstrapper),
  };
}

/** دانلود یک URL به فایل (با گزارش پیشرفت ساده) */
async function downloadTo(url, filePath, label) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`دانلود ${label} ناموفق بود: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 * 1024) throw new Error(`فایل ${label} خیلی کوچک است (${buf.length} بایت) — احتمالاً صفحه‌ی خطا آمده`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  return { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

/**
 * گرفتن فایل‌های WebView2 برای ساختِ آفلاین.
 *
 * @param {{ force?: boolean, offlineOnly?: boolean, toolsDir?: string, log?: Function }} opts
 */
export async function prepareWebView2(opts = {}) {
  const log = opts.log || (() => {});
  const toolsDir = opts.toolsDir || tauriToolsDir();
  fs.mkdirSync(toolsDir, { recursive: true });
  const out = { toolsDir, bootstrapper: null, offline: null, downloaded: [] };

  /* ۱) نصب‌کننده‌ی آفلاین — همان چیزی که نصب بدون انترنت را ممکن می‌کند */
  out.offline = findOfflineInstaller(toolsDir);
  if (out.offline && !opts.force) {
    log('نصب‌کننده‌ی آفلاین WebView2 از قبل آماده است — دانلود لازم نیست.');
  } else if (!opts.offlineOnly) {
    log(`دریافت نصب‌کننده‌ی آفلاین WebView2 (~۱۳۰ مگابایت) …`);
    const target = path.join(toolsDir, 'x64', 'offline', OFFLINE_INSTALLER_NAME);
    const info = await downloadTo(WEBVIEW2_OFFLINE_X64_URL, target, 'WebView2 offline installer');
    out.offline = target;
    out.downloaded.push({ file: target, ...info });
    log(`✔ ${OFFLINE_INSTALLER_NAME} — ${(info.bytes / 1048576).toFixed(1)} مگابایت`);
  }

  /* ۲) بوت‌استرپ کوچک — برای حالت embedBootstrapper و برای msbuild/wix */
  out.bootstrapper = findBootstrapper(toolsDir);
  if (out.bootstrapper && !opts.force) {
    log('بوت‌استرپ WebView2 از قبل آماده است — دانلود لازم نیست.');
  } else if (!opts.skipBootstrapper) {
    log('دریافت بوت‌استرپ WebView2 (~۱٫۸ مگابایت) …');
    const target = path.join(toolsDir, BOOTSTRAPPER_NAME);
    const info = await downloadTo(WEBVIEW2_BOOTSTRAPPER_URL, target, 'WebView2 bootstrapper');
    out.bootstrapper = target;
    out.downloaded.push({ file: target, ...info });
    log(`✔ ${BOOTSTRAPPER_NAME} — ${(info.bytes / 1048576).toFixed(2)} مگابایت`);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */
const isCli = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('lib/webview2.mjs');
if (isCli) {
  const args = process.argv.slice(2);
  const C = {
    ok: (s) => `\x1b[32m${s}\x1b[0m`, bad: (s) => `\x1b[31m${s}\x1b[0m`,
    warn: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
  };
  const st = webview2Status();

  if (args.includes('--status') || args.includes('status')) {
    console.log(`\n${C.bold('وضعیت WebView2 برای ساخت آفلاین')}`);
    console.log(`  پوشه‌ی کش ابزارها: ${C.dim(st.toolsDir)}`);
    console.log(`  ${st.offline ? C.ok('✔') : C.warn('⚠')} نصب‌کننده‌ی آفلاین: ${st.offline || 'نیست'}`);
    console.log(`  ${st.bootstrapper ? C.ok('✔') : C.warn('⚠')} بوت‌استرپ: ${st.bootstrapper || 'نیست'}`);
    console.log(st.readyOffline
      ? C.ok('\n  نصب بدون انترنت ممکن است (offlineInstaller).\n')
      : C.warn('\n  برای نصب بدون انترنت یک بار بزنید: npm run webview2:prepare\n'));
    process.exit(0);
  }

  console.log(`\n${C.bold('آماده‌سازی WebView2 برای ساخت آفلاین')}`);
  console.log(C.dim(`  پوشه: ${st.toolsDir}\n`));
  try {
    await prepareWebView2({ force: args.includes('--force'), log: (m) => console.log(`  ${m}`) });
    console.log(C.ok('\n✔ آماده است — ساخت بعدی بدون دانلود WebView2 انجام می‌شود.\n'));
  } catch (e) {
    console.log(C.bad(`\n⛔ ${e.message}`));
    console.log(C.dim('  این مرحله فقط یک بار انترنت لازم دارد. اگر کمپیوتر سازنده هم آفلاین است،'));
    console.log(C.dim('  فایل‌ها را از یک کمپیوتر دیگر بگیرید و در همین پوشه کاپی کنید.\n'));
    process.exit(1);
  }
}
