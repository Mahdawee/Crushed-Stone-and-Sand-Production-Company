/**
 * آزمایش همان چیزی که داخل نصب‌کننده می‌رود.
 *
 *   node scripts/test-packaged.mjs
 *
 * چرا: بعضی خطاها فقط در بسته‌ی نهایی پیدا می‌شوند — مثلاً یک وابستگی که
 * `apps/api/dist` لازم دارد ولی موقع بسته‌بندی کاپی نشده. این اسکریپت:
 *   ۱) بسته‌ی `src-tauri/api` را از نو می‌سازد (بدون دانلود node، سریع)،
 *   ۲) همان آزمون شبیه‌سازی شش‌ماهه را روی `src-tauri/api/app.js` اجرا می‌کند.
 *
 * اگر این سبز باشد، برنامه‌ی نصب‌شده هم همان کد را با همان وابستگی‌ها دارد.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'src-tauri', 'api', 'app.js');
const test = path.join(root, 'apps', 'api', 'test', 'scenario.test.js');

const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

console.log('\n▶ ساخت بسته‌ی نصب‌کننده (src-tauri/api)…');
const pack = run(process.execPath, [path.join(root, 'scripts', 'build-desktop-api.mjs'), '--no-node']);
if (pack.status !== 0) {
  console.log('⛔ بسته‌بندی ناموفق بود.');
  process.exit(1);
}

if (!fs.existsSync(entry)) {
  console.log(`⛔ ${entry} ساخته نشد.`);
  process.exit(1);
}

console.log('\n▶ اجرای آزمون شبیه‌سازی روی بسته نهایی…');
const res = run(process.execPath, [test], { FD_API_ENTRY: entry });
process.exit(res.status ?? 1);
