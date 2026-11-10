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
/**
 * تضمین باینری ویندوزی libSQL.
 *
 * چرا: نصب‌کننده روی ویندوز اجرا می‌شود، ولی ساخت ممکن است روی لینوکس انجام
 * شود (همان چیزی که در CI رخ می‌دهد). `npm install` در آن حالت فقط باینری
 * لینوکسی `@libsql/linux-x64-gnu` را نصب می‌کند و بسته‌ی ویندوزی
 * (`@libsql/win32-x64-msvc`) اصلاً وجود ندارد — نتیجه: نصب‌کننده روی ویندوز
 * با «Cannot find module @libsql/win32-x64-msvc» و صفحه‌ی سفید بالا نمی‌آمد.
 * این تابع آن بسته را (اگر نبود) از npm می‌گیرد و داخل بسته می‌گذارد.
 */
const WINDOWS_LIBSQL = '@libsql/win32-x64-msvc';

function ensureWindowsLibsql(nmDir) {
  const dest = path.join(nmDir, ...WINDOWS_LIBSQL.split('/'));
  if (fs.existsSync(path.join(dest, 'index.node'))) return true;

  let version = '';
  try {
    version = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules', '@libsql', 'linux-x64-gnu', 'package.json'), 'utf8'),
    ).version;
  } catch { /* ignore */ }
  if (!version) {
    try {
      version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@libsql', 'client', 'package.json'), 'utf8')).version;
    } catch { /* ignore */ }
  }
  if (!version) version = '0.5.29';

  const url = `https://registry.npmjs.org/${WINDOWS_LIBSQL}/-/win32-x64-msvc-${version}.tgz`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-libsql-'));
  const tgz = path.join(tmp, 'win.tgz');
  try {
    run(`curl -fL --retry 3 --connect-timeout 20 -o "${tgz}" "${url}"`, tmp);
    /* tarball npm = tar.gz با مسیرهای package/... — با tar سیستمی باز می‌شود */
    run(`tar -xzf "${tgz}" -C "${tmp}"`, tmp);
    const src = path.join(tmp, 'package');
    if (!fs.existsSync(path.join(src, 'index.node'))) throw new Error('index.node در بسته نبود');
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`   ✔ باینری ویندوزی libSQL اضافه شد (${WINDOWS_LIBSQL}@${version})`);
    return true;
  } catch (e) {
    console.error(`   ⚠ باینری ویندوزی libSQL گرفته نشد: ${e instanceof Error ? e.message : e}`);
    console.error('     نصب‌کننده روی ویندوز اجرا نخواهد شد (Cannot find module @libsql/win32-x64-msvc).');
    return false;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

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


/**
 * بررسی امضای فایل اجرایی ویندوز (PE).
 *
 * چرا: فایل ZIP نود ممکن است ناقص/اشتباه باشد (دانلود قطع‌شده، نسخه ۳۲ بیتی).
 * اگر node.exe خراب داخل نصب‌کننده برود، کاربر فقط «برنامه باز نمی‌شود» می‌بیند.
 * اینجا قبل از بسته‌بندی جلوی آن گرفته می‌شود.
 */
function assertWindowsExe(file, label = 'node.exe') {
  let buf;
  try { buf = fs.readFileSync(file); } catch { throw new Error(`${label} خوانده نشد`); }
  if (buf.length < 1024 || buf[0] !== 0x4d || buf[1] !== 0x5a) {
    throw new Error(`${label} فایل اجرایی ویندوز نیست (امضای MZ ندارد)`);
  }
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.length < peOff + 6 || buf.toString('latin1', peOff, peOff + 4) !== 'PE\u0000\u0000') {
    throw new Error(`${label} ساختار PE معتبر ندارد`);
  }
  const machine = buf.readUInt16LE(peOff + 4);
  if (machine !== 0x8664) {
    throw new Error(`${label} برای x64 نیست (machine=0x${machine.toString(16)})`);
  }
  return true;
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

/* باینری ویندوزی libSQL — بدون آن نصب‌کننده روی ویندوز بالا نمی‌آید */
const libsqlOk = ensureWindowsLibsql(nm);

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
      assertWindowsExe(path.join(out, 'node.exe'));
      console.log(`   ✔ node.exe کاپی شد و معتبر است (${found} · PE x64)`);
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
    assertWindowsExe(path.join(out, 'node.exe'));
    console.log(`   ✔ node.exe کاپی شد و معتبر است (${found} · PE x64)`);
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

/*
 * کلید عمومی لایسنس باید **داخل بسته** باشد، وگرنه نسخه‌ی نصب‌شده هیچ
 * لایسنسی را نمی‌تواند بررسی کند (و همه‌ی مشتری‌ها روی «کلید عمومی نیست»
 * گیر می‌کنند). منبع: `src-tauri/public-key/farday-public.b64` که با
 * `npm run license:keygen` ساخته می‌شود.
 */
const pubSrc = path.join(root, 'src-tauri', 'public-key', 'farday-public.b64');
if (!fs.existsSync(pubSrc)) {
  console.error('⛔ کلید عمومی لایسنس پیدا نشد: src-tauri/public-key/farday-public.b64');
  console.error('   اول این را اجرا کنید:  npm run license:keygen');
  process.exit(1);
}
/* ۱) فایل کنار برنامه (لایه‌ی دوم؛ اگر مُهر نباشد از این خوانده می‌شود) */
fs.mkdirSync(path.join(out, 'public-key'), { recursive: true });
fs.copyFileSync(pubSrc, path.join(out, 'public-key', 'farday-public.b64'));
/* ۲) منبع مُهر: build.rs همین را داخل فایل اجرایی می‌پزد */
const sealDir = path.join(root, 'src-tauri', 'seal');
fs.mkdirSync(sealDir, { recursive: true });
fs.copyFileSync(pubSrc, path.join(sealDir, 'public-key.txt'));
console.log('   ✔ کلید عمومی لایسنس داخل بسته و در منبع مُهر (build.rs) کاپی شد');

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
const hasWinLibsql = fs.existsSync(path.join(nm, '@libsql', 'win32-x64-msvc', 'index.node'));
if (requireNode && !hasWinLibsql) {
  console.error('');
  console.error('⛔ باینری ویندوزی libSQL داخل بسته نیست — ساخت متوقف شد.');
  console.error('   برنامه روی ویندوز با خطای «Cannot find module @libsql/win32-x64-msvc» بالا نمی‌آید.');
  console.error('   با انترنت بسازید، یا بسته را از npm بگیرید:  npm pack @libsql/win32-x64-msvc');
  process.exit(1);
}
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
console.log('   حالا بسازید:  npm run desktop:build   (یا اگر بسته کامل است: node scripts/build-desktop.mjs --skip-api)');
}

finish();
