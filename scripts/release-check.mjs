/**
 * «آماده‌ی انتشار» — پاسخ قابل‌تکرار به یک سؤال:
 *
 *   اگر این نسخه را روی نصب مشتری‌های قبلی بفرستیم، داده‌شان سالم می‌ماند؟
 *
 *   node scripts/release-check.mjs
 *
 * سه چیز را می‌سنجد و اگر یکی نباشد **کد خروج ۱** می‌دهد (برای زنجیره‌ی
 * انتشار: `npm run release:check && npm run desktop:build`):
 *
 *   ۱) **سازگاری ساختار**: هر ستون/جدول تازه‌ای که کد لازم دارد باید در
 *      `UPGRADES` باشد یا با `ADD COLUMN … DEFAULT` اضافه شود — وگرنه روی
 *      دیتابیس قدیمی، برنامه‌ی تازه ستون گم‌شده می‌بیند.
 *   ۲) **نسخه‌ها هم‌خوان**: `package.json` و `tauri.conf.json` و
 *      `Cargo.toml` یک شماره بدهند. تجربه‌ی تلخ: نسخه‌ها جدا عوض می‌شدند و
 *      تاریخچه‌ی بروزرسانی/نصب‌کننده شماره‌ی متفاوت نشان می‌داد.
 *   ۳) **مهاجرت واقعاً کار می‌کند**: `test:upgrade` اجرا می‌شود (نصب قدیمی
 *      با داده ⇒ برنامه‌ی امروز ⇒ داده دست‌نخورده + پشتیبان).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './lib/project-root.mjs';

const root = projectRoot(import.meta.url, 1);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (s) => console.log(`  ✔ ${s}`);
const warn = (s) => console.log(`  ⚠ ${s}`);
const problems = [];
const bad = (s, fix) => { problems.push({ s, fix }); console.log(`  ✘ ${s}`); };

console.log('\n=== بررسی آمادگی انتشار ===\n');

/* ---------------------------------------------------------------- ۱) نسخه‌ها */
console.log('— ۱) نسخه‌ها هم‌خوان —');
const pkg = JSON.parse(read('package.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargo = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1] || '';
const versions = { 'package.json': pkg.version, 'tauri.conf.json': tauri.version, 'Cargo.toml': cargo };
const uniq = [...new Set(Object.values(versions).filter(Boolean))];
if (uniq.length === 1) ok(`همه «${uniq[0]}» هستند (${Object.keys(versions).join(' · ')})`);
else bad(`نسخه‌ها یکی نیستند: ${JSON.stringify(versions)}`,
  'همه را یک عدد کنید: package.json ← tauri.conf.json ← src-tauri/Cargo.toml');

/* ---------------------------------------------------- ۲) سازگاری ساختار داده */
console.log('\n— ۲) سازگاری ساختار دیتابیس —');
const schema = read('apps/api/src/schema.ts');
const upgrade = read('apps/api/src/common/upgrade.ts');
const shapeVersion = Number(upgrade.match(/export const SHAPE_VERSION = (\d+)/)?.[1] || 0);
const tableVersion = [...upgrade.matchAll(/^\s*\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
const maxTable = tableVersion.length ? Math.max(...tableVersion) : 0;
if (shapeVersion > 0) ok(`SHAPE_VERSION = ${shapeVersion}`);
else bad('SHAPE_VERSION پیدا نشد', 'export const SHAPE_VERSION را در common/upgrade.ts تعریف کنید');
if (maxTable <= shapeVersion) ok(`جدول توضیح مهاجرت‌ها تا نسخه‌ی ${maxTable} است`);
else bad(`جدول توضیح مهاجرت‌ها از SHAPE_VERSION جلوتر است (${maxTable} > ${shapeVersion})`,
  'ردیف توضیح نسخه‌ی تازه را در جدول بالای upgrade.ts اضافه کنید');

/* هر ستونی که کد در INSERT/UPDATE لازم دارد، باید در ساختار باشد */
const tablesInSchema = new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]));
const softTables = [...read('apps/api/src/common/soft-delete.ts').matchAll(/^\s{2}(\w+): \{/gm)].map((m) => m[1]);
const missingSoft = softTables.filter((t) => !tablesInSchema.has(t));
if (missingSoft.length === 0) ok(`${softTables.length} جدول حذف‌نرم همه در ساختار هستند`);
else bad(`جدول‌های حذف‌نرم بدون CREATE TABLE: ${missingSoft.join(', ')}`, 'جدول را در TABLES اضافه کنید');

/*
 * قاعده‌ی طلایی: مهاجرت‌ها فقط اضافه می‌کنند. اگر روزی کسی `DROP`/تغییر نوع
 * در UPGRADES بنویسد، همان‌جا جلویش گرفته می‌شود — چون این تنها راه تضمین
 * این است که بروزرسانی داده‌ی مشتری را نبرد.
 */
const upgradesBlock = upgrade.slice(upgrade.indexOf('UPGRADES'));
const destructive = [...upgradesBlock.matchAll(/`([^`]*(?:DROP\s+(?:COLUMN|TABLE)|ALTER\s+TABLE[^`]*RENAME)[^`]*)`/gi)].map((m) => m[1].slice(0, 60));
if (destructive.length === 0) ok('مهاجرت‌ها فقط «اضافه» می‌کنند (بدون DROP/RENAME)');
else bad(`مهاجرت مخرب پیدا شد: ${destructive.join(' | ')}`, 'حذف ستون/جدول در مهاجرت ممنوع است — رجوع به docs/UPGRADE.md');

/* افزودن ستون باید DEFAULT داشته باشد وگرنه ردیف‌های موجود ناسازگار می‌شوند */
const addColumns = [...upgradesBlock.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN "(\w+)" ([^`]+)/g)];
const noDefault = addColumns
  .filter((m) => /NOT NULL/i.test(m[3]) && !/DEFAULT/i.test(m[3]))
  .map((m) => `${m[1]}.${m[2]}`);
