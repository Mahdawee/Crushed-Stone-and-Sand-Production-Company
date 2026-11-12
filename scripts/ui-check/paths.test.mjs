/**
 * تست «مسیر پروژه» و «شکار خطای مسیر ویندوزی» — `npm run test:paths`
 *
 * ── چه چیزی را تضمین می‌کند ──────────────────────────────────────────────
 *
 * ۱) هیچ فایلی در `scripts/` و `tools/` از الگوی خطرناک
 *    `new URL(import.meta.url).pathname` استفاده نکند. این الگو روی ویندوز
 *    `/C:/Users/...` می‌دهد و `path.resolve` آن را به `C:\C:\Users\...`
 *    تبدیل می‌کند — علتِ «tauri.conf.json خوانده نشد» و
 *    «npm install اجرا نشده» در `npm run doctor`.
 *
 * ۲) از هر مسیر دلخواهی که doctor را اجرا کنیم، همان پوشه‌ی پروژه را پیدا
 *    کند (باگ قبلی: به `cwd` وابسته بود).
 *
 * ۳) بخش‌های مهم doctor روی یک نصب سالم، هیچ «مشکل»ی گزارش نکنند
 *    (بسته‌ها + tauri.conf.json) — یعنی دیگر خطای کاذب نداریم.
 *
 * ۴) «موتور دیتابیس» در بسته‌ی نصبی: فایل ویندوزی + جست‌وجوی چندسطحی
 *    (باگ «missing (@libsql/win32-x64-msvc)»).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { projectRoot } from '../lib/project-root.mjs';

const root = projectRoot(import.meta.url, 2);
let passed = 0, failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
}

/* ---------------------------------------------------------------- */
/* ۱) هیچ‌جا الگوی خطرناک نمانده باشد                                 */
/* ---------------------------------------------------------------- */
console.log('\n— ۱) الگوی خطرناک مسیر —');

const badPattern = /new\s+URL\s*\(\s*import\.meta\.url\s*\)\s*\.pathname/;
const scanDirs = [path.join(root, 'scripts'), path.join(root, 'tools')];
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.cache' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js|cjs|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}
/** توضیحات را حذف می‌کند — الگوی غلط در *کامنت* اشکالی ندارد (و باید باشد). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const files = scanDirs.flatMap((d) => walk(d)).filter((f) => f !== fileURLToPath(import.meta.url));
check('فایل‌های scripts/ و tools/ اسکن شدند', files.length > 10, `${files.length} فایل`);
const offenders = files.filter((f) => badPattern.test(stripComments(fs.readFileSync(f, 'utf8'))));
check('هیچ فایلی از new URL(import.meta.url).pathname استفاده نمی‌کند',
  offenders.length === 0, offenders.map((f) => path.relative(root, f)).join(', '));

/* همان الگوی غلط را *بازتولید* می‌کنیم تا مطمئن شویم تست واقعاً می‌گیرد */
check('تست، الگوی غلط را تشخیص می‌دهد (خودآزمایی)',
  badPattern.test('const r = path.dirname(new URL(import.meta.url).pathname);'));

/* مسیر ویندوزی: `/C:/Users/...` نباید تبدیل به `C:\C:\...` شود */
/*
 * ── باگ دور ۴۳: این بررسی خروجی لینوکسی را سخت‌کد کرده بود ─────────────
 * `fileURLToPath` عمداً **مابسته به سیستم‌عامل** است:
 *   لینوکس  → `/C:/Users/...`   (اسلش اول می‌ماند)
 *   ویندوز  → `C:\Users\...`    (حرف درایو، بدون اسلش اول)
 *
 * سخت‌کد کردن شکل لینوکسی یعنی تست روی ویندوز همیشه قرمز است — در حالی
 * که رفتار درست همان است. (همین اشتباه را در بررسی بیت +x هم کردیم.)
 *
 * چیزی که واقعاً مهم است: حرف درایو **تکرار نشود** (`C:\C:\`) و مسیر
 * به همان درایو اشاره کند.
 */
