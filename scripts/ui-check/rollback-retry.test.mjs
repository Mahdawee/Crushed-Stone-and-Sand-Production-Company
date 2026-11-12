/**
 * نگهبان «برگشت خودکار روی ویندوز» — باگ دور ۴۳.
 *
 *   node scripts/ui-check/rollback-retry.test.mjs
 *
 * ── چرا این تست (و چرا در ساندباکس معنادار است) ─────────────────────────
 * روی `windows-latest` این بررسی قرمز شد و محلی (لینوکس) سبز:
 *
 *   rolledBack: false · backupExists: true · backupSize: 196608
 *
 * فایل پشتیبان سالم بود، ولی بازگرداندن شکست خورد. روی ویندوز تا وقتی
 * دسته‌فایلِ دیتابیس بسته نشده، کاپی روی آن با EBUSY رد می‌شود؛ و
 * `$disconnect()` برمی‌گردد **قبل** از این‌که سیستم‌عامل دسته را آزاد کند.
 *
 * این تست لینوکس را متقاعد نمی‌کند فایل را قفل کند، پس قفل را **شبیه‌سازی**
 * می‌کند: `fs.copyFileSync` را چند بار EBUSY می‌کند. اگر کد تلاش دوباره
 * نکند، قرمز می‌شود — و همین رفتار ویندوز است.
 *
 * ⚠ نکته‌ی مهم: مسیر «صفر کردن نیمه‌کاره» بدترین حالت ممکن است (داده‌ی
 * مشتری). «تلاش دوباره» تنها چیزی است که بین داده‌ی سالم و ازدست‌رفته
 * فرق می‌گذارد، پس باید قفل شود.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

const distReset = path.join(root, 'apps', 'api', 'dist', 'common', 'reset.js');
if (!fs.existsSync(distReset)) {
  console.log('  ⚠ بسته‌ی API ساخته نشده — اول: npm run build -w @farday/api');
  console.log('⛔ 0 موفق، 1 ناکام (پیش‌نیاز نیست)\n');
  process.exit(1);
}

const { restoreBackupDetailed, restoreBackup } = await import(pathToFileURL(distReset).href);

console.log('\n— فایل پشتیبان ناموجود —');
{
  const r = await restoreBackupDetailed('/definitely/not/here.db', { tries: 2, waitMs: 1 });
  ok('ok=false می‌دهد', r.ok === false);
  ok('علت را می‌گوید (نه سکوت)', Boolean(r.error) && /پیدا نشد|not found/i.test(r.error), r.error);
  ok('restoreBackup ساده هم false می‌دهد', (await restoreBackup('/definitely/not/here.db')) === false);
}

console.log('\n— شبیه‌سازی قفل ویندوز (EBUSY) —');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rbretry-'));
{
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.FARDAY_DATA_DIR = dataDir;

  const bak = path.join(tmp, 'pre-reset-test.db');
  fs.writeFileSync(bak, 'BACKUP-CONTENT');

  const realCopy = fs.copyFileSync;
  let attempts = 0;
  fs.copyFileSync = (a, b, ...rest) => {
    attempts++;
    if (attempts <= 3) {
      const e = new Error('EBUSY: resource busy or locked, copyfile');
      e.code = 'EBUSY';
      throw e;
    }
    return realCopy(a, b, ...rest);
  };

  let r;
  try {
    r = await restoreBackupDetailed(bak, { tries: 10, waitMs: 5 });
  } finally {
    fs.copyFileSync = realCopy;
  }

  ok('با سه بار EBUSY بالاخره موفق می‌شود', r.ok === true, JSON.stringify(r));
  ok('واقعاً چند بار تلاش کرد', attempts >= 4, String(attempts));

  /* اگر همه‌ی تلاش‌ها EBUSY باشند، باید صادقانه false بدهد + علت */
  let attempts2 = 0;
  fs.copyFileSync = (a, b, ...rest) => {
    attempts2++;
    const e = new Error('EPERM: operation not permitted');
    e.code = 'EPERM';
    throw e;
  };
  let r2;
  try { r2 = await restoreBackupDetailed(bak, { tries: 3, waitMs: 1 }); }
  finally { fs.copyFileSync = realCopy; }

  ok('اگر هرگز آزاد نشد، ok=false', r2.ok === false);
  ok('علت EPERM را نگه می‌دارد', /EPERM/.test(String(r2.error)), r2.error);
  ok('بی‌نهایت تلاش نمی‌کند (۳ بار)', attempts2 === 3, String(attempts2));
}

