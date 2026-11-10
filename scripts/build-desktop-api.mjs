/**
 * Prepares everything the Tauri installer needs on disk:
 *
 *   src-tauri/api/app.js        compiled NestJS API (+ Prisma client, node_modules)
 *   src-tauri/api/node.exe      the Node runtime (Windows) so the user needs nothing installed
 *   src-tauri/api/package.json  { "type": "commonjs" }
 *
 * Usage:
 *   npm run package:api                 # all platforms, downloads the Node runtime
 *   node scripts/build-desktop-api.mjs --no-node   # reuse the system Node
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = path.join(root, 'apps/api');
const out = path.join(root, 'src-tauri/api');
const noNode = process.argv.includes('--no-node');

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

/**
 * استخراج «node.exe» از فایل zip رسمی نود — بدون نیاز به unzip یا tar.
 *
 * ویندوز به‌صورت پیش‌فرض `unzip` ندارد و `tar` هم روی همه نسخه‌ها نیست؛
 * پس ساختار ZIP (central directory + deflate) را خودمان می‌خوانیم.
 * اگر بعداً ساختار عوض شد، خطای روشن برمی‌گرداند تا پیام گمراه‌کننده ندهد.
 */
function extractFileFromZip(zipPath, wantedSuffix, destPath) {
  const buf = fs.readFileSync(zipPath);
  // پیدا کردن End Of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP نامعتبر است (EOCD پیدا نشد)');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('ZIP نامعتبر است (central directory)');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    if (name.endsWith(wantedSuffix)) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      const out = method === 0 ? data : zlib.inflateRawSync(data);
      fs.writeFileSync(destPath, out);
      return name;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`فایل ${wantedSuffix} در ZIP پیدا نشد`);
}


console.log('▶ 1/5 ساخت API (nest build)…');
run('npx nest build', apiSrc);

console.log('▶ 2/5 خالی کردن پوشه بسته‌بندی…');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

console.log('▶ 3/5 کاپی فایل‌های اجرایی + Prisma + node_modules…');
fs.cpSync(path.join(apiSrc, 'dist'), out, { recursive: true });          // dist/* → api/*
fs.renameSync(path.join(out, 'main.js'), path.join(out, 'app.js'));
// Prisma client is generated into src/generated — it is inside dist already,
// but the runtime packages must be copied as plain folders.
const modules = ['@prisma/client', '@prisma/adapter-libsql', '@libsql/client', 'jalaali-js', '@libsql'];
const nm = path.join(out, 'node_modules');
fs.mkdirSync(nm, { recursive: true });
// the NestJS runtime itself must ship too (the compiled app.js requires them)
const nestModules = ['@nestjs', 'express', 'rxjs', 'reflect-metadata', 'class-validator',
  'class-transformer', 'body-parser', 'cors', 'router', 'serve-static', 'send', 'qs',
  'path-to-regexp', 'cookie', 'debug', 'ms', 'etag', 'fresh', 'range-parser', 'parseurl',
  'accepts', 'depd', 'content-disposition', 'content-type', 'encodeurl', 'escape-html',
  'finalhandler', 'http-errors', 'merge-descriptors', 'methods', 'on-finished', 'proxy-addr',
  'setprototypeof', 'statuses', 'type-is', 'utils-merge', 'vary', 'array-flatten', 'forwarded',
  'ipaddr.js', 'mime-types', 'mime-db', 'negotiator', 'raw-body', 'unpipe', 'bytes',
  'iconv-lite', 'safer-buffer', 'media-typer', 'toidentifier', 'http-errors', 'ee-first',
  'side-channel', 'object-inspect', 'gopd', 'has-symbols', 'function-bind',
  'get-intrinsic', 'hasown', 'es-errors', 'call-bind-apply-helpers', 'dunder-proto',
  'es-define-property', 'es-object-atoms', 'math-intrinsics', 'call-bound',
  'side-channel-list', 'side-channel-map', 'side-channel-weakmap'];
// only the libsql binaries for the platform(s) we actually ship
const keepBinary = (p) => /^(@libsql|@prisma)\/(linux|darwin|win32|debian|rhel|freebsd|android|wasm)/.test(p);

