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