if (noDefault.length === 0) ok(`${addColumns.length} ستون تازه، همه با DEFAULT/اختیاری`);
else bad(`ستون NOT NULL بدون DEFAULT: ${noDefault.join(', ')}`, 'برای ردیف‌های موجود DEFAULT بگذارید');

/* نسخه‌ی دیتابیس جدیدتر از برنامه: نباید دست‌کاری شود */
if (/isNewerDatabase/.test(upgrade)) ok('دیتابیس جدیدتر از برنامه: فقط هشدار، بدون نوشتن');
else bad('بررسی «دیتابیس جدیدتر» نیست', 'isNewerDatabase را در مسیر مهاجرت به کار ببرید');

/* ------------------------------------------------------------------ ۳) تست */
console.log('\n— ۳) مهاجرت واقعی با داده‌ی قدیمی —');
try {
  const out = execFileSync(process.execPath, [path.join(root, 'apps/api/test/upgrade.test.js')], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000,
  });
  const last = out.trim().split('\n').filter((l) => /موفق،|✅/.test(l)).pop() || '';
  ok(`تست مهاجرت سبز است ${last ? `— ${last.trim()}` : ''}`);
} catch (e) {
  const out = String(e.stdout || '') + String(e.stderr || '');
  /*
   * ── اصلاح (دور ۳۷): پیام گمراه‌کننده ─────────────────────────────────
   * در کلون تازه `apps/api/dist` وجود ندارد و تست مهاجرت با پیام روشن
   * «بسته‌ی API ساخته نشده» می‌ایستد. این‌جا قبلاً همان حالت با «تست مهاجرت
   * یا بسته نشده یا ناکام دارد» گزارش می‌شد — سه احتمال در یک جمله و هیچ
   * راه‌حلی. حالا حالت «ساخته نشده» از ناکامی واقعی جدا می‌شود.
   */
  if (/بسته‌ی API ساخته نشده/.test(out) || !fs.existsSync(path.join(root, 'apps/api/dist'))) {
    bad('تست مهاجرت اجرا نشد: بسته‌ی API ساخته نشده', 'اول npm run build -w @farday/api (یا npm run build)');
  } else {
    const fails = out.split('\n').filter((l) => l.includes('✘')).slice(0, 5);
    bad('تست مهاجرت ناکام دارد', fails.join(' | ') || 'npm run test:upgrade را ببینید');
  }
}

