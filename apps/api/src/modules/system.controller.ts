import { Body, Controller, Get, Post, Query, Req, UseGuards, HttpException, Res } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db, databaseFile, BACKUP_DIR, resetDb } from '../db';
import { ensureSchemaAsync, TABLE_LIST } from '../schema';
import { AuthGuard, ManagerOnly, userOf } from '../common/auth';
import { logActivity } from '../common/activity';
import { settingsService } from '../common/settings';
import { dataDir } from '../db';
import { demoCounts, hasRealData, installDemo, removeDemo } from '../common/demo';

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

  /**
   * سابقه‌ی فعالیت ادغام‌شده با سطل بازیافت.
   *
   * درخواست کاربر: «سطل بازیافت را در بخش سابقه فعالیت ادغام کن».
   *
   * نسخه‌ی قبلی فقط `ActivityLog` را می‌داد. مشکل: برای دیدن «چه چیزی حذف
   * شد و کجاست» باید صفحه‌ی دیگری باز می‌شد، و از طرفی همه‌ی حذف‌ها در سابقه
   * با جزئیات کامل نبودند (مثلاً بل فروش فقط با شماره ثبت می‌شد).
   *
   * حالا هر حذف که ردیفش هنوز در سطل بازیافت است، با **عنوان و جزئیات
   * واقعی همان ردیف** و پرچم `restorable: true` برمی‌گردد؛ یعنی در یک
   * ستون زمانی می‌شود دید: چه ثبت شد، چه ویرایش شد، چه حذف شد و کدام‌ها
   * قابل بازگرداندن‌اند.
   */
  @Get('timeline')
  async timeline(@Query('limit') limit = '300', @Query('entity') entity?: string) {
    await ensureSchemaAsync();
    const p = db();
    const n = Math.min(1000, Math.max(20, Number(limit) || 300));
    const args: any[] = [];
    let where = '';
    if (entity) { where = `WHERE "entity"=?`; args.push(entity); }
    const logs: any[] = await p.$queryRawUnsafe(
      `SELECT * FROM "ActivityLog" ${where} ORDER BY "id" DESC LIMIT ?`, ...args, n,
    );

    /* ردیف‌هایی که واقعاً در سطل بازیافت‌اند — برای پرچم «قابل بازگرداندن» */
    const labels = ['Sale', 'Receipt', 'Expense', 'Customer', 'Employee', 'Salary', 'Attendance', 'Machinery'];
    const trashed = new Set<string>();
    const titles = new Map<string, { label: string; title: string }>();
    for (const table of labels) {
      try {
        const rows: any[] = await p.$queryRawUnsafe(
          `SELECT "id", COALESCE("deletedAt",'') d FROM "${table}" WHERE COALESCE("deletedAt",'')<>'' LIMIT 500`,
        );
        for (const r of rows) trashed.add(`${table}:${r.id}`);
      } catch { /* جدول ممکن است ستون حذف نرم نداشته باشد */ }
    }
    /*
     * عنوان خوانا برای حذف‌هایی که جزئیاتشان در سابقه ناقص است
     * (مثلاً «بل فروش #۱۲» به‌جای فقط «حذف»). یک کوئری به‌ازای هر جدول،
     * فقط برای شناسه‌هایی که در سابقه آمده‌اند.
     */
    const SOFT: Record<string, { label: string; titleCol: string }> = {
      Sale: { label: 'بل فروش', titleCol: 'no' },
      Receipt: { label: 'رسید', titleCol: 'no' },
      Expense: { label: 'مصرف', titleCol: 'no' },
      Customer: { label: 'مشتری', titleCol: 'name' },
      Employee: { label: 'کارمند', titleCol: 'name' },
      Salary: { label: 'سند معاش', titleCol: 'no' },
      Attendance: { label: 'حضور و غیاب', titleCol: 'date' },
      Machinery: { label: 'ماشین', titleCol: 'name' },
    };
    const idsByTable = new Map<string, number[]>();
    for (const l of logs) {
      if (!SOFT[l.entity]) continue;
      const id = Number(l.entityId);
      if (!Number.isFinite(id) || id <= 0) continue;
      const arr = idsByTable.get(l.entity) || [];
      arr.push(id);
      idsByTable.set(l.entity, arr);
    }
    for (const [table, ids] of idsByTable) {
      const uniq = [...new Set(ids)].slice(0, 300);
      if (!uniq.length) continue;
      try {
        const rows: any[] = await p.$queryRawUnsafe(
          `SELECT "id", "${SOFT[table].titleCol}" AS t FROM "${table}" WHERE "id" IN (${uniq.map(() => '?').join(',')})`,
          ...uniq,
        );
        for (const r of rows) titles.set(`${table}:${r.id}`, { label: SOFT[table].label, title: String(r.t ?? '') });
      } catch { /* ignore */ }
    }

    return logs.map((l) => {
      const key = `${l.entity}:${Number(l.entityId)}`;
      const t = titles.get(key);
      const restorable = trashed.has(key) && ['soft-delete', 'delete'].includes(String(l.action));
      return {
        ...l,
        entityLabel: SOFT[l.entity]?.label || l.entity,
        rowTitle: t?.title || '',
        restorable,
        softDeleted: restorable,
      };
    });
  }

  // ------------------------------- demo data -------------------------------
  /**
   * داده‌ی نمونه — نصب و حذف موقت.
   *
   * درخواست کاربر: «یک گزینه‌ی موقتِ نصب و حذف داده‌های نمونه».
   * فقط مدیر: داده‌ی نمونه همه‌ی گزارش‌ها را تغییر می‌دهد.
   */
  @Get('demo')
  @ManagerOnly()
  async demoStatus() {
    const counts = await demoCounts();
    const real = await hasRealData();
    return { counts, real, installed: counts.total > 0 };
  }

  @Post('demo/install')
  @ManagerOnly()
  async demoInstall(@Req() req: any, @Body() body: { months?: number; force?: boolean }) {
    const real = await hasRealData();
    const existing = await demoCounts();
    if (existing.total > 0) {
      throw new HttpException('داده‌ی نمونه از قبل نصب است. اول آن را حذف کنید.', 400);
    }
    /*
     * اگر داده‌ی واقعی وجود دارد، نصب نمونه گزارش‌های واقعی را با عددهای
     * ساختگی قاطی می‌کند. این کار ممنوع نیست (برای آموزش لازم است) ولی
     * باید صریح تأیید شود — نه با یک کلیک اتفاقی.
     */
    if ((real.sales + real.employees + real.customers) > 0 && !body?.force) {
      throw new HttpException(
        'در این دیتابیس داده‌ی واقعی وجود دارد. اگر داده‌ی نمونه اضافه شود، در گزارش‌ها با هم دیده می‌شوند. برای ادامه «تأیید» را بزنید.', 409,
      );
    }
    const r = await installDemo({ months: body?.months, username: userOf(req) });
    if (!r.ok) throw new HttpException('داده‌ی نمونه نصب نشد.', 400);
    return { ok: true, ...r, message: `${r.total} ردیف نمونه نصب شد.` };
  }

  @Post('demo/remove')
  @ManagerOnly()
  async demoRemove(@Req() req: any) {
    const r = await removeDemo({ username: userOf(req) });
    return {
      ok: true, ...r,
      message: r.total
        ? `${r.total} ردیف نمونه به «سطل بازیافت» رفت (قابل بازگرداندن).`
        : 'داده‌ی نمونه‌ای برای حذف نبود.',
    };
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
    /*
     * پس از بازگردانی، فایل دیتابیس عوض شده؛ کش «ساختار بررسی شد» هم باید
     * پاک شود وگرنه برنامه به فایل تازه اعتماد می‌کند بدون بررسی ستون‌ها
     * (نسخه‌های قدیمی‌تر پشتیبان).
     */
    await ensureSchemaAsync(true);
    /* کش تنظیمات مربوط به فایل قبلی است — پاک شود */
    settingsService.clearCache();
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
