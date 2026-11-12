import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertWindowsExe, copyInstalledNode } from '../lib/node-runtime.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-test-'));
let pass = 0, fail = 0;
const ok = (name, value) => { console.log(`  ${value ? '✔' : '✘'} ${name}`); value ? pass++ : fail++; };
try {
  const source = path.join(dir, 'node.exe'), dest = path.join(dir, 'out.exe');
  const fake = Buffer.alloc(2048); fake.write('MZ'); fake.writeUInt32LE(128, 0x3c); fake.write('PE\0\0', 128, 'latin1'); fake.writeUInt16LE(0x8664, 132);
  fs.writeFileSync(source, fake);
  const good = { platform: 'win32', arch: 'x64', version: '22.23.2', execPath: source };
  ok('Node x64 سازگار از دیسک کپی می‌شود', copyInstalledNode(dest, good) && fs.readFileSync(dest).equals(fake));
  fs.rmSync(dest);
  ok('سیستم غیر ویندوز کپی نمی‌شود', !copyInstalledNode(dest, { ...good, platform: 'linux' }) && !fs.existsSync(dest));
  ok('معماری غیر x64 کپی نمی‌شود', !copyInstalledNode(dest, { ...good, arch: 'arm64' }) && !fs.existsSync(dest));
  ok('نسخه ناسازگار رد می‌شود', !copyInstalledNode(dest, { ...good, version: '22.11.0' }) && !fs.existsSync(dest));
  fake.writeUInt16LE(0x14c, 132); fs.writeFileSync(source, fake);
  let rejected = false; try { copyInstalledNode(dest, good); } catch { rejected = true; }
  ok('فایل اجرایی ۳۲ بیتی رد می‌شود', rejected && !fs.existsSync(dest));
  fs.writeFileSync(source, 'bad'); rejected = false; try { assertWindowsExe(source); } catch { rejected = true; }
  ok('فایل ناقص رد می‌شود', rejected);
  if (process.platform === 'win32' && process.arch === 'x64') {
    ok('Node واقعی اجراکنندهٔ ویندوز بدون شبکه کپی می‌شود', copyInstalledNode(dest) && fs.readFileSync(dest).equals(fs.readFileSync(process.execPath)));
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${fail ? '⛔' : '✅'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail ? 1 : 0);
