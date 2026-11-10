import { Body, Controller, Get, Post, Query, UseGuards, HttpException, Res } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db, databaseFile, BACKUP_DIR, resetDb } from '../db';
import { ensureSchemaAsync, TABLE_LIST } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { logActivity } from '../common/activity';
import { settingsService } from '../common/settings';
import { dataDir } from '../db';

/**
 * خودآزمایی «بدون نصب چیز اضافه» — همان چیزی که روی کمپیوتر کاربر مهم است.
 *
 * چرا در خود برنامه: بسته‌بندی می‌تواند روی کمپیوتر دیگری (مثلاً لینوکس) انجام
 * شود. اگر باینری ویندوزی libSQL جا افتاده باشد، برنامه روی ویندوز بالا
 * نمی‌آید؛ با این بررسی، مشکل **قبل از تحویل** و از داخل خود برنامه دیده
 * می‌شود: node همراه، باینری libSQL، و قابلیت نوشتن در پوشه داده.
 */
function runtimeCheck() {
  const os = require('node:os') as typeof import('node:os');

  /**
   * باینری‌های از پیش ساخته شده در **چند** جا ممکن است باشند:
   *   • نسخه‌ی نصب‌شده: `<app.js کنار node.exe>/node_modules`
   *   • حالت توسعه:   `<repo>/node_modules`
   *   • اجرا از داخل repo: `process.cwd()/node_modules`
   */
  const searchDirs = [
    path.join(__dirname, 'node_modules'),
    path.join(__dirname, '..', '..', 'node_modules'),
    path.join(process.cwd(), 'node_modules'),
    path.join(process.cwd(), '..', 'node_modules'),
  ];

  const findBinary = (pkgs: string[]): string | null => {
    for (const pkg of pkgs) {
      for (const base of searchDirs) {
        const p = path.join(base, ...pkg.split('/'), 'index.node');
        if (fs.existsSync(p)) return pkg;
      }
    }
    return null;
  };

  const wanted =
    process.platform === 'win32'
      ? ['@libsql/win32-x64-msvc']
      : process.platform === 'linux'
        ? ['@libsql/linux-x64-gnu', '@libsql/linux-x64-musl']
        : [];
  const found = wanted.length ? findBinary(wanted) : 'native/n-a';
  const sqlite = wanted.length === 0 ? 'ok (پلتفرم بدون باینری از پیش‌ساخته)' : found ? 'ok' : `missing (${wanted.join(' / ')})`;

  let writable = false;
  try {
    const probe = path.join(dataDir(), `.write-test-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    writable = true;
  } catch { /* ignore */ }

  /* node.exe همراه برنامه؟ در نسخه‌ی نصب‌شده کنار app.js است */
  const bundledNode =
    fs.existsSync(path.join(__dirname, process.platform === 'win32' ? 'node.exe' : 'node')) ||
    fs.existsSync(path.join(__dirname, '..', process.platform === 'win32' ? 'node.exe' : 'node'));

  return {
    bundledNode,
    sqlite,
    sqliteBinary: found,
    platform: `${process.platform}-${process.arch}`,
    arch: os.arch(),
    totalMemGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    writableDataDir: writable,
  };
}

@UseGuards(AuthGuard)
@Controller('system')
export class SystemController {
  // ------------------------------- activity --------------------------------
  @Get('activity')
  async activity(@Query('limit') limit = '200', @Query('entity') entity?: string) {
    await ensureSchemaAsync();
    const args: any[] = [];
    let where = '';
    if (entity) { where = `WHERE "entity"=?`; args.push(entity); }
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "ActivityLog" ${where} ORDER BY "id" DESC LIMIT ?`,
      ...args, Math.min(2000, Number(limit) || 200),
    );
    return rows;
  }

  // -------------------------------- backup ---------------------------------
  @Get('backup/list')
  @ManagerOnly()
  async listBackups() {
    const dir = BACKUP_DIR();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db') || f.endsWith('.bak'));
    const rows = files.map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, createdAt: st.mtime.toISOString() };
    });
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { dir, rows };
  }

  /** دانلود فایل پشتیبان (برای کاپی روی فلش یا کمپیوتر دیگر). */
  @Get('backup/download')
  @ManagerOnly()
  async downloadBackup(@Query('file') file: string, @Res() res: any) {
    const name = path.basename(String(file || ''));
    const full = path.join(BACKUP_DIR(), name);
    if (!name || !fs.existsSync(full)) throw new HttpException('فایل پشتیبان پیدا نشد.', 404);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.sendFile(full);
  }

  @Post('backup')
  @ManagerOnly()
  async backup(@Body() body: { note?: string }) {
    await ensureSchemaAsync();
    const src = databaseFile();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(BACKUP_DIR(), `farday-${stamp}.db`);
    // checkpoint the WAL so the copy is consistent
    try { await db().$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    fs.copyFileSync(src, file);
    // keep the last 30 backups
    const all = fs.readdirSync(BACKUP_DIR()).filter((f) => f.endsWith('.db')).sort();
    while (all.length > 30) {
      const old = all.shift();
      if (old) fs.rmSync(path.join(BACKUP_DIR(), old!), { force: true });
    }
    await logActivity({ action: 'backup', entity: 'System', detail: file });
    return { ok: true, file: path.basename(file), dir: BACKUP_DIR(), size: fs.statSync(file).size };
  }

  @Post('restore')
  @ManagerOnly()
  async restore(@Body() body: { file: string }) {
    const name = path.basename(String(body?.file || ''));
    const full = path.join(BACKUP_DIR(), name);
    if (!fs.existsSync(full)) throw new HttpException('فایل پشتیبان پیدا نشد.', 404);
    const target = databaseFile();
    // safety copy of the current database before overwriting
    const safety = path.join(BACKUP_DIR(), `before-restore-${Date.now()}.db`);
    try { fs.copyFileSync(target, safety); } catch { /* ignore */ }
    try { await db().$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    /*
     * باگ جدی: اتصال باز روی فایل قدیمی باقی می‌ماند، پس بعد از «بازگردانی»
     * برنامه همان داده‌ی قبل را نشان می‌داد و بازگردانی به نظر شکست‌خورده
     * می‌آمد. حالا اتصال بسته و دوباره باز می‌شود.
     */
    await resetDb();
    fs.copyFileSync(full, target);
    await ensureSchemaAsync();
    await logActivity({ action: 'restore', entity: 'System', detail: name });
    return { ok: true, restored: name, safetyCopy: path.basename(safety), restartRequired: false };
  }

  // ------------------------------ diagnostics ------------------------------
  @Get('health')
  async health() {
    const started = Date.now();
    let tables: any[] = [];
    try {
      tables = await db().$queryRawUnsafe(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );
    } catch { /* ignore */ }
    const names = tables.map((t) => t.name);
    const missing = TABLE_LIST.filter((t) => !names.includes(t));
    let userCount = 0;
    try {
      const u: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) c FROM "User"`);
      userCount = Number(u?.[0]?.c ?? 0);
    } catch { /* ignore */ }
    return {
      dbFile: databaseFile(),
      tables: names,
      missingTables: missing,
      schemaOk: missing.length === 0,
      userCount,
      ms: Date.now() - started,
      version: process.versions.node,
      calendar: await settingsService.calendar(),
    };
  }

  @Post('health/repair')
  @ManagerOnly()
  async repair() {
    await ensureSchemaAsync();
    return this.health();
  }

  @Get('info')
  async info() {
    const st = fs.existsSync(databaseFile()) ? fs.statSync(databaseFile()) : null;
    return {
      dbFile: databaseFile(),
      dbSize: st?.size ?? 0,
      backupDir: BACKUP_DIR(),
      node: process.versions.node,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
      dataDir: process.env.FD_DATA_DIR || '(local ./data)',
      runtime: runtimeCheck(),
    };
  }
}
