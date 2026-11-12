/**
 * نگهبان «نشان اپراتور در تاریخچه‌ی صفر کردن» — پیشنهاد C3، دور ۴۰.
 *
 *   node --experimental-sqlite scripts/ui-check/operator-identity.test.mjs
 *
 * ── چرا این تست ─────────────────────────────────────────────────────────
 * ادعا این است: بعد از صفر کردن، فایل `reset-history.log` می‌گوید **چه کسی**
 * این کار را کرد — نه فقط «admin» یا «reset-tool».
 *
 * این ادعا فقط با آزمون واقعی معنا دارد، چون سه مسیر جدا باید یک چیز
 * بنویسند:
 *   ۱) مسیر آنلاین (`apps/api/src/common/reset.ts`)
 *   ۲) مسیر آفلاین (`tools/reset-ui/reset-core.mjs`)
 *   ۳) سرور ابزار که برچسب را می‌سازد (`tools/reset-ui/server.mjs`)
 *
 * اگر یکی عقب بماند، تاریخچه دو شکل مختلف می‌شود و خواندنش به حدس تبدیل
 * می‌شود — همان مشکلی که تست‌های ساختاری هرگز نمی‌گیرند.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const apiReset = read('apps/api/src/common/reset.ts');
const coreReset = read('tools/reset-ui/reset-core.mjs');
const toolServer = read('tools/reset-ui/server.mjs');
const sysCtl = read('apps/api/src/modules/system.controller.ts');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— ساختار: هر سه مسیر یک شکل می‌نویسند —');

for (const [name, src] of [['آنلاین', apiReset], ['آفلاین', coreReset]]) {
  ok(`${name}: فیلد operatorLabel وجود دارد`, /operatorLabel/.test(src));
  ok(`${name}: تاریخچه برچسب را می‌نویسد (نه نام خام)`,
    /\$\{at\} · \$\{report\.operatorLabel\}/.test(src));
}
ok('سرور ابزار برچسب را می‌سازد', /operatorLabel: \(\(\) =>/.test(toolServer));
ok('سرور ابزار نام کاربر ویندوز را می‌گیرد', /os\.userInfo\(\)\.username/.test(toolServer));
ok('سرور ابزار هدر x-operator را می‌فرستد', /'x-operator': osUser/.test(toolServer));
ok('API هدر x-operator را می‌خواند', /headers\?\.\['x-operator'\]/.test(sysCtl));
ok('API نام کامل و نقش را هم کنار آن می‌گذارد',
  /req\?\.session\?\.fullName/.test(sysCtl) && /req\?\.session\?\.role/.test(sysCtl));
ok('مسیر GET /system/operator وجود دارد و فقط برای مدیر است',
  /@Get\('operator'\)[\s\S]{0,120}@ManagerOnly\(\)|@ManagerOnly\(\)[\s\S]{0,120}@Get\('operator'\)/.test(sysCtl));

/* نام کاربر ویندوز نباید هیچ اطلاعات اضافه‌ای برگرداند */
const opBlock = /operator\(\) \{([\s\S]*?)\n  \}/.exec(sysCtl)?.[1] || '';
ok('مسیر operator فقط نام کاربری و نام میزبان می‌دهد',
  /osUser/.test(opBlock) && /hostname/.test(opBlock) && !/homedir|home|path\./.test(opBlock));

console.log('\n— آزمون واقعی: صفر کردن آفلاین با نام اپراتور —');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-op-'));
try {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const dbFile = path.join(dir, 'farday.db');
  const db = new DatabaseSync(dbFile);
  /*
   * دیتابیس آزمون باید شکل **واقعی** برنامه را داشته باشد، وگرنه پیش‌بررسی
   * عمداً جلوی صفر کردن را می‌گیرد («جدول Customer/User ندارد»). این محافظ
   * درست است و نباید دور زده شود — پس fixture را واقعی می‌سازیم.
   */
  /* ستون‌ها دقیقاً همان‌هایی که پیش‌بررسی ابزار می‌خواهد (code و name در Customer) */
  db.exec('CREATE TABLE "Customer"("id" INTEGER PRIMARY KEY, "code" TEXT, "name" TEXT, "deletedAt" TEXT)');
  db.exec(`CREATE TABLE "User"("id" INTEGER PRIMARY KEY, "username" TEXT, "passwordHash" TEXT, "role" TEXT, "active" INTEGER, "fullName" TEXT)`);
  db.exec('CREATE TABLE "Sale"("id" INTEGER PRIMARY KEY, "no" TEXT, "total" REAL, "deletedAt" TEXT)');
  db.exec(`INSERT INTO "Customer"("code","name") VALUES('001','حاجی احمد')`);
  db.exec(`INSERT INTO "User"("username","passwordHash","role","active") VALUES('admin','x','manager',1)`);
  db.exec(`INSERT INTO "Sale"("no","total") VALUES('S-1', 100), ('S-2', 200)`);
  db.close();

  const { resetOffline } = await import(pathToFileURL(path.join(root, 'tools/reset-ui/reset-core.mjs')).href);
  /*
   * امضای واقعی: resetOffline(paths, opts) — ترتیب برعکس ننوشتن، وگرنه
   * عبارت تأیید داخل «مسیرها» می‌رود و همیشه «تأیید نشد» می‌گیریم.
   */
  const res = await resetOffline(
    { dataDir: dir, dbFile, backupsDir: path.join(dir, 'backups') },
    { confirm: 'صفر کردن', reason: 'آزمون نشان اپراتور', operator: 'naser', operatorLabel: 'naser · ویندوز: Naser-PC' },
  );

  ok('صفر کردن آفلاین موفق بود', res?.ok === true, JSON.stringify(res?.message || '').slice(0, 80));

  const histPath = path.join(dir, 'reset-history.log');
  ok('فایل reset-history.log ساخته شد', fs.existsSync(histPath));
  const line = fs.existsSync(histPath) ? fs.readFileSync(histPath, 'utf8').trim() : '';
  console.log(`     ↳ ${line.slice(0, 120)}`);
  ok('خط تاریخچه نام اپراتور را دارد', line.includes('naser'));
  ok('خط تاریخچه نام کاربر ویندوز را دارد', line.includes('Naser-PC'));
  ok('خط تاریخچه «reset-tool» عمومی نیست', !line.includes('reset-tool'));
  ok('خط تاریخچه ردیف‌ها و دلیل را هم دارد', /۲|2/.test(line) && line.includes('آزمون نشان اپراتور'));

  /* گزارش مهر (reset-mark) هم باید برچسب را داشته باشد */
  const markFile = fs.readdirSync(dir).find((f) => /mark|reset/i.test(f) && f.endsWith('.json'));
  if (markFile) {
    const mark = JSON.parse(fs.readFileSync(path.join(dir, markFile), 'utf8'));
    ok('فایل مهر صفر کردن هم operatorLabel دارد', mark.operatorLabel === 'naser · ویندوز: Naser-PC',
      String(mark.operatorLabel));
  } else {
    ok('فایل مهر صفر کردن پیدا شد', false, fs.readdirSync(dir).join(','));
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
