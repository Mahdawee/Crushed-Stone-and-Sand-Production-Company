/**
 * Desktop build with npm and Cargo offline modes enabled. Reuses the normal desktop builder so staging,
 * signing-key checks, WebView2 preflight and bundle verification are identical.
 *
 * npm run desktop:build:offline
 * npm run desktop:build:offline -- "D:\\path\\node-v22-win-x64.zip"
 *
 * Dependencies, Cargo crates and Tauri tools must already be available locally.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const positional = args.filter((a) => a && !a.startsWith('-'));
if (positional.length > 1) {
  console.error('⛔ فقط یک مسیر ZIP نود بدهید.');
  process.exit(1);
}
const zip = positional[0] ? path.resolve(positional[0]) : '';
if (zip && (!fs.existsSync(zip) || !fs.statSync(zip).isFile())) {
  console.error(`⛔ فایل ZIP پیدا نشد: ${zip}`);
  process.exit(1);
}
const env = { ...process.env, FARDAY_OFFLINE: '1', CARGO_NET_OFFLINE: 'true', npm_config_offline: 'true' };
if (zip) env.FD_NODE_ZIP = zip;
console.log('ℹ ساخت آفلاین: از Node ویندوز نصب‌شده یا ZIP محلی و وابستگی‌های آماده استفاده می‌شود.');
const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-desktop.mjs'), '--offline'], {
  cwd: root, stdio: 'inherit', env,
});
if (result.error) console.error(`⛔ اجرای ساخت ممکن نشد: ${result.error.message}`);
process.exit(result.status ?? 1);