const winUrl = 'file:///C:/Users/DELL/Documents/GitHub/Crushed-Stone-and-Sand-Production-Company/scripts/doctor.mjs';
{
  const got = fileURLToPath(new URL(winUrl));
  const winExpected = path.win32.join('C:\\', 'Users', 'DELL', 'Documents', 'GitHub', 'Crushed-Stone-and-Sand-Production-Company', 'scripts', 'doctor.mjs');
  const expected = process.platform === 'win32'
    ? winExpected
    : '/C:/Users/DELL/Documents/GitHub/Crushed-Stone-and-Sand-Production-Company/scripts/doctor.mjs';
  check('fileURLToPath روی مسیر ویندوزی حرف درایو را سالم می‌دهد', got === expected, `${got} ≠ ${expected}`);
  // Node 22 supports explicit Windows conversion, so this also runs on Linux CI.
  const windowsGot = fileURLToPath(new URL(winUrl), { windows: true });
  check('تبدیل مسیر ویندوزی با جداکننده درست روی همه سیستم‌ها', windowsGot === winExpected, `${windowsGot} ≠ ${winExpected}`);
  check('حرف درایو تکرار نشده', !/^[A-Za-z]:\\[A-Za-z]:/.test(windowsGot), windowsGot);
}
const buggy = path.win32.resolve('C:\\Users\\DELL\\Documents\\GitHub\\proj',
  '\\C:\\Users\\DELL\\Documents\\GitHub\\Crushed-Stone-and-Sand-Production-Company\\scripts');
check('بازتولید باگ ویندوزی: مسیر نسبیِ «\\C:\\...» به C:\\C:\\ می‌چسبد',
  buggy === 'C:\\C:\\Users\\DELL\\Documents\\GitHub\\Crushed-Stone-and-Sand-Production-Company\\scripts');
/* همین است که «C:\C:\» می‌سازد: مسیرِ شروع‌شده با «\» ریشه‌ی درایو حساب می‌شود */
check('مسیر شروع‌شده با «\\» به‌عنوان مسیر مطلقِ درایو تفسیر می‌شود (منشأ باگ)',
  buggy.startsWith('C:\\C:'));

/* ---------------------------------------------------------------- */
/* ۲) ریشه‌ی پروژه مستقل از cwd                                     */
/* ---------------------------------------------------------------- */
console.log('\n— ۲) ریشه‌ی پروژه —');
const here = projectRoot(import.meta.url, 2);
check('projectRoot ریشه‌ی درست را می‌دهد', here === root, `${here} vs ${root}`);
check('projectRoot مستقل از cwd است', (() => {
  const cwd = process.cwd();
  try {
    process.chdir(os.tmpdir());
    return projectRoot(import.meta.url, 2) === root;
  } finally { process.chdir(cwd); }
})());
check('projectRoot با فاصله در مسیر هم کار می‌کند', (() => {
  const fake = path.join(os.tmpdir(), 'my folder with space', 'scripts', 'x.mjs');
  /*
   * ⚠ باگ دور ۴۳: `new URL('file://' + مسیر)` فقط روی لینوکس درست است.
   * روی ویندوز مسیر `D:\...` است و `file://D:\...` URL معتبر نیست.
   * `pathToFileURL` هر دو را درست می‌سازد — و هم‌زمان فاصله‌ها را
   * درصدگذاری می‌کند، که این بررسی دقیقاً برای آزمودنش هست.
   */
  const u = pathToFileURL(fake).href;
  return projectRoot(u, 1) === path.join(os.tmpdir(), 'my folder with space');
})());

/* ---------------------------------------------------------------- */
/* ۳) doctor از هر پوشه‌ای اجرا شود، همان پروژه را می‌بیند            */
/* ---------------------------------------------------------------- */
console.log('\n— ۳) doctor از پوشه‌ی دیگر —');
const doctor = path.join(root, 'scripts', 'doctor.mjs');
let out = '';
try {
  out = execFileSync(process.execPath, [doctor], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 120000 });
} catch (e) {
  out = `${e.stdout || ''}${e.stderr || ''}`;
}
check('doctor از پوشه‌ی دیگر اجرا شد', out.length > 0);
check('doctor دیگر «tauri.conf.json خوانده نشد» نمی‌گوید',
  !out.includes('tauri.conf.json خوانده نشد'),
  out.split('\n').filter((l) => l.includes('tauri.conf.json')).join(' | '));
check('doctor دیگر «npm install اجرا نشده» نمی‌گوید',
  !out.includes('npm install اجرا نشده'));
check('doctor بسته‌های پروژه را «نصب‌شده» می‌بیند', out.includes('بسته‌های پروژه نصب است'));
check('doctor تنظیمات NSIS را خوانده است', out.includes('NSIS') && !out.includes('NSIS خوانده نشد'));
check('doctor مسیر مطلقِ درست را چاپ نمی‌کند مگر خطا (C:\\C:\\ هرگز)',
  !out.includes('C:\\C:\\'));

