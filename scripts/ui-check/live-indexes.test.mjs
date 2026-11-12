/**
 * نگهبان ایندکس‌های «فقط ردیف‌های زنده» — و ترتیب ساختشان.
 *
 *   node scripts/ui-check/live-indexes.test.mjs
 *
 * ── چرا این تست (پیشنهاد B2، دور ۴۰) ───────────────────────────────────
 * وقتی ایندکس‌های جزئی را اضافه کردم، برنامه با
 *     SQLITE_ERROR: no such column: deletedAt
 * بالا نیامد — چون INDEXES **قبل از** UPGRADES اجرا می‌شود و روی دیتابیس تازه
 * ستون deletedAt هنوز نیست. این تست همان ترتیب را برای همیشه قفل می‌کند.
 *
 * و اندازه‌گیری واقعی روی SQLite: ایندکس جزئی باید واقعاً در پلن کوئری
 * استفاده شود، نه فقط ساخته شود. ایندکسی که استفاده نشود فقط کندیِ نوشتن است.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schema = fs.readFileSync(path.join(root, 'apps/api/src/schema.ts'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— ایندکس‌های «فقط ردیف‌های زنده» —');

/* ۱) ایندکس جزئی باید در فهرست جدا باشد، نه در INDEXES */
const indexesBlock = /const INDEXES = \[([\s\S]*?)\n\];/.exec(schema)?.[1] || '';
ok('ایندکس جزئی در INDEXES نیست (قبل از مهاجرت ستون‌ها اجرا می‌شود)',
  !/WHERE "deletedAt" IS NULL/.test(indexesBlock));

const liveBlock = /const LIVE_INDEXES = \[([\s\S]*?)\n\];/.exec(schema)?.[1] || '';
ok('فهرست LIVE_INDEXES وجود دارد', liveBlock.length > 0);
ok('حداقل ۳ ایندکس جزئی دارد', (liveBlock.match(/CREATE INDEX/g) || []).length >= 3,
  String((liveBlock.match(/CREATE INDEX/g) || []).length));

/* ۲) LIVE_INDEXES بعد از حلقه‌ی UPGRADES اجرا می‌شود */
const iUpgrades = schema.indexOf('for (const u of UPGRADES)');
const iLive = schema.indexOf('for (const sql of LIVE_INDEXES)');
ok('UPGRADES قبل از LIVE_INDEXES در کد می‌آید', iUpgrades > -1 && iLive > iUpgrades,
  `upgrades=${iUpgrades} live=${iLive}`);

/* ۳) شکست ایندکس برنامه را نمی‌خواباند (try/catch) */
ok('ساخت ایندکس در try/catch است (برنامه با یک ایندکس نمی‌میرد)',
  /try \{ await p\.\$executeRawUnsafe\(sql\); \}[\s\S]{0,120}catch/.test(schema));

/* ۴) امنیت: ایندکس با "IS NULL" همان مجموعه‌ی COALESCE(...,'')='' است */
{
  const sd = fs.readFileSync(path.join(root, 'apps/api/src/common/soft-delete.ts'), 'utf8');
  ok('حذف نرم با timestamp می‌نویسد (نه رشته‌ی خالی)', /stamp/.test(sd));
  ok('بازیابی صریحاً NULL می‌گذارد', /"deletedAt" = NULL/.test(sd));
  ok('هیچ مسیری deletedAt را \'\' نمی‌نویسد', !/deletedAt"?\s*=\s*''/.test(sd + schema));
}

/* ۵) آزمون زنده: ایندکس واقعاً در پلن استفاده می‌شود */
console.log('\n— آزمون زنده روی SQLite —');
{
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE "Sale"("id" INTEGER PRIMARY KEY,"date" TEXT,"customerId" INTEGER,"total" REAL,"deletedAt" TEXT)`);
  const ins = db.prepare(`INSERT INTO "Sale"("date","customerId","total","deletedAt") VALUES(?,?,?,?)`);
  db.exec('BEGIN');
  for (let i = 0; i < 5000; i++) {
    ins.run(`2026-${String(1 + (i % 12)).padStart(2, '0')}-15`, 1 + (i % 200), i, i % 7 === 0 ? '2026-05-01T00:00:00.000Z' : null);
  }
  db.exec('COMMIT');
  db.exec(`CREATE INDEX "Sale_live_date_idx" ON "Sale"("date") WHERE "deletedAt" IS NULL`);

  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT SUM("total") FROM "Sale" WHERE "deletedAt" IS NULL AND "date">=? AND "date"<=?`)
    .all('2026-01-01', '2026-03-01').map((r) => r.detail).join(' | ');
  ok('پلن کوئری از ایندکس جزئی استفاده می‌کند', /Sale_live_date_idx/.test(plan), plan);
  ok('پلن، SCAN کامل نیست', !/^SCAN/.test(plan), plan);

  /* درستی نتیجه: حذف‌شده‌ها نباید در جمع بیایند */
  const sum = db.prepare(`SELECT COALESCE(SUM("total"),0) s FROM "Sale" WHERE "deletedAt" IS NULL`).get().s;
  const all = db.prepare(`SELECT COALESCE(SUM("total"),0) s FROM "Sale"`).get().s;
  ok('مجموع «زنده» با مجموع کل فرق دارد (حذف‌شده‌ها کنار گذاشته شدند)', sum < all, `${sum} vs ${all}`);
  const deleted = db.prepare(`SELECT COUNT(*) c FROM "Sale" WHERE "deletedAt" IS NOT NULL`).get().c;
  ok('ردیف حذف‌شده در آزمون هست', deleted > 0, String(deleted));
  db.close();
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
