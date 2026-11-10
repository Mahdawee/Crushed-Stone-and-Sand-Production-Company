/**
 * Backup from the command line (useful for a daily Windows Task Scheduler job).
 *
 *   node dist/cli/backup.js            یک پشتیبان تازه بساز
 *   node dist/cli/backup.js --list     فهرست پشتیبان‌ها
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db, databaseFile, BACKUP_DIR } from '../db';
import { ensureSchemaAsync } from '../schema';

async function main() {
  await ensureSchemaAsync();
  const dir = BACKUP_DIR();
  if (process.argv.includes('--list')) {
    for (const f of fs.readdirSync(dir).sort().reverse()) {
      const st = fs.statSync(path.join(dir, f));
      console.log(`${f}  ${(st.size / 1024).toFixed(0)} KB  ${st.mtime.toISOString()}`);
    }
    return;
  }
  try { await db().$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `farday-${stamp}.db`);
  fs.copyFileSync(databaseFile(), file);
  // keep the last 30
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  while (all.length > 30) fs.rmSync(path.join(dir, all.shift()!), { force: true });
  console.log(`✔ پشتیبان ساخته شد: ${file}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
