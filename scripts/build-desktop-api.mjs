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
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = path.join(root, 'apps/api');
const out = path.join(root, 'src-tauri/api');
const noNode = process.argv.includes('--no-node');

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

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
  run(`curl -fL --retry 3 -o "${zip}" "${url}"`, tmp);
  run(`unzip -o -q "${zip}" -d "${tmp}"`, tmp);
  const exe = path.join(tmp, `node-v${ver}-win-x64`, 'node.exe');
  fs.copyFileSync(exe, path.join(out, 'node.exe'));
  console.log('   ✔ node.exe کاپی شد');
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
console.log(`✔ آماده است — ${out}  (${(size(out) / 1024 / 1024).toFixed(1)} MB)`);
console.log('   حالا بسازید:  npx tauri build');
