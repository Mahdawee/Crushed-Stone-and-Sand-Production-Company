/**
 * ابزار نجات (Recovery) برای نسخه‌ی نصب‌شده — بدون نیاز به انترنت یا پشتیبانی.
 *
 *   node app.js --recovery                 وضعیت را نشان بده (پیش‌فرض)
 *   node app.js --recovery --reset-admin   رمز مدیر را به admin123 برگردان
 *   node app.js --recovery --list-backups  فهرست پشتیبان‌ها
 *
 * چرا لازم است: اگر مدیر رمز خود را فراموش کند یا همه‌ی کاربران قفل شوند،
 * تا امروز هیچ راهی جز «نصب مجدد و از دست دادن داده» نبود — در حالی که
 * برنامه روی یک کمپیوتر آفلاین اجرا می‌شود و مدیر باید خودش بتواند نجاتش
 * بدهد. این مسیر بدون پوسته (بدون WebView) کار می‌کند.
 *
 * امنیت: این ابزار فقط از روی همان کمپیوتر (با دسترسی به پوشه‌ی داده) قابل
 * استفاده است — یعنی کسی که دسترسی فیزیکی/کاربری دارد. همین سطح دسترسی
 * برای پاک کردن فایل دیتابیس هم کافی است، پس سطح حمله‌ی تازه‌ای باز نمی‌شود.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db, databaseFile, dataDir, BACKUP_DIR } from '../db';
import { ensureSchemaAsync } from '../schema';
import { hashPassword } from '../common/auth';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);

async function status() {
  const file = databaseFile();
  const exists = fs.existsSync(file);
  const size = exists ? fs.statSync(file).size : 0;
  console.log('\n— وضعیت برنامه —');
  console.log(`  پوشه داده : ${dataDir()}`);
  console.log(`  فایل داده : ${file}${exists ? '' : '  (ساخته می‌شود)'}`);
  console.log(`  حجم       : ${(size / 1024 / 1024).toFixed(2)} مگابایت`);
  await ensureSchemaAsync();
  const p = db();
  const tables = ['User', 'Customer', 'Employee', 'Sale', 'Receipt', 'Expense', 'Salary', 'Attendance'];
  for (const t of tables) {
    const r = (await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "${t}"`).catch(() => [])) as any[];
    console.log(`  ${t.padEnd(11)}: ${r?.[0]?.c ?? '؟'}`);
  }
  const users = (await p
    .$queryRawUnsafe(`SELECT "username","fullName","role","active" FROM "User" ORDER BY "id"`)
    .catch(() => [])) as any[];
  if (users.length) {
    console.log('\n  کاربران:');
    for (const u of users) console.log(`   • ${u.username} (${u.fullName}) — ${u.role}${u.active ? '' : ' [غیرفعال]'}`);
  }
}

function listBackups() {
  const dir = BACKUP_DIR();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  console.log(`\n— پشتیبان‌ها (${dir}) —`);
  if (!files.length) return console.log('  هیچ فایل پشتیبانی نیست.');
  for (const f of files) {
    const st = fs.statSync(path.join(dir, f));
    console.log(`  • ${f}  —  ${(st.size / 1024 / 1024).toFixed(2)} مگابایت  —  ${st.mtime.toISOString()}`);
  }
}

async function resetAdmin() {
  await ensureSchemaAsync();
  const p = db();
  const rows: any[] = await p.$queryRawUnsafe(`SELECT "id" FROM "User" WHERE "username"='admin'`);
  if (rows?.length) {
    await p.$executeRawUnsafe(
      `UPDATE "User" SET "passwordHash"=?, "active"=1, "role"='manager' WHERE "username"='admin'`,
      hashPassword('admin123'),
    );
  } else {
    await p.$executeRawUnsafe(
      `INSERT INTO "User" ("username","fullName","passwordHash","role","active") VALUES (?,?,?,?,1)`,
      'admin',
      'مدیر سیستم',
      hashPassword('admin123'),
      'manager',
    );
  }
  console.log('\n✔ رمز کاربر «admin» به admin123 برگردانده شد (نقش: مدیر، فعال).');
  console.log('  حالا برنامه را باز کنید، وارد شوید و رمز را از صفحه‌ی تنظیمات عوض کنید.\n');
}

async function main() {
  console.log('ابزار نجات فردای روشن');
  if (has('--list-backups')) listBackups();
  if (has('--reset-admin')) await resetAdmin();
  if (!has('--list-backups') || has('--recovery')) await status();
  console.log('\nگزینه‌ها:  --reset-admin   --list-backups\n');
}

/**
 * از داخل برنامه (سوئیچ `--cli`) پنجره‌ی کنسول تازه باز می‌شود؛ بدون توقف،
 * پنجره همان لحظه بسته می‌شد و کاربر پیام «رمز برگشت» را نمی‌دید.
 */
async function pauseIfAsked() {
  if (process.env.FD_CLI_PAUSE !== '1') return;
  if (!process.stdin.isTTY) return;
  await new Promise<void>((resolve) => {
    const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nبرای بستن این پنجره Enter را بزنید…', () => {
      rl.close();
      resolve();
    });
  });
}

main()
  .then(pauseIfAsked)
  .catch(async (e) => {
    console.error('\n⛔ خطا:', e?.message || e);
    await pauseIfAsked();
    process.exit(1);
  });
