import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkBackupFile } from './backup-check';

/** A standalone, validated SQLite snapshot, including committed WAL pages.
 * The output name must be unique. A private temporary directory keeps partially
 * written snapshots out of the backup list; failures never replace old backups.
 */
export async function snapshotDatabase(file: string, exec: (sql: string) => Promise<unknown>): Promise<void> {
  const dir = path.dirname(file);
  const tmpDir = fs.mkdtempSync(path.join(dir, '.snapshot-'));
  const tmp = path.join(tmpDir, 'snapshot.db');
  try {
    if (fs.existsSync(file)) throw new Error('فایل پشتیبان از قبل وجود دارد.');
    await exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    // VACUUM produces a standalone DB. Preserve WAL mode like the live app:
    // restoring a DELETE-mode database over a live WAL database can fail.
    const snapshot = new DatabaseSync(tmp);
    try {
      const mode = snapshot.prepare('PRAGMA journal_mode=WAL').get() as { journal_mode?: string };
      if (mode?.journal_mode?.toLowerCase() !== 'wal') throw new Error('حالت WAL برای پشتیبان آماده نشد.');
      snapshot.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
    } finally { snapshot.close(); }
    const verified = checkBackupFile(tmp, fs.statSync(tmp).size);
    if (!verified.ok) throw new Error(verified.message);
    // The published file must stand alone; never silently drop live WAL pages.
    if (fs.existsSync(tmp + '-wal') && fs.statSync(tmp + '-wal').size > 0) {
      throw new Error('پشتیبان هنوز به فایل WAL وابسته است.');
    }
    // link() publishes atomically and refuses to replace an existing file.
    fs.linkSync(tmp, file);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