for (const m of [...modules, ...nestModules]) {
  const from = path.join(root, 'node_modules', m);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(nm, m), { recursive: true, dereference: true });
}
for (const m of ['@prisma', '@libsql']) {
  // copy the supporting packages that live in the same scope folder
  const src = path.join(root, 'node_modules', m);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.join(nm, m), { recursive: true });
  for (const sub of fs.readdirSync(src)) {
    if (modules.includes(`${m}/${sub}`)) continue;
    const from = path.join(src, sub);
    if (!fs.statSync(from).isDirectory()) continue;
    if (/-(linux|darwin|win32|android|freebsd)-(arm64|arm|x64|x86)/.test(sub) && !/^libsql-/.test(sub)) continue;
    fs.cpSync(from, path.join(nm, m, sub), { recursive: true, dereference: true });
  }
}
// the built React app is served by the same local process
// tauri.conf.json منابع «binaries/*» را اعلام می‌کند؛ اگر پوشه نباشد ساخت با خطا
// «glob pattern binaries/* path not found» می‌شکند. یک placeholder کم‌حجم می‌گذاریم.
const binDir = path.join(root, 'src-tauri', 'binaries');
fs.mkdirSync(binDir, { recursive: true });
fs.writeFileSync(path.join(binDir, 'README.txt'),
  'این پوشه برای فایل‌های اجرایی جانبی (sidecar) است. ساخت نصب‌کننده به آن نیاز دارد.\n');

const webDist = path.join(root, 'apps/web/dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  fs.cpSync(webDist, path.join(out, 'web'), { recursive: true });
} else {
  console.warn('⚠ apps/web/dist پیدا نشد — اول `npm run build -w @farday/web` را اجرا کنید.');
}
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'farday-api', version: '0.1.0', private: true, type: 'commonjs' }, null, 2));

if (!noNode) {
  console.log('▶ 4/5 دانلود runtime نود برای ویندوز (نسخه بدون نصب)…');
  const ver = process.versions.node;
  const zipName = `node-v${ver}-win-x64.zip`;
  const url = `https://nodejs.org/dist/v${ver}/${zipName}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-node-'));
  const zip = path.join(tmp, zipName);
  try {
    run(`curl -fL --retry 3 --connect-timeout 20 -o "${zip}" "${url}"`, tmp);
    if (!fs.existsSync(zip) || fs.statSync(zip).size < 5_000_000) throw new Error('دانلود ناقص بود');
    const found = extractFileFromZip(zip, 'node.exe', path.join(out, 'node.exe'));
    console.log(`   ✔ node.exe کاپی شد (${found})`);
  } catch {
    // بدون انترنت هم باید بشود نصب‌کننده ساخت — فقط Node روی سیستم لازم می‌شود
    console.log('   ⚠ دانلود Node انجام نشد (انترنت نیست یا nodejs.org بسته است).');
    console.log('     نصب‌کننده ساخته می‌شود، ولی کمپیوتر مقصد باید Node.js نصب داشته باشد.');
    console.log('     راه‌حل کامل: یک بار با انترنت همین دستور را اجرا کنید، یا فایل node-v' + ver + '-win-x64.zip');
    console.log('     را دستی در ' + path.join(out, 'node.exe') + ' کاپی کنید.');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
} else {
  console.log('▶ 4/5 (بدون کاپی نود — از نود نصب‌شده سیستم استفاده می‌شود)');
}

console.log('▶ 5/5 حذف فایل‌های نقشه و تست…');
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(map|ts|tsbuildinfo)$/.test(f)) fs.rmSync(p, { force: true });
  }
};
walk(out);

const size = (dir) => {
  let s = 0;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    s += st.isDirectory() ? size(p) : st.size;
  }
  return s;
};
const hasNode = fs.existsSync(path.join(out, 'node.exe'));
console.log(`✔ آماده است — ${out}  (${(size(out) / 1024 / 1024).toFixed(1)} MB)`);
if (!hasNode && process.platform !== 'win32') {
  console.log('   ℹ node.exe فقط برای نصب‌کننده ویندوز لازم است.');
} else if (!hasNode) {
  console.log('   ⚠ node.exe داخل بسته نیست → کمپیوتر مقصد باید Node.js داشته باشد.');
  console.log('     برای بسته مستقل، یک بار با انترنت همین دستور را اجرا کنید.');
}
console.log('   حالا بسازید:  npx tauri build');