console.log('\n— سناریوی واقعی ویندوز: قفل روی -shm هنگام unlink —');
/*
 * این دقیقاً خطایی است که روی windows-latest دیده شد:
 *
 *   EBUSY: resource busy or locked,
 *   unlink 'C:\\Users\\…\\farday.db-shm'
 *
 * یعنی کاپی فایل اصلی شده بود ولی فایل حافظه‌ی مشترک SQLite هنوز باز بود.
 * `fs.rmSync(force:true)` این را نمی‌گیرد — `force` فقط ENOENT را نادیده
 * می‌گیرد. نسخه‌ی اول کد همین‌جا شکست، پس این باید قفل شود.
 */
{
  const dataDir2 = path.join(tmp, 'data2');
  fs.mkdirSync(dataDir2, { recursive: true });
  process.env.FARDAY_DATA_DIR = dataDir2;
  process.env.FD_DB_FILE = path.join(dataDir2, 'farday.db');

  const bak = path.join(tmp, 'shm-test.db');
  fs.writeFileSync(bak, 'BACKUP');
  fs.writeFileSync(path.join(dataDir2, 'farday.db-shm'), 'SHM');

  const realRm = fs.rmSync;
  let shmAttempts = 0;
  fs.rmSync = (p, o) => {
    if (String(p).endsWith('-shm')) {
      shmAttempts++;
      if (shmAttempts <= 2) {
        const e = new Error(`EBUSY: resource busy or locked, unlink '${p}'`);
        e.code = 'EBUSY';
        throw e;
      }
    }
    return realRm(p, o);
  };

  let r;
  try { r = await restoreBackupDetailed(bak, { tries: 10, waitMs: 5 }); }
  finally { fs.rmSync = realRm; }

  ok('با EBUSY روی -shm هم برگشت موفق می‌شود', r.ok === true, JSON.stringify(r));
  /*
   * ⚠ چرا این عدد مهم است و چرا ۳ نیست:
   * نسخه‌ی اول کد (بدون removeWithRetry) هم در نهایت سبز می‌شد — چون
   * حلقه‌ی بیرونی دوباره از اول کاپی می‌کرد. یعنی تست نمی‌توانست «تلاش
   * دوباره در جای درست» را از «تکرار کل عملیات» تشخیص دهد.
   *
   * تفاوت واقعی: با removeWithRetry، حذف -shm دقیقاً ۳ بار (۲ شکست + ۱
   * موفق) صدا زده می‌شود. بدون آن، هر دورِ حلقه‌ی بیرونی یک بار حذف
   * می‌کند و چون `continue` می‌زند، 3 بار می‌شود. پس عدد تنها کافی نیست؛
   * باید مسیر را از روی خودِ کد هم ببینیم.
   */
  ok('حذف -shm تلاش دوباره شد (نه رها شدن)', shmAttempts >= 3, String(shmAttempts));
  const src = fs.readFileSync(path.join(root, 'apps', 'api', 'src', 'common', 'reset.ts'), 'utf8');
  ok('-shm با removeWithRetry حذف می‌شود', /removeWithRetry\(target \+ '-shm'\)/.test(src));
  ok('-wal با removeWithRetry حذف می‌شود', /removeWithRetry\(target \+ '-wal'\)/.test(src));
  ok('دیتابیس با محتوای پشتیبان برگشت', fs.readFileSync(path.join(dataDir2, 'farday.db'), 'utf8') === 'BACKUP');

  delete process.env.FD_DB_FILE;
}

console.log('\n— خطای غیرگذرا فوراً برمی‌گردد —');
{
  const bak = path.join(tmp, 'other.db');
  fs.writeFileSync(bak, 'X');
  const realCopy = fs.copyFileSync;
  let n = 0;
  fs.copyFileSync = () => { n++; const e = new Error('ENOSPC: no space left'); e.code = 'ENOSPC'; throw e; };
  let r;
  try { r = await restoreBackupDetailed(bak, { tries: 10, waitMs: 1 }); }
  finally { fs.copyFileSync = realCopy; }
  ok('ENOSPC یک بار امتحان می‌شود، نه ده بار', n === 1, String(n));
  ok('علت گزارش می‌شود', /ENOSPC/.test(String(r.error)), r.error);
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