/* ------------------------------------------------------------- ۴) پشتیبان/بازیابی */
console.log('\n— ۴) راه بازگشت —');
const control = read('apps/api/src/modules/system.controller.ts');
if (/backup\/list/.test(control) && /restore/.test(control)) ok('مسیر پشتیبان‌گیری و بازگردانی در API هست');
else bad('مسیر پشتیبان/بازگردانی پیدا نشد', 'GET /system/backup/list و POST /system/restore لازم است');
if (/recentUpgrades/.test(control)) ok('تاریخچه‌ی بروزرسانی در برنامه دیده می‌شود');
else warn('تاریخچه‌ی بروزرسانی در پنل نشان داده نمی‌شود');
if (fs.existsSync(path.join(root, 'docs', 'UPGRADE.md'))) ok('سند قاعده‌های بروزرسانی موجود است (docs/UPGRADE.md)');
else bad('docs/UPGRADE.md نیست', 'قاعده‌های مهاجرت را مستند کنید');

/* ------------------------------------------------- ۵) همراهی ابزارهای بیرونی */
/*
 * ── باگ (شکار باگ دور ۳۵) ────────────────────────────────────────────────
 * دور ۳۴ الگوی «tools/همه‌چیز» را در بسته گذاشت تا ابزار «صفر کردن» روی کمپیوتر
 * مشتری باشد؛ ولی همین الگو ابزار **لایسنس** را هم با خودش برد: keygen، صدور
 * و باطل‌کردن. روی بیلدی که مُهر نخورده (`build.rs` فقط هشدار می‌دهد) همین
 * ابزار به مشتری اجازه می‌داد با کلید عمومیِ جای‌گزین‌شده لایسنس جعلی بسازد.
 * ابزار لایسنس مالِ فروشنده است، نه مشتری. حالا برعکسش بررسی می‌شود.
 */
