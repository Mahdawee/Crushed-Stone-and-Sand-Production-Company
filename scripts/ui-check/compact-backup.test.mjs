/**
 * نگهبان پشتیبان فشرده — پیشنهاد B4، دور ۴۰.
 *
 *   node --experimental-sqlite scripts/ui-check/compact-backup.test.mjs
 *
 * این تست روی **SQLite واقعی** اجرا می‌شود، نه با mock. سه چیز می‌سنجد:
 *   ۱) فشرده‌سازی حجم را واقعاً کم می‌کند (فضای مرده را دور می‌ریزد).
 *   ۲) داده‌ی پشتیبان **کامل** است — تعداد ردیف‌ها و quick_check.
 *   ۳) قاعده‌ی ایمنی: اگر فشرده‌سازی شکست بخورد، پشتیبان اصلی سالم می‌ماند.
 *
 * بند ۳ مهم‌ترین بخش است. در دو نسخه‌ی اولیه‌ی طراحی، خطر «اول پاک کردن، بعد
 * ساختن» وجود داشت که در بدترین لحظه هیچ راه برگشتی نمی‌گذارد.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { makeBackup, compactBackup, restoreFromBackup } = await import(
  path.join(root, 'apps/api/dist/common/backup.js')
);

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— پشتیبان فشرده —');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-cmp-'));
try {
  const dbFile = path.join(dir, 'farday.db');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('CREATE TABLE "t"("id" INTEGER PRIMARY KEY, "a" TEXT)');
  const ins = db.prepare('INSERT INTO "t"("a") VALUES(?)');
  db.exec('BEGIN');
  for (let i = 0; i < 60000; i++) ins.run('ردیف-' + i + '-' + 'x'.repeat(120));
  db.exec('COMMIT');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const full = fs.statSync(dbFile).size;

  /* نیمی از داده پاک می‌شود: فضای مرده می‌ماند */
  db.exec('DELETE FROM "t" WHERE "id" % 2 = 0');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const afterDelete = fs.statSync(dbFile).size;
  const liveRows = db.prepare('SELECT COUNT(*) c FROM "t"').get().c;

  ok('پاک کردن ردیف‌ها فایل را کوچک نمی‌کند (فضای مرده می‌ماند)', afterDelete === full,
    `${(full / 1048576).toFixed(1)}MB → ${(afterDelete / 1048576).toFixed(1)}MB`);

  const bak = makeBackup(dbFile, path.join(dir, 'backups'), 'pre-reset');
  const copySize = fs.statSync(bak).size;
  ok('پشتیبان کاپی‌شده همان حجم فایل را دارد', copySize === full);

  const res = await compactBackup(bak, async (sql) => db.exec(sql));
  ok('فشرده‌سازی انجام شد', res !== null);
  ok('حجم واقعاً کم شد', !!res && res.bytes < copySize * 0.75,
    res ? `${(res.beforeBytes / 1048576).toFixed(1)}MB → ${(res.bytes / 1048576).toFixed(1)}MB` : 'null');

  /* صحت داده — مهم‌ترین بخش */
  const check = new DatabaseSync(bak);
  const rows = check.prepare('SELECT COUNT(*) c FROM "t"').get().c;
  ok('همه‌ی ردیف‌های زنده در پشتیبان هستند', rows === liveRows, `${rows} vs ${liveRows}`);
  ok('ردیف حذف‌شده برنگشته', rows < 60000, String(rows));
  ok('quick_check سالم است', check.prepare('PRAGMA quick_check').get().quick_check === 'ok');
  check.close();

  /* قاعده‌ی ایمنی: فشرده‌سازی ناموفق نباید پشتیبان را از بین ببرد */
  const bak2 = makeBackup(dbFile, path.join(dir, 'backups2'), 'pre-reset');
  const size2 = fs.statSync(bak2).size;
  const bad = await compactBackup(bak2, async () => { throw new Error('شبیه‌سازی شکست دیسک'); });
  ok('شکست فشرده‌سازی → null (نه استثنای رهاشده)', bad === null);
  ok('پشتیبان اصلی بعد از شکست سالم است', fs.existsSync(bak2) && fs.statSync(bak2).size === size2);
  const check2 = new DatabaseSync(bak2);
  ok('پشتیبان بعد از شکست قابل خواندن است',
    check2.prepare('SELECT COUNT(*) c FROM "t"').get().c === liveRows);
  check2.close();
  ok('فایل نیمه‌کاره باقی نمی‌ماند', !fs.existsSync(bak2 + '.compact'));

  /* فایل ناموجود → null، نه استثنا */
  ok('پشتیبان ناموجود → null', (await compactBackup(path.join(dir, 'nope.db'), async () => {})) === null);

  /* بازگردانی از پشتیبان فشرده باید کار کند */
  const target = path.join(dir, 'restore-target.db');
  fs.copyFileSync(dbFile, target);
  ok('بازگردانی از پشتیبان فشرده موفق است', restoreFromBackup(bak, target) === true);
  const restored = new DatabaseSync(target);
  ok('داده‌ی بازگردانی‌شده درست است',
    restored.prepare('SELECT COUNT(*) c FROM "t"').get().c === liveRows);
  restored.close();

  db.close();
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
