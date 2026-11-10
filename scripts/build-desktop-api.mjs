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
/**
 * حالت سخت‌گیر: اگر node.exe همراه بسته نباشد، ساخت **متوقف** می‌شود.
 *
 * چرا: بدترین حالت برای نصب‌کننده این است که روی کمپیوتر کاربر، بی‌خبر از
 * همه، Node.js لازم شود. نسخه‌ی نصب‌شده باید «بدون نصب هیچ چیز اضافی» کار
 * کند، پس `npm run desktop:build` همیشه سخت‌گیر اجرا می‌شود
 * (`--require-node`). فقط تست‌های داخل مخزن از حالت سست استفاده می‌کنند.
 */
const requireNode = process.argv.includes('--require-node');

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
/*
 * کاپی بسته‌ها — از روی گراف واقعی وابستگی‌ها (نه فهرست دستی).
 *
 * قبلاً نام بسته‌ها یکی‌یکی نوشته شده بود؛ با یک وابستگی تازه، نصب‌کننده با
 * «Cannot find module» بالا نمی‌آمد و کاربر فقط «برنامه باز نمی‌شود» می‌دید.
 * حالا از `apps/api/package.json` شروع می‌کنیم و هر وابستگی را همان‌جوری
 * پیدا می‌کنیم که Node پیدا می‌کند (بالا رفتن در درخت node_modules).
 * بسته‌های مخصوص توسعه (typescript، ابزارهای build، cli و…) کاپی نمی‌شوند.
 */
const nm = path.join(out, 'node_modules');
fs.mkdirSync(nm, { recursive: true });

const SKIP = [
  /^@nestjs\/(cli|schematics|testing)$/, /^typescript$/, /^@types\//,
  /^@typescript-eslint\//, /^eslint/, /^prettier$/, /^jest$/, /^ts-jest$/,
  /^@swc\//, /^@tauri-apps\//, /^vite$/, /^@vitejs\//, /^concurrently$/,
  /^cross-env$/, /^jsdom$/, /^vitest$/, /^@angular-devkit\//, /^webpack/,
  /^@prisma\/studio-core-licensed$/, /^@prisma\/fetch-engine$/,
  /^@prisma\/engines$/, /^prisma$/, /^@prisma\/dev$/, /^@prisma\/config$/,
  /^(react|react-dom|recharts|react-router|react-router-dom|@radix-ui\/.*)$/,
];

const resolveFrom = (fromDir, name) => {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const graph = new Map();      // realpath → source dir
const queue = [apiSrc];
const seenDirs = new Set();
while (queue.length) {
  const pkgDir = queue.shift();
  if (seenDirs.has(pkgDir)) continue;
  seenDirs.add(pkgDir);
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); }
  catch { continue; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
  for (const name of Object.keys(deps)) {
    if (SKIP.some((re) => re.test(name))) continue;
    const dir = resolveFrom(pkgDir, name);
    if (!dir) continue;
    let real = dir;
    try { real = fs.realpathSync(dir); } catch { /* ignore */ }
    if (!graph.has(real)) {
      graph.set(real, dir);
      queue.push(dir);
    }
  }
}