console.log('\n— ۵) ابزارهای بیرونی در بسته —');
{
  let conf = null;
  try { conf = JSON.parse(read('src-tauri/tauri.conf.json') || '{}'); } catch { /* پایین گزارش می‌شود */ }
  const res = conf?.bundle?.resources || [];
  /*
   * الگوها **نسبت به پوشه‌ی src-tauri/** حل می‌شوند، نه ریشه‌ی مخزن. پس
   * الگوی tools/reset-ui هیچ فایلی پیدا نمی‌کند و Tauri ساخت را با
   * «glob pattern … path not found or didn't match any files» می‌شکند
   * (دقیقاً همان چیزی که ساخت واقعی کاربر را در دور ۳۶ شکست). بررسی
   * «پیشوند رشته» این را نمی‌دید؛ باید مثل خود Tauri الگو حل شود.
   */
  const confDir = path.join(root, 'src-tauri');
  const glob = (pattern) => {
    try { return fs.globSync(pattern, { cwd: confDir }); } catch { return []; }
  };
  const hits = res.flatMap((r) => glob(String(r))).map((x) => String(x).replace(/\\/g, '/'));
  /*
   * الگوهای `tools/` پیش از ساخت وجود ندارند: `desktop:build` اول ابزارها را
   * به `src-tauri/tools/` کاپی می‌کند. پس این‌جا نباید «فایل پیدا نشد» گفت —
   * باید بررسی کرد که مرحله‌ی کاپی، همان چیزی را بسازد که الگو انتظار دارد.
   */
  const isToolPattern = (r) => String(r).startsWith('tools/');
  const stagedNow = fs.existsSync(path.join(root, 'src-tauri', 'tools'));
  /*
   * `api/` هم مثل `tools/` یک **محصول ساخت** است: `npm run desktop:build`
   * آن را با `build-desktop-api.mjs` می‌سازد (کد، prisma و node.exe). در یک
   * کلون تازه این پوشه وجود ندارد و نباید «ساخت را می‌شکند» گفت — همان‌طور
   * که Tauri هم قبل از حل الگوها آن را می‌سازد.
   */
  const isBuiltPattern = (r) => isToolPattern(r) || String(r).startsWith('api/');
  const apiBuilt = fs.existsSync(path.join(root, 'src-tauri', 'api', 'app.js'));
  const empty = res.filter((r) => !isBuiltPattern(r) && glob(String(r)).length === 0);
  if (empty.length === 0) ok('همه‌ی الگوهای bundle.resources (جز محصول‌های ساخت) فایل واقعی پیدا می‌کنند');
  else bad(`این الگوها هیچ فایلی پیدا نمی‌کنند و ساخت را می‌شکنند: ${empty.join(', ')}`,
    'مسیر را نسبت به پوشه‌ی src-tauri بنویسید');
  if (apiBuilt) ok('بسته‌ی API ساخته شده و الگوی api/**/* فایل دارد');
  else warn('بسته‌ی API هنوز ساخته نشده (desktop:build می‌سازدش) — الگوی api/**/* الان خالی است، این طبیعی است');
  if (!isToolPattern('x') && res.some(isToolPattern) && !stagedNow) {
    warn('ابزارها هنوز به src-tauri/tools کاپی نشده‌اند (desktop:build انجام می‌دهد)');
  }

  /* الگوی tools باید با آنچه build-desktop کاپی می‌کند هم‌خوان باشد */
  const bdSrc = read('scripts/build-desktop.mjs');
  const bundled = /const BUNDLED_TOOLS = \[([^\]]*)\]/.exec(bdSrc || '');
  const toolNames = bundled ? bundled[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean) : [];
  const toolPats = res.filter(isToolPattern);
  if (toolPats.length === 0) {
    bad('هیچ الگوی tools در bundle.resources نیست — ابزار صفر کردن روی نصب مشتری وجود ندارد',
      'در src-tauri/tauri.conf.json مقدار "tools/**/*" را به bundle.resources اضافه کنید');
  } else if (toolNames.length === 0) {
    bad('build-desktop هیچ ابزاری برای بسته کاپی نمی‌کند', 'BUNDLED_TOOLS را در scripts/build-desktop.mjs ببینید');
  } else {
    /* هر ابزارِ کاپی‌شده باید زیر یک الگو بیفتد و بالعکس */
    const covered = toolNames.every((t) => toolPats.some((pat) => {
      const d = String(pat).replace(/^tools\//, '').replace(/\/.*$/, '');
      return d === t || d === '**';
    }));
    if (covered) ok(`الگوهای tools با ابزارهای کاپی‌شده هم‌خوان‌اند (${toolNames.join(', ')})`);
    else bad(`ابزارهای کاپی‌شده زیر الگوی منابع نیستند: ${toolNames.join(', ')}`, 'الگوی tools/**/* را بگذارید');
    if (stagedNow) {
      const staged = fs.readdirSync(path.join(root, 'src-tauri', 'tools'));
      if (staged.join(',') === toolNames.join(',')) ok('پوشه‌ی مرحله‌بندی‌شده دقیقاً همان ابزارهای مورد انتظار است');
      else bad(`پوشه‌ی مرحله‌بندی چیز دیگری دارد: ${staged.join(', ')}`, 'src-tauri/tools را پاک کنید و دوباره بسازید');
    }
  }

  const matched = (frag) => hits.some((h) => h.includes(frag));
  /* پس از ساخت، پوشه‌ی مرحله‌بندی موجود است؛ پیش از ساخت، منبع را می‌سنجیم */
  const resetReady = stagedNow
    ? matched('tools/reset-ui/server.mjs')
    : fs.existsSync(path.join(root, 'tools', 'reset-ui', 'server.mjs')) && toolNames.includes('reset-ui');
  if (resetReady) ok('ابزار «صفر کردن» در منابع نصب‌کننده هست (روی نصب مشتری لازم است)');
  else bad('tools/reset-ui در منابع نصب‌کننده نیست — ابزار صفر کردن روی نصب مشتری وجود ندارد',
    'در src-tauri/tauri.conf.json مقدار "tools/**/*" را به bundle.resources اضافه کنید');
  /* هیچ الگویی نباید ابزار لایسنس را ببرد */
  const licenseHits = hits.filter((h) => h.includes('tools/license/'));
  if (licenseHits.length === 0) ok('ابزار لایسنس (keygen/صدور/باطل) در بسته نیست');
  else bad(`ابزار لایسنس در بسته می‌رود: ${licenseHits.slice(0, 3).join(', ')}`,
    'فقط ../tools/reset-ui/**/* را بگذارید؛ ابزار لایسنس مالِ فروشنده است و روی هر بیلد بدون مُهر به مشتری قدرت صدور می‌دهد');
  if (!res.some((r) => String(r).startsWith('api/'))) {
    bad('api در منابع نصب‌کننده نیست', 'bundle.resources را کامل کنید');
  } else if (apiBuilt) {
    if (matched('api/app.js')) ok('سرویس API در منابع هست');
    else bad('api در منابع هست ولی app.js پیدا نشد', 'build-desktop-api.mjs را بررسی کنید');
  } else ok('الگوی api در منابع هست (محصول ساخت، پیش از بیلد خالی است)');
  if (matched('public-key/farday-public.b64')) ok('کلید عمومی در منابع هست');
  else bad('public-key در منابع نصب‌کننده نیست', 'bundle.resources را کامل کنید');

  for (const f of ['tools/reset-ui/server.mjs', 'tools/reset-ui/reset-core.mjs', 'tools/reset-ui/ui.html',
    'tools/reset-ui/start.cmd', 'tools/reset-ui/start.sh', 'tools/license/server.mjs']) {
    if (fs.existsSync(path.join(root, f))) ok(`فایل ${f} موجود است`);
    else bad(`${f} پیدا نشد`, 'ابزار بیرونی ناقص است');
  }
  if (fs.existsSync(path.join(root, 'tools/license/server.mjs')) && licenseHits.length === 0)
    ok('ابزار لایسنس برای فروشنده در مخزن می‌ماند، ولی به بسته نمی‌رود');
  /* کلید خصوصی و دفترچه‌ی صدور هرگز نباید در بسته‌ی مشتری باشد */
  /*
   * کلید امضا روی دیسک فروشنده هست (و باید باشد)؛ پس «نبودِ فایل» معیار
   * درستی نیست. معیار این است که هیچ الگوی resources آن را نگیرد — وگرنه
   * کلید امضا داخل .msi مشتری می‌رود و هر کسی می‌تواند لایسنس صادر کند.
   */
  const covers = (file) => res.some((r) => {
    const pat = String(r).replace(/^\.\//, '');
    const dir = pat.replace(/\/\*\*\/\*$|\/\*\*$|\/\*$/, '');
    return file === dir || file.startsWith(`${dir}/`);
  });
  for (const f of ['license-keys/private.key', 'license-keys/issued.json', 'src-tauri/api/private.key',
    'src-tauri/api/issued.json', 'src-tauri/public-key/private.key']) {
    if (!covers(f)) ok(`${f} زیر هیچ الگوی بسته نیست (کلید امضا فقط پیش فروشنده)`);
    else bad(`${f} الگوی resources آن را می‌گیرد — کلید امضا نباید به مشتری برسد`, 'الگوی بسته را محدود کنید');
  }
  /* اجراکننده‌ها نباید به «ریشه‌ی مخزن» تکیه کنند — در نصب وجود ندارد */
  for (const f of ['tools/reset-ui/start.sh']) {
    const body = read(f);
    if (!/^cd "\$root"$/m.test(body)) ok(`${f} مستقل از ریشه‌ی مخزن کار می‌کند`);
    else bad(`${f} به ریشه‌ی مخزن cd می‌کند — روی نسخه‌ی نصب‌شده شکست می‌خورد`, 'cd "$here" بگذارید');
  }
}

/* ---------------------------------------------------------------- جمع‌بندی */
console.log('');
if (problems.length === 0) {
  console.log('✅ این نسخه برای فرستادن به مشتری‌های قبلی آماده است:');
  console.log('   • ساختار داده فقط «اضافه» می‌شود و مهر نسخه داخل خود دیتابیس است؛');
  console.log('   • قبل از هر مهاجرت پشتیبان گرفته می‌شود و اگر پشتیبان نشد، هیچ نوشتنی انجام نمی‌شود؛');
  console.log('   • تست با یک دیتابیس قدیمیِ دارای داده سبز است؛');
  console.log('   • راه بازگشت (بازگردانی پشتیبان + CLI بازیابی) هست.');
  console.log('\n   برای انتشار: npm run desktop:build\n');
} else {
  console.log(`⛔ ${problems.length} مورد باید درست شود:\n`);
  for (const p of problems) console.log(`• ${p.s}\n  راه‌حل: ${p.fix}\n`);
  process.exitCode = 1;
}