/* ---------------------------------------------------------------- */
/* ۴) موتور دیتابیس                                                 */
/* ---------------------------------------------------------------- */
console.log('\n— ۴) موتور دیتابیس —');
const engineFile = path.join(root, 'apps', 'api', 'dist', 'common', 'sqlite-engine.js');
check('ماژول sqlite-engine ساخته شده', fs.existsSync(engineFile));

const { ensureSqliteEngine, nativePackageName, searchRoots, nativeCandidates, rootsFrom } =
  await import(pathToFileURL(engineFile).href);
const st = ensureSqliteEngine();
check('موتور روی این سیستم بارگذاری می‌شود', st.ok === true, st.detail);
check('نام پکیج بومی منطبق با پلتفرم است',
  st.package === nativePackageName() && /^@libsql\//.test(st.package), st.package);

const roots = searchRoots();
/*
 * این مهم‌ترین بخش است: باگ اصلی این بود که مسیر
 * `<bundle>/api/node_modules` (یعنی `__dirname/../node_modules`) هرگز
 * بررسی نمی‌شد. باید مسیر بسته‌ی نصبی هم در فهرست باشد.
 */
const bundleApi = path.join(root, 'src-tauri', 'api');
/*
 * ساختار بسته‌ی نصب‌شده:
 *   <resources>/api/app.js, <resources>/api/node_modules/...
 *   کد در <resources>/api/modules است → __dirname = .../api/modules
 * مسیر درست دو سطح بالاتر از __dirname نیست، **یک** سطح است.
 */
const packagedModules = path.join(root, 'src-tauri', 'api', 'modules');
const packagedRoots = rootsFrom(packagedModules, 6);
check('جست‌وجو شامل node_modules همسایه‌ی کد است (__dirname/../node_modules)',
  packagedRoots.includes(path.join(root, 'src-tauri', 'api', 'node_modules')),
  packagedRoots.slice(0, 3).join(' , '));
/*
 * ── اصلاح (دور ۳۷): این بررسی به «محصول ساخت» وابسته بود ────────────────
 * `src-tauri/api/node_modules` را `build-desktop-api.mjs` می‌سازد؛ در کلون
 * تازه وجود ندارد. تست قبلاً در ماشین من (که بسته ساخته شده بود) سبز و در
 * کلون تازه قرمز بود — یعنی «افتادن به وضعیت محلی»، نه سنجش کد. حالا:
 *   • همیشه: مسیر جست‌وجو شامل `<bundle>/api/node_modules` باشد (اصل باگ)
 *   • اگر بسته ساخته شده: باینری واقعاً پیدا شود
 */
check('مسیر جست‌وجو <bundle>/api/node_modules را دارد (اصل باگ)',
  packagedRoots.includes(path.join(root, 'src-tauri', 'api', 'node_modules')),
  packagedRoots.slice(0, 3).join(' , '));
{
  const builtApi = fs.existsSync(path.join(root, 'src-tauri', 'api', 'app.js'));
  const winBinPath = path.join(root, 'src-tauri', 'api', 'node_modules', '@libsql', 'win32-x64-msvc', 'index.node');
  if (builtApi) {
    check('باینری در ساختار بسته پیدا می‌شود (بازتولید اصل باگ)',
      packagedRoots.some((r) => fs.existsSync(path.join(r, '@libsql', 'win32-x64-msvc', 'index.node'))), winBinPath);
  } else {
    check('بسته‌ی API هنوز ساخته نشده — بررسی باینری بسته رد شد (desktop:build می‌سازدش)', true);
  }
}
check('جست‌وجو شامل ریشه‌ی repo است', roots.includes(path.join(root, 'node_modules')));
check('جست‌وجو شامل کنار node.exe است',
  roots.includes(path.join(path.dirname(process.execPath), 'node_modules')));

const cands = nativeCandidates();
check('کاندیدهای باینری، index.node را هدف می‌گیرند',
  cands.length > 0 && cands.every((c) => c.endsWith('index.node')));
check('کاندیدها شامل مسیر داخل بسته‌ی نصبی هستند',
  cands.some((c) => c.includes(`${path.sep}api${path.sep}node_modules`)),
  cands.slice(0, 2).join(' , '));

/* فایل ویندوزی داخل بسته (اگر بسته ساخته شده باشد) */
const winBin = path.join(bundleApi, 'node_modules', '@libsql', 'win32-x64-msvc', 'index.node');
if (fs.existsSync(path.join(bundleApi, 'app.js'))) {
  check('بسته‌ی نصبی، باینری ویندوزی موتور دیتابیس را دارد', fs.existsSync(winBin),
    path.relative(root, winBin));
  check('doctor وجود آن را تأیید می‌کند', out.includes('باینری ویندوزی موتور دیتابیس داخل بسته هست'));
} else {
  check('بسته‌ی نصبی ساخته نشده — بررسی باینری ویندوزی رد شد (هشدار)', true);
}

/* ---------------------------------------------------------------- */
/* ۵) خودآزمایی API — همان چیزی که صفحه‌ی شروع نشان می‌دهد             */
/* ---------------------------------------------------------------- */
console.log('\n— ۵) گزارش API (system/info) —');
const ctrl = fs.readFileSync(path.join(root, 'apps/api/src/modules/system.controller.ts'), 'utf8');
check('system.controller از همان منبع حقیقت استفاده می‌کند',
  ctrl.includes('ensureSqliteEngine') && !ctrl.includes('findBinary'));
check('db.ts قبل از ساخت کلاینت موتور را الزامی می‌کند',
  fs.readFileSync(path.join(root, 'apps/api/src/db.ts'), 'utf8').includes('requireSqliteEngine()'));

/* ---------------------------------------------------------------- */
/* ۵.۵) همان ماژول، ولی از داخل بسته‌ی نصبی                        */
/* ---------------------------------------------------------------- */
console.log('\n— ۵.۵) موتور دیتابیس داخل بسته نصبی —');
{
  const bundledEngine = path.join(bundleApi, 'common', 'sqlite-engine.js');
  if (fs.existsSync(bundledEngine)) {
    const mod = await import(pathToFileURL(bundledEngine).href);
    /*
     * مهم: `__dirname` این ماژول داخل بسته `<resources>/api/common` است.
     * مسیر درست باینری `<resources>/api/node_modules/...` است — یعنی
     * «__dirname/../node_modules»، نه «__dirname/../../node_modules».
     * باگ اصلی همین بود.
     */
    const r = mod.rootsFrom(path.join(bundleApi, 'common'), 6);
    check('بسته: node_modules داخل api دیده می‌شود',
      r.includes(path.join(bundleApi, 'node_modules')), r.slice(0, 2).join(' , '));
    check('بسته: باینری ویندوزی داخل بسته پیدا می‌شود',
      fs.existsSync(path.join(bundleApi, 'node_modules', '@libsql', 'win32-x64-msvc', 'index.node')));
    check('بسته: همان مسیر در کاندیدهای بارگذاری هست',
      mod.nativeCandidates().some((c) => c.startsWith(path.join(bundleApi, 'node_modules'))));
  } else {
    check('بسته‌ی API ساخته نشده — بررسی مسیر بسته رد شد (هشدار)', true);
  }
}

/* ---------------------------------------------------------------- */
/* ۶) پیام خطای «موتور نیست» باید روشن و راهنما باشد                  */
/* ---------------------------------------------------------------- */
console.log('\n— ۶) پیام خطای نبود موتور —');
{
  const mod = await import(pathToFileURL(engineFile).href);
  const before = process.env.FD_ENGINE_FORCE_MISSING;
  process.env.FD_ENGINE_FORCE_MISSING = '1';
  mod.resetEngineCache();
  const forced = mod.ensureSqliteEngine();
  check('در شبیه‌سازی، وضعیت missing گزارش می‌شود', forced.ok === false);
  check('جزئیات/مسیرهای بررسی‌شده در گزارش هست',
    forced.detail.includes(forced.package) || forced.checked.length > 0, forced.detail);

  let msg = '';
  try { mod.requireSqliteEngine(); } catch (e) { msg = e.message; }
  check('requireSqliteEngine خطای فارسی و راهنما می‌دهد',
    msg.includes('موتور دیتابیس پیدا نشد') && msg.includes('راه‌حل'));
  check('خطا فهرست مسیرهای بررسی‌شده را دارد', msg.includes('بررسی شدند'));

  /* بازگردانی */
  if (before === undefined) delete process.env.FD_ENGINE_FORCE_MISSING;
  else process.env.FD_ENGINE_FORCE_MISSING = before;
  mod.resetEngineCache();
  check('پس از بازگردانی، موتور دوباره سالم است', mod.ensureSqliteEngine().ok === true);
}

console.log(`\n${failed === 0 ? '✔' : '✘'} ${passed} تست موفق، ${failed} ناموفق`);
if (failed) { console.log('\nمشکلات:'); problems.forEach((p) => console.log(` • ${p}`)); process.exit(1); }