let copied = 0;
for (const [real, dir] of graph) {
  /* نگه‌داشتن ساختار scope: همیشه مسیر داخل node_modules را حفظ می‌کنیم */
  const rel = real.split(/node_modules[\\/]/).pop();
  const dest = path.join(nm, rel);
  if (fs.existsSync(dest)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(dir, dest, { recursive: true, dereference: true });
  copied++;
}
console.log(`   ↳ ${copied} بسته کاپی شد`);

/*
 * باینری‌های libSQL: نصب‌کننده برای ویندوز هم بسته‌بندی می‌شود، پس هر دو
 * باینریِ ویندوز و لینوکس لازم است (build روی هر سیستم، اجرا روی ویندوز).
 */
for (const scope of ['@libsql', '@prisma']) {
  const from = path.join(root, 'node_modules', scope);
  if (!fs.existsSync(from)) continue;
  const dest = path.join(nm, scope);
  fs.mkdirSync(dest, { recursive: true });
  for (const sub of fs.readdirSync(from)) {
    const srcSub = path.join(from, sub);
    let isDir = false;
    try { isDir = fs.statSync(srcSub).isDirectory(); } catch { /* ignore */ }
    if (!isDir) continue;
    if (SKIP.some((re) => re.test(`${scope}/${sub}`))) continue;
    const isPlatformPkg = /-(linux|darwin|win32|android|freebsd|wasi)(-(gnu|musl|msvc))?(-(arm64|arm|x64|x86))?$/.test(sub);
    if (isPlatformPkg && !/^(linux|win32|debian|wasm)/.test(sub)) continue;   // فقط ویندوز + لینوکس ساخت
    const dst = path.join(dest, sub);
    if (fs.existsSync(dst)) continue;
    fs.cpSync(srcSub, dst, { recursive: true, dereference: true });
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

const zipArgIdx = process.argv.findIndex((a) => a === '--node-zip');
const localZip = zipArgIdx > 0 ? process.argv[zipArgIdx + 1] : '';

if (!noNode) {
  const ver = process.versions.node;
  const zipName = `node-v${ver}-win-x64.zip`;

  /* مسیر آفلاین: اگر فایل ZIP نود از قبل روی دیسک است، همان استفاده می‌شود
     (نه دانلود). برای کمپیوتری که اینترنت ندارد ولی ZIP را کاپی کرده است. */
  if (localZip) {
    console.log(`▶ 4/5 استفاده از فایل ZIP محلی نود: ${localZip}`);
    try {
      const found = extractFileFromZip(localZip, 'node.exe', path.join(out, 'node.exe'));
      console.log(`   ✔ node.exe کاپی شد (${found})`);
    } catch (e) {
      console.error(`⛔ استخراج node.exe از ${localZip} انجام نشد: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }
    finish();
    process.exit(0);
  }

  console.log('▶ 4/5 دانلود runtime نود برای ویندوز (نسخه بدون نصب)…');
  const url = `https://nodejs.org/dist/v${ver}/${zipName}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-node-'));
  const zip = path.join(tmp, zipName);
  try {
    run(`curl -fL --retry 3 --connect-timeout 20 -o "${zip}" "${url}"`, tmp);
    if (!fs.existsSync(zip) || fs.statSync(zip).size < 5_000_000) throw new Error('دانلود ناقص بود');
    const found = extractFileFromZip(zip, 'node.exe', path.join(out, 'node.exe'));
    console.log(`   ✔ node.exe کاپی شد (${found})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (requireNode) {
      console.error('\n⛔ node.exe همراه بسته نشد — ساخت متوقف شد.');
      console.error('   علت: ' + msg);
      console.error('');
      console.error('   بدون node.exe برنامه روی کمپیوتری که Node.js ندارد اجرا نمی‌شود.');
      console.error('   راه‌حل‌ها (یکی را انتخاب کنید):');
      console.error(`     ۱) یک بار با انترنت دوباره بسازید:  npm run desktop:build`);
      console.error(`     ۲) فایل ZIP رسمی نود را از این آدرس بگیرید (روی هر کمپیوتری با انترنت):`);
      console.error(`        https://nodejs.org/dist/v${ver}/${zipName}`);
      console.error(`        و بعد دستور زیر را اجرا کنید (بدون نیاز به انترنت):`);
      console.error(`        node scripts/build-desktop-api.mjs --require-node --node-zip "<مسیر فایل zip>"`);
      console.error('');
      process.exit(1);
    }
    // حالت سست (تست‌های داخل مخزن): فقط هشدار
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

function finish() {
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
if (!hasNode && requireNode) {
  console.error('');
  console.error('⛔ node.exe داخل بسته نیست و حالت سخت‌گیر فعال است — ساخت متوقف شد.');
  console.error('   نصب‌کننده‌ای که node.exe ندارد روی کمپیوتری بدون Node.js باز نمی‌شود.');
  console.error('   یک بار با انترنت بسازید، یا از گزینه --node-zip استفاده کنید (راهنما در docs/INSTALL-WINDOWS.md).');
  process.exit(1);
}
if (!hasNode) {
  console.log('   ⚠ node.exe داخل بسته نیست → کمپیوتر مقصد باید Node.js داشته باشد (فقط برای تست مناسب است).');
}
console.log('   حالا بسازید:  npx tauri build');
}

finish();
