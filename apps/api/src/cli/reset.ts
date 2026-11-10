/**
 * Reset / factory-state CLI.
 *
 *   node dist/cli/reset.js --status          شمارش ردیف‌های هر جدول
 *   node dist/cli/reset.js --yes             پاک کردن همه معلومات کاری
 *   node dist/cli/reset.js --yes --keep-masters   فقط اسناد (کارمندان و مشتریان بمانند)
 *   node dist/cli/reset.js --yes --all       همه چیز (فهرست‌ها هم) — کاربران نمی‌مانند؟ نه: کاربران می‌مانند
 */
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { logActivity } from '../common/activity';

const DOC_TABLES = ['Sale', 'Receipt', 'Expense', 'Salary', 'Attendance', 'ActivityLog', 'Sequence'];
const MASTER_TABLES = ['Customer', 'Employee', 'Machinery'];
const LOOKUP_TABLES = ['LookupItem'];

async function status() {
  const p = db();
  for (const t of [...DOC_TABLES, ...MASTER_TABLES, ...LOOKUP_TABLES, 'User', 'Setting']) {
    const r: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "${t}"`);
    console.log(`${t.padEnd(16)} ${r?.[0]?.c ?? 0}`);
  }
}

async function main() {
  await ensureSchemaAsync();
  const args = process.argv.slice(2);
  if (args.includes('--status') || !args.includes('--yes')) {
    await status();
    if (!args.includes('--yes')) {
      console.log('\nبرای پاک کردن: --yes   (با --keep-masters فقط اسناد پاک می‌شود، با --all فهرست‌ها هم)');
    }
    return;
  }
  const keepMasters = args.includes('--keep-masters');
  const all = args.includes('--all');
  const p = db();
  const tables = [...DOC_TABLES, ...(keepMasters ? [] : MASTER_TABLES), ...(all ? LOOKUP_TABLES : [])];
  for (const t of tables) await p.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await p.$executeRawUnsafe('VACUUM');
  await logActivity({ action: 'delete', entity: 'System', detail: `ریست: ${tables.join(', ')}` });
  console.log(`✔ پاک شد: ${tables.join(', ')}`);
  console.log('   تنظیمات، مشخصات شرکت و کاربران سیستم محفوظ ماند.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
