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
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'src-tauri', 'api', 'app.js');
const test = path.join(root, 'apps', 'api', 'test', 'scenario.test.js');

const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

// Exercise the explicit ZIP path using the real running Windows executable.
// A minimal stored ZIP is enough to test extraction and post-packaging stages.
if (process.platform === 'win32' && process.arch === 'x64') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-node-zip-test-'));
  try {
    const exe = fs.readFileSync(process.execPath);
    const name = Buffer.from('node-vtest-win-x64/node.exe');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(exe.length, 18); local.writeUInt32LE(exe.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(exe.length, 20); central.writeUInt32LE(exe.length, 24); central.writeUInt16LE(name.length, 28);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(local.length + name.length + exe.length, 16);
    const zip = path.join(tmp, 'node test.zip');
    fs.writeFileSync(zip, Buffer.concat([local, name, exe, central, name, eocd]));
    const explicit = run(process.execPath, [path.join(root, 'scripts', 'build-desktop-api.mjs'), '--require-node', '--offline', '--node-zip', zip]);
    const key = path.join(root, 'src-tauri', 'api', 'public-key', 'farday-public.b64');
    if (explicit.status !== 0 || !fs.existsSync(key)) {
      console.error('⛔ بسته‌بندی از ZIP یا مرحلهٔ کلید عمومی پس از آن شکست خورد.');
      process.exit(1);
    }
    console.log('✔ ZIP محلی استخراج شد و مراحل بعدی بسته‌بندی هم اجرا شدند.');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log('\n▶ ساخت بسته‌ی نصب‌کننده (src-tauri/api)…');
const packArgs = process.platform === 'win32' && process.arch === 'x64' ? ['--require-node', '--offline'] : ['--no-node'];
const pack = run(process.execPath, [path.join(root, 'scripts', 'build-desktop-api.mjs'), ...packArgs]);
if (pack.status !== 0) {
  console.log('⛔ بسته‌بندی ناموفق بود.');
  process.exit(1);
}

if (!fs.existsSync(entry)) {
  console.log(`⛔ ${entry} ساخته نشد.`);
  process.exit(1);
}

const bundledNode = path.join(root, 'src-tauri', 'api', 'node.exe');
if (packArgs.includes('--require-node')) {
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (!fs.existsSync(bundledNode) || sha(bundledNode) !== sha(process.execPath)) {
    console.error('⛔ Node همراه بسته با Node نصب‌شده یکسان نیست.');
    process.exit(1);
  }
  console.log('✔ Node نصب‌شده بدون دانلود همراه بسته شد و هش آن یکسان است.');
}
console.log('\n▶ اجرای آزمون شبیه‌سازی روی بسته نهایی…');
const res = run(process.execPath, [test], { FD_API_ENTRY: entry, ...(packArgs.includes('--require-node') ? { FD_NODE_RUNTIME: bundledNode } : {}) });
process.exit(res.status ?? 1);
