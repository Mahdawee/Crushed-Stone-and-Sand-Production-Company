import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, HttpException, Res } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db, databaseFile, BACKUP_DIR, resetDb } from '../db';
import { ensureSchemaAsync, TABLE_LIST } from '../schema';
import { AuthGuard, ManagerOnly, Public, userOf } from '../common/auth';
import { logActivity } from '../common/activity';
import { settingsService } from '../common/settings';
import { dataDir } from '../db';
import { ensureSqliteEngine, nativePackageName, type EngineStatus } from '../common/sqlite-engine';
import { checkBackupFile } from '../common/backup-check';
import { buildZip, safeEntryName } from '../common/zip';
import { isFolderKey, openFolder } from '../common/open-folder';
import { SHAPE_VERSION, appVersion, recentUpgrades } from '../common/upgrade';
import { SOFT_TABLES, deletedCounts } from '../common/soft-delete';
import { demoCounts, hasRealData, installDemo, removeDemo } from '../common/demo';
import {
  RESET_PHRASE, dataInventory, resetMark, resetPlan, resetSystem, workingRowCount, type ResetOptions,
} from '../common/reset';

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

  /*
   * ⚠ این‌جا فقط «یک منبع حقیقت» داریم: `common/sqlite-engine.ts`.
   *
   * کد قبلی مسیرها را دستی می‌ساخت و `__dirname/../../node_modules` را
   * بررسی می‌کرد. در بسته‌ی نصب‌شده `__dirname` = `<resources>\api\modules`
   * است، پس مسیر درست (`<resources>\api\node_modules`) **هرگز** دیده نمی‌شد
   * و صفحه‌ی شروع «missing (@libsql/win32-x64-msvc)» نشان می‌داد، در حالی
   * که دیتابیس سالم کار می‌کرد (کاربر همین را گزارش کرد).
   *
   * اکنون همان تابعی که واقعاً موتور را بار می‌کند گزارش می‌دهد.
   */
  let engine: EngineStatus;
  try {
    engine = ensureSqliteEngine();
  } catch (e: any) {
    engine = {
      ok: false,
      package: nativePackageName(),
      file: null,
      checked: [],
      detail: e?.message || String(e),
    };
  }

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

  const sqlite = engine.ok ? 'ok' : `missing (${engine.package})`;

  return {
    bundledNode,
    sqlite,
    sqliteBinary: engine.file,
    sqlitePackage: engine.package,
    /* جاهایی که جست‌وجو شد — برای پیام پشتیبانی، نه برای کاربر عادی */
    sqliteChecked: engine.checked.slice(0, 12),
    sqliteDetail: engine.detail,
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
  /**
   * سابقه‌ی فعالیت.
   *
   * `trash=0` ⟵ پرچم «قابل بازگرداندن» را نمی‌سازد.
   *
   * باگ ضد‌سرعت (شکار باگ دور ۳۲): برای هر بار باز کردن صفحه‌ی فعالیت،
   * ۹ کوئری `SELECT id FROM "<table>" WHERE deletedAt<>''` روی **همه‌ی**
   * جدول‌های حذف‌نرم اجرا می‌شد تا فقط پرچم «قابل بازگرداندن» ساخته شود —
   * با ۱۰ هزار سند و ۹ جدول، این کار باز کردن صفحه را کند می‌کرد و با
   * بزرگ‌تر شدن داده بدتر می‌شد. حالا: (۱) هر جدول فقط اگر واقعاً ردیف
   * حذف‌شده داشته باشد پرسیده می‌شود (با `deletedCounts` که از قبل و
   * به‌صورت شمارشی است)، و (۲) صفحه‌ی «رویدادها» می‌تواند با `trash=0`
   * این بخش را کامل رد کند.
   */
  @Get('timeline')
  async timeline(
    @Query('limit') limit = '300', @Query('entity') entity?: string, @Query('trash') trash?: string,
  ) {
    await ensureSchemaAsync();
    const p = db();
    const n = Math.min(1000, Math.max(20, Number(limit) || 300));
    const withTrash = trash !== '0' && trash !== 'false';
    const args: any[] = [];
    let where = '';
    if (entity) { where = `WHERE "entity"=?`; args.push(entity); }
    const logs: any[] = await p.$queryRawUnsafe(
      `SELECT * FROM "ActivityLog" ${where} ORDER BY "id" DESC LIMIT ?`, ...args, n,
    );

    /* ردیف‌هایی که واقعاً در سطل بازیافت‌اند — برای پرچم «قابل بازگرداندن» */
    /*
     * ── باگ منطقی (شکار باگ دور ۲۹) ────────────────────────────────────────
     * این فهرست باید **همه‌ی** جدول‌های حذف‌نرم را داشته باشد، ولی
     * `RecycleController` از `SOFT_TABLES` استفاده می‌کند. اگر جدولی فقط در
     * یک‌جا باشد، ردیفِ حذف‌شده‌اش در «سابقه فعالیت» دکمه‌ی «بازگرداندن»
     * نمی‌گیرد (یا برعکس). حالا هر دو از همان یک منبع می‌خوانند.
     */
    const labels = Object.keys(SOFT_TABLES);
    const trashed = new Set<string>();
    const titles = new Map<string, { label: string; title: string }>();
    /* جدول‌های خالی از حذف‌شده را حتی نپرس — شمارش از قبل داریم */
    let nonEmpty: string[] = labels;
    if (withTrash) {
      try {
        const counts = await deletedCounts();
        nonEmpty = labels.filter((t) => Number(counts?.[t] ?? 0) > 0);
      } catch { nonEmpty = labels; }
    }
    for (const table of (withTrash ? nonEmpty : [])) {
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
    /* عنوان/برچسب از همان منبع سطل بازیافت — نه یک کاپی دوم که از آن جدا می‌افتد */
    const SOFT = SOFT_TABLES;
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

  // ------------------------------ zero / reset -----------------------------
  /**
   * «صفر کردن کامل سیستم» — فقط از راه ابزار بیرونی `tools/reset-ui`.
   *
   * درخواست کاربر: «صفر کردن تمام داده‌ها و تحویل سیستم آک، به‌صورت یک ابزار
   * بیرونی در پوشه‌ی tools، نه در داخل برنامه».
   *
   * پس چرا این مسیر در API هست؟ چون تنها راه **اجرای مطمئن** روی یک برنامه‌ی
   * نصب‌شده همی�ن است: دیتابیس در حال اجرا قفل است و فایلش دست پراسس است؛
   * پاک کردن فایل از بیرون، برنامه‌ی در حال اجرا را با «دیتابیس قفل‌شده» یا
   * داده‌ی نیمه‌پاک رها می‌کند. ابزار بیرونی صفحه را نشان می‌دهد، تأیید
   * می‌گیرد و همین یک مسیر را صدا می‌زند.
   *
   * حفاظ‌ها (همه قبل از اولین تغییر):
   *   • فقط `127.0.0.1` (برنامه آفلاین است؛ درخواست از شبکه رد می‌شود)
   *   • فقط نقش مدیر
   *   • عبارت تأیید `صفر کردن`
   *   • پشتیبان اجباری، که بدون آن هیچ‌چیز پاک نمی‌شود
   */
  @Get('reset/info')
  @ManagerOnly()
  async resetInfo() {
    const inv = await dataInventory();
    const plan = await resetPlan();
    return {
      ...inv,
      plan,
      mark: resetMark(),
      phrase: RESET_PHRASE,
      /* آک بودن: صفر ردیف داده‌ی کاری */
      clean: (await workingRowCount()) === 0,
    };
  }

  /**
   * نام کاربر ویندوز/سیستم — پیشنهاد C3، دور ۴۰.
   *
   * رابط برنامه این را می‌گیرد و در هدر `x-operator` هنگام «صفر کردن»
   * می‌فرستد، تا تاریخچه بگوید کدام شخص روی کدام کمپیوتر این کار را کرد.
   *
   * ⚠ فقط نام کاربری سیستم برمی‌گردد — نه مسیر خانه، نه نام کامل، نه هیچ
   * چیز دیگری. و برای کاربر مدیر است، نه هر کسی.
   */
  @Get('operator')
  @ManagerOnly()
  operator() {
    const os = require('node:os') as typeof import('node:os');
    let user = '';
    try { user = os.userInfo().username || ''; } catch { /* ignore */ }
    return { osUser: user, host: os.hostname() || '' };
  }

  @Post('reset')
  @ManagerOnly()
  async resetNow(@Req() req: any, @Body() body: ResetOptions) {
    /*
     * فقط از همین کمپیوتر: آدرس شبکه (مثلاً 192.168.1.5:4317) همان مسیر را
     * اجرا می‌کند، و پاک‌کردن کل دیتابیس از روی شبکه نباید ممکن باشد.
     */
    const ip = String(req?.ip || req?.socket?.remoteAddress || '');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1', ''].some((a) => ip.endsWith(a))) {
      throw new HttpException('این عملیات فقط از خودِ همین کمپیوتر ممکن است.', 403);
    }
    const who = userOf(req) || 'system';
    /*
     * ── نشان اپراتور (پیشنهاد C3، دور ۴۰) ──────────────────────────────
     * پیش از این فقط نام کاربری ثبت می‌شد. روی یک کمپیوتر اداری با دو
     * اکانت ویندوز، «admin» کافی نیست: وقتی بعداً می‌پرسند «چه کسی این
     * سیستم را صفر کرد؟» باید بشود گفت «حساب ویندوزیِ کدام شخص».
     *
     * از هدر `x-operator` استفاده می‌شود:
     *   • ابزار نجات (`tools/reset-ui`) آن را می‌فرستد.
     *   • رابط برنامه آن را از `/system/operator` می‌گیرد.
     *
     * ⚠ این **شناسایی نیست**، فقط ثبت است. کسی که به پوشه‌ی داده دسترسی
     * دارد، هر نامی بخواهد می‌نویسد. عمداً «امضای دیجیتال» نساختیم: کاربر
     * نباید برای «صفر کردن» به کلید و رمز اضافه نیاز داشته باشد، وگرنه در
     * همان لحظه‌ای که به این ابزار نیاز دارد گیر می‌کند. برای این هدف
     * (فهمیدن اینکه چه شد) ثبت کافی است.
     *
     * نام کاربری همیشه در کنار آن می‌ماند — پس اگر هدر جعلی باشد، دست‌کم
     * اکانت واقعیِ وارد‌شده ثبت شده است.
     */
    const osUser = String(req?.headers?.['x-operator'] || '').slice(0, 80).trim();
    const role = String(req?.session?.role || '').slice(0, 20);
    const fullName = String(req?.session?.fullName || '').slice(0, 80);
    const r = await resetSystem({
      ...(body || {}),
      confirm: String(body?.confirm ?? ''),
      operator: body?.operator || who,
      /* برچسب یکپارچه: «نام کاربری (نام کامل) · ویندوز: کاربر» */
      operatorLabel: [
        who,
        fullName && fullName !== who ? `(${fullName})` : '',
        role ? `· نقش ${role === 'manager' ? 'مدیر' : role}` : '',
        osUser ? `· ویندوز: ${osUser}` : '',
      ].filter(Boolean).join(' '),
    });
    /*
     * باگ (شکار باگ دور ۳۰): در خطا فقط `message` به کاربر می‌رسید و
     * `rolledBack` گم می‌شد — پس ابزار و کاربر نمی‌فهمیدند داده سالم
     * برگشته یا نه. حالا کل نتیجه در بدنه‌ی خطا هم می‌آید.
     */
    if (!r.ok) throw new HttpException({ ...r, statusCode: 400, message: r.message }, 400);
    /* پیام در سابقه: بعد از پاک شدن ActivityLog، این تنها جای «چه شد»ست */
    return r;
  }

  // -------------------------------- backup ---------------------------------
  @Get('backup/list')
  @ManagerOnly()
  async listBackups() {
    const dir = BACKUP_DIR();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db') || f.endsWith('.bak'));
    /*
     * باگ (شکار باگ دور ۲۸): فهرست، فایل‌های خراب را هم نشان می‌داد و کاربر
     * رویشان «بازگردانی» می‌زد → دیتابیس زنده با یک فایل غیر-SQLite
     * بازنویسی می‌شد و برنامه بی‌بازگشت خراب می‌شد. حالا هر فایل در فهرست
     * برچسب «سالم/خراب» دارد و دکمه‌ی بازگردانی برای فایل خراب غیرفعال است.
     */
    const rows = files.map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      const healthy = checkBackupFile(full, st.size).ok;
      return { file: f, size: st.size, createdAt: st.mtime.toISOString(), healthy };
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

  /**
   * ── باز کردن پوشه در فایل‌منیجر (C2) ───────────────────────────────────
   *
   * `:key` یکی از `data` | `backups` | `logs` است — **نه یک مسیر**. مسیر از
   * کلاینت هرگز پذیرفته نمی‌شود؛ وگرنه یک کلیک می‌توانست `C:\Windows` را
   * باز کند.
   *
   * چرا در سرور: پوشه روی همان ماشینی است که سرور اجرا می‌شود، پس در
   * نسخه‌ی دسکتاپ و وبِ محلی یکی جواب می‌دهد و نیازی به API اضافه نیست.
   */
  @Post('open-folder/:key')
  @ManagerOnly()
  async openFolder(@Param('key') key: string) {
    if (!isFolderKey(key)) {
      throw new HttpException('پوشه‌ی خواسته‌شده شناخته نشد.', 400);
    }
    const dir = key === 'data' ? dataDir() : key === 'backups' ? BACKUP_DIR() : path.join(dataDir(), 'logs');
    /*
     * پوشه‌ی logs ممکن است هنوز ساخته نشده باشد. ساختنش بی‌خطر است و
     * بهتر از خطای «پیدا نشد» برای کاربری که فقط می‌خواهد ببیند.
     */
    try { if (key === 'logs' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    const r = await openFolder(dir);
    await logActivity({ action: 'open-folder', entity: 'System', detail: `${key}: ${dir}` });
    return { ...r, key };
  }

  /**
   * ── فشرده‌ی پشتیبان در یک فایل (C2) ────────────────────────────────────
   *
   * برای «بفرست به حسابدار / روی فلش ببر» یک فایل بهتر از ده فایل است.
   * محتوا: دیتابیس زنده (با `wal_checkpoint` تا کاپی سالم باشد) + همه‌ی
   * پشتیبان‌های موجود + یک `README.txt` که می‌گوید چطور بازگردانی شود —
   * چون فایل zip ممکن است دست کسی بیفتد که این برنامه را نمی‌شناسد.
   */
  @Get('backup/bundle')
  @ManagerOnly()
  async backupBundle(@Res() res: any) {
    await ensureSchemaAsync();
    try { await db().$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const entries: { name: string; data?: Buffer; file?: string }[] = [];

    /* دیتابیس زنده — نامش «live» است تا با فایل‌های پشتیبان قاطی نشود */
    entries.push({ name: `farday-live-${stamp}.db`, file: databaseFile() });

    const dir = BACKUP_DIR();
    if (fs.existsSync(dir)) {
      /*
       * همه‌ی پشتیبان‌ها، ولی سقف ۳۰ فایل — همان سقفی که ساخت پشتیبان
       * نگه می‌دارد. بدون سقف، این پاسخ با ۵۰۰ پشتیبان چند صد مگابایت
       * می‌شد و مرورگر قطع می‌کرد.
       */
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().slice(-30);
      for (const f of files) {
        const full = path.join(dir, f);
        try { entries.push({ name: `backups/${safeEntryName(f)}`, file: full }); } catch { /* ignore */ }
      }
    }

    const readme = [
      'پشتیبان فردای روشن',
      `تاریخ ساخت: ${new Date().toISOString()}`,
      '',
      'این فایل زیپ شامل موارد زیر است:',
      '  • farday-live-*.db  — دیتابیس در لحظه‌ی ساخت این فایل',
      '  • backups/*.db      — پشتیبان‌های قبلی',
      '',
      'بازگردانی:',
      '  ۱) برنامه را باز کنید و به صفحه‌ی «پشتیبان‌گیری» بروید.',
      '  ۲) فایل مورد نظر را در پوشه‌ی پشتیبان کاپی کنید:',
      '     %APPDATA%\af.farday.roshan\backups',
      '  ۳) فهرست را تازه کنید و روی «بازگردانی» بزنید.',
      '',
      'دیتابیس را هرگز وقتی برنامه باز است دستی تعویض نکنید.',
    ].join('\r\n');
    entries.push({ name: 'README.txt', data: Buffer.from(readme, 'utf8') });

    const zip = buildZip(entries);
    const name = `farday-bundle-${stamp}.zip`;
    await logActivity({ action: 'backup-bundle', entity: 'System', detail: `${name} (${entries.length} فایل)` });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', String(zip.length));
    return res.end(zip);
  }

  @Post('restore')
  @ManagerOnly()
  async restore(@Body() body: { file: string }) {
    const name = path.basename(String(body?.file || ''));
    const full = path.join(BACKUP_DIR(), name);
    if (!fs.existsSync(full)) throw new HttpException('فایل پشتیبان پیدا نشد.', 404);

    /*
     * ── حفاظ حیاتی (شکار باگ دور ۲۸) ────────────────────────────────────
     * فایل **قبل** از هر تغییری بررسی می‌شود. اگر خراب باشد، هیچ کاری
     * انجام نمی‌شود و دیتابیس زنده دست‌نخورده می‌ماند. بدون این، یک فایل
     * خراب روی دیتابیس سالم کپی می‌شد و از آن لحظه هر درخواستی ۵۰۰ می‌داد
     * (تجربه‌ی واقعی: `SQLITE_NOTADB: file is not a database`).
     */
    const check = checkBackupFile(full, fs.statSync(full).size);
    if (!check.ok) {
      throw new HttpException(
        `بازگردانی انجام نشد: ${check.message}\nدیتابیس فعلی دست‌نخورده است. پشتیبان دیگری انتخاب کنید.`,
        400,
      );
    }

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
    try {
      fs.copyFileSync(full, target);
    } catch (e: any) {
      /*
       * حتی اگر کاپی نصفه شکست بخورد، دیتابیس نباید خراب بماند: از نسخه‌ی
       * ایمنی که چند خط بالاتر گرفتیم برمی‌گردانیم. (اگر خودِ کاپی ایمنی
       * نبود، خطا را واضح می‌دهیم و به کاربر می‌گوییم فایل در کجاست.)
       */
      try { fs.copyFileSync(safety, target); } catch { /* ignore */ }
      await ensureSchemaAsync(true);
      settingsService.clearCache();
      throw new HttpException(
        `کاپی فایل پشتیبان انجام نشد (${e?.message || e}). دیتابیس قبلی برگردانده شد.`,
        500,
      );
    }
    /* فایل‌های WAL/SHM قدیمی به دیتابیس تازه تعلق ندارند و باید بروند */
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(target + suffix, { force: true }); } catch { /* ignore */ }
    }
    /*
     * پس از بازگردانی، فایل دیتابیس عوض شده؛ کش «ساختار بررسی شد» هم باید
     * پاک شود وگرنه برنامه به فایل تازه اعتماد می‌کند بدون بررسی ستون‌ها
     * (نسخه‌های قدیمی‌تر پشتیبان).
     */
    await ensureSchemaAsync(true);
    /* کش تنظیمات مربوط به فایل قبلی است — پاک شود */
    settingsService.clearCache();
    await logActivity({ action: 'restore', entity: 'System', detail: name });
    return {
      ok: true, restored: name, safetyCopy: path.basename(safety), restartRequired: false,
      counts: check.counts,
    };
  }

  /**
   * وضعیت بروزرسانی — «برنامه‌ی من چند است؟ ساختار دیتابیس چند است؟
   * آخرین بروزرسانی‌ها چه بودند و پشتیبان گرفتند یا نه؟»
   *
   * چرا لازم است: برنامه بین چندین شرکت توزیع شده و کاربران باید بتوانند
   * بدون تیم پشتیبانی مطمئن شوند بروزرسانی درست انجام شده. هر ردیف تاریخچه
   * یعنی «یک مهاجرت واقعی روی این دیتابیس اجرا شد» — همراه نام فایل پشتیبان.
   */
  @Get('upgrade/status')
  @ManagerOnly()
  async upgradeStatus() {
    let dbShape = 0;
    try {
      const v: any[] = await db().$queryRawUnsafe('PRAGMA user_version');
      dbShape = Number(v?.[0]?.user_version ?? 0);
    } catch { /* ignore */ }
    const dir = BACKUP_DIR();
    const upgrades = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.startsWith('pre-upgrade-')).sort().slice(-5)
      : [];
    return {
      appVersion: appVersion(),
      expectedShape: SHAPE_VERSION,
      dbShape,
      /** ساختار دیتابیس از این برنامه جلوتر است (کاپی از نسخه‌ی جدیدتر) */
      dbNewer: dbShape > SHAPE_VERSION,
      /** ساختار عقب‌تر مانده — نباید رخ بدهد؛ نشانه‌ی مهاجرت ناموفق است */
      dbBehind: dbShape < SHAPE_VERSION,
      backups: upgrades,
      backupDir: dir,
      history: recentUpgrades(process.env.FD_DATA_DIR || path.resolve(process.cwd(), 'data')),
    };
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

  /**
   * ── باگ (شکار باگ دور ۳۴): «برنامه باز است» هرگز درست تشخیص داده نمی‌شد ─
   * ابزار «صفر کردن» با `/api/system/info` می‌پرسد «این برنامه به همان دیتابیس
   * من وصل است؟» تا اگر نمونه‌ی دیگری روی همان پورت بود، دیتابیس **دیگری** را
   * صفر نکند. ولی این مسیر پشت `AuthGuard` است و ابزار توکن ندارد؛ پاسخ همیشه
   * ۴۰۱ بود، `info` خالی می‌ماند و `sameDb()` همیشه `false` — یعنی ابزار
   * همیشه فکر می‌کرد برنامه بسته است و سراغ حالت آفلاین می‌رفت (با دیتابیس
   * قفل‌شده) در حالی که برنامه باز بود.
   *
   * حالا فقط نام فایل دیتابیس/پوشه‌ی داده عمومی است (بدون توکن) تا همان
   * مقایسه ممکن شود. شناسه‌ی دستگاه، لایسنس و بقیه‌ی اطلاعات در `info`ی
   * محافظت‌شده می‌مانند؛ این مسیر **هیچ** چیز حساسی برنمی‌گرداند.
   */
  @Public()
  @Get('info-light')
  async infoLight() {
    await ensureSchemaAsync();
    return { dbFile: databaseFile(), dataDir: path.dirname(databaseFile()) };
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
