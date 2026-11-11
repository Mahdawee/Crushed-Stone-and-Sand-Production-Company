/**
 * «صفر کردن کامل داده» — تحویل سیستم آک به مشتری.
 *
 * کاربر: «یک گزینه‌ی صفر کردن تمام داده‌ها و تحویل سیستم آک و صفر و بدون داده
 * به کاربر می‌خواهم — بعد از این‌که اخطار و هشدار بدهد و بعد تأیید این کار را
 * بکند، و این را به حیث یک ابزار بیرونی در پوشه‌ی tools می‌خواهم، نه در داخل
 * برنامه.»
 *
 * ## تفاوت با «حذف نرم»
 * همه‌ی حذف‌های برنامه نرم‌اند (سطل بازیافت). این یکی **عمداً** پاک‌کننده است:
 * مشتریِ بعدی نباید هیچ ردی از داده‌ی مشتری قبلی ببیند — نه در دیتابیس، نه در
 * سطل بازیافت، نه در پشتیبان‌ها، نه در لاگ فعالیت.
 *
 * ## چرا در `apps/api` است و نه در `tools/`
 * منطق «چه چیزی پاک شود» خودش به ساختار دیتابیس وابسته است و باید یک منبع
 * حقیقت باشد. **رابط کاربری و اجراکننده** بیرون از برنامه‌اند (`tools/reset-ui`)
 * و همین‌جا هم یک مسیر API باریک برایشان هست (`/system/reset`، فقط مدیر).
 *
 * ## ترتیب کار (مهم)
 * ۱) بررسی مالکیت (کلید صفر کردن) و عبارت تأیید — قبل از هر تغییری.
 * ۲) **پشتیبان اجباری**؛ بدون پشتیبان سالم هیچ‌چیز پاک نمی‌شود.
 * ۳) حذف ردیف‌ها از جدول‌های کاری (پایین به بالا، به‌خاطر کلیدهای خارجی).
 * ۴) فهرست‌ها/ماشینری/شرکت/تنظیمات به مقدار پیش‌فرض برمی‌گردند.
 * ۵) «مشتری گذری» و کاربر مدیر دوباره ساخته می‌شوند — سیستم آک ولی قابل ورود.
 * ۶) پشتیبان‌های قبلی و لاگ فعالیت پاک می‌شوند (ردّ مشتری قبلی).
 * ۷) گزارش «چه چیزی پاک شد» در فایل مخصوص همین کار (نه در ActivityLog).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { db, dataDir, databaseFile, BACKUP_DIR } from '../db';
import { TABLE_LIST } from '../schema';
import { settingsService } from './settings';
import { ensureWalkInCustomer } from '../schema';
import { ensureDefaultAdmin, hashPassword } from '../common/auth';
import { ensureDefaultLookups } from './defaults';
import { LICENSE_FILE } from './license-state';

/**
 * عبارت تأیید — جلوی «یک کلیک اشتباه» را می‌گیرد.
 *
 * چرا عبارت تایپی و نه فقط دکمه: این کار **برگشت‌ناپذیر** است. اپراتوری که
 * از روی صفحه یک دکمه‌ی قرمز بزند، نباید بتواند داده‌ی یک سال را پاک کند.
 */
export const RESET_PHRASE = 'صفر کردن';

/**
 * جدول‌هایی که باید خالی شوند — پایین به بالا (وابستگی‌ها اول).
 * عمداً فهرست صریح است، نه «همه‌ی جدول‌ها»، تا جدول تازه‌ای که بعداً اضافه
 * شود با یک `git pull` بی‌سروصدا پاک نشود. ⚠ همین فهرست در
 * `tools/reset-ui/reset-core.mjs` هم هست و تست `reset-tool` یکی‌بودنشان را
 * می‌سنجد.
 */
export const RESET_ORDER = [
  'Revision', 'ActivityLog',
  'Payment', 'Receipt', 'Sale', 'SaleItem',
  'Expense', 'Salary', 'Attendance', 'Employee', 'Customer',
  'LookupItem', 'Machinery', 'Vehicle', 'Product', 'Inventory',
  'StockMove', 'Shipment', 'Deal', 'Document', 'JournalEntry', 'JournalLine',
  'Company', 'Setting',
];

/**
 * «مُهر» داده‌ی آک: یک فایل کوچک که می‌گوید این نصب صفر شده است.
 * ابزار بیرونی با خواندنش می‌فهمد کار انجام شده (وظیفه را دوباره نسازد).
 */
export const RESET_MARK_FILE = 'system-reset.json';

export type ResetOptions = {
  /** باید دقیقاً `RESET_PHRASE` باشد */
  confirm: string;
  /** نسخه/دلیل — در گزارش می‌نشیند (مثلاً «تحویل به مشتری ۲») */
  reason?: string;
  /** نام اپراتور — از صفحه‌ی ابزار یا نام کاربر API */
  operator?: string;
  /** پشتیبان بگیر؟ پیش‌فرض بله و اجباری */
  backup?: boolean;
  /** آیا مدیر پیش‌فرض دوباره ساخته شود؟ پیش‌فرض بله (وگرنه هیچ‌کس نمی‌تواند وارد شود) */
  keepAdmin?: boolean;
  /** حذف پشتیبان‌های قبلی (پیش‌فرض بله — ردّ مشتری قبلی) */
  wipeBackups?: boolean;
};

export type ResetResult = {
  ok: boolean;
  message: string;
  reason?: string;
  counts?: Record<string, number>;
  total?: number;
  backupFile?: string;
  admin?: { username: string; password: string } | null;
  at?: string;
  operator?: string;
  removedLicense?: boolean;
  removedBackups?: number;
  note?: string;
};

/** آیا این نصب قبلاً صفر شده است؟ (برای نمایش در ابزار) */
export function resetMark(): { at: string; operator: string; reason: string } | null {
  try {
    const f = path.join(dataDir(), RESET_MARK_FILE);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * فهرست جدول‌های موجود در دیتابیس (با احتیاط — ممکن است جدولی نباشد).
 * از `sqlite_master` می‌خوانیم نه از فهرست ثابت، تا اگر جدولی در این نسخه
 * ساخته نشده باشد، خطا ندهیم.
 */
async function existingTables(p: any): Promise<Set<string>> {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`,
  );
  return new Set(rows.map((r) => String(r.name)));
}

/**
 * وضعیت داده پیش از صفر کردن — همان چیزی که ابزار نشان می‌دهد *قبل* از تأیید.
 * بدون این، اپراتور نمی‌داند دارد چه چیزی را پاک می‌کند.
 */
export async function dataInventory(): Promise<{
  counts: Record<string, number>; total: number;
  files: { backups: number; licenses: number; hasDatabase: boolean };
  database: string; dataDir: string; licenseBound: boolean;
}> {
  const p = db();
  const have = await existingTables(p);
  const counts: Record<string, number> = {};
  let total = 0;
  for (const table of RESET_ORDER) {
    if (!have.has(table)) continue;
    try {
      const r: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "${table}"`);
      const n = Number(r?.[0]?.c || 0);
      counts[table] = n;
      total += n;
    } catch { /* جدول ساختار دیگری دارد — نادیده */ }
  }
  const live: Record<string, number> = {};
  for (const [t, n] of Object.entries(counts)) if (n > 0) live[t] = n;

  let backups = 0;
  let licenses = 0;
  try {
    const dir = BACKUP_DIR();
    backups = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length : 0;
  } catch { /* ignore */ }
  try {
    const d = dataDir();
    licenses = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.lic') || f === LICENSE_FILE).length : 0;
  } catch { /* ignore */ }

  return {
    counts: live,
    total,
    files: { backups, licenses, hasDatabase: fs.existsSync(databaseFile()) },
    database: databaseFile(),
    dataDir: dataDir(),
    licenseBound: licenses > 0,
  };
}

/**
 * پشتیبان اجباری.
 *
 * چرا با `fs.copyFileSync` و نه API پشتیبان‌گیری برنامه: آن API به Prisma و
 * لایه‌ی HTTP وابسته است؛ این‌جا باید در پایین‌ترین لایه و بدون وابستگی کار
 * کند. دیتابیس SQLite در حالت WAL است، پس فایل‌های `-wal` و `-shm` هم کپی
 * می‌شوند تا پشتیبان «نیمه‌کاره» نباشد.
 */
function backupNow(): string {
  const src = databaseFile();
  if (!fs.existsSync(src)) throw new Error('فایل دیتابیس پیدا نشد؛ پشتیبان‌گیری ممکن نیست.');
  const dir = BACKUP_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dst = path.join(dir, `pre-reset-${stamp}.db`);
  fs.copyFileSync(src, dst);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(src + suffix)) fs.copyFileSync(src + suffix, dst + suffix);
  }
  /*
   * بررسی سلامت: اندازه‌ی صفر یعنی پشتیبان بی‌فایده. اگر پشتیبان سالم نیست،
   * پاک کردن را متوقف می‌کنیم (قاعده‌ی «هیچ‌وقت بدون راه برگشت»).
   */
  if (fs.statSync(dst).size === 0) throw new Error('پشتیبان خالی ساخته شد؛ صفر کردن متوقف شد.');
  return dst;
}

/** پاک‌کردن فایل‌های پشتیبان قبلی — ردّ مشتری قبلی */
function wipeBackups(keepFile?: string): number {
  const dir = BACKUP_DIR();
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (keepFile && path.resolve(full) === path.resolve(keepFile)) continue;
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
      else fs.unlinkSync(full);
      n++;
    } catch { /* ignore */ }
  }
  return n;
}

/**
 * پیش‌بررسی «صفر کردن» — بدون هیچ تغییری.
 *
 * چرا لازم است: عملیات برگشت‌ناپذیر است و اگر نیمه‌کاره بشکند، کاربر با
 * دیتابیسی بدون داده و بدون کاربر می‌ماند. هر شرطی که می‌تواند وسط کار
 * بشکند، این‌جا **قبل** از پاک شدن سنجیده می‌شود:
 *   • فایل دیتابیس خوانا باشد (`PRAGMA quick_check`)؛
 *   • جدول `User` بتواند مدیر تازه را بپذیرد (ستون‌های لازم موجود باشند)؛
 *   • «مشتری گذری» قابل ساخت باشد (`Customer` ستون‌های `code`/`name`).
 */
export async function resetPreflight(): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  const p = db();
  try {
    const check: any[] = await p.$queryRawUnsafe('PRAGMA quick_check');
    const verdict = String(check?.[0]?.quick_check ?? check?.[0]?.['quick_check(1)'] ?? 'ok');
    if (verdict && verdict !== 'ok') problems.push(`دیتابیس آسیب‌دیده است (${verdict}).`);
  } catch (e: any) {
    problems.push(`خواندن دیتابیس ناموفق بود: ${e?.message || e}`);
  }
  try {
    const cols: any[] = await p.$queryRawUnsafe('PRAGMA table_info("User")');
    const names = new Set(cols.map((c) => String(c.name)));
    for (const need of ['username', 'passwordHash', 'role', 'active']) {
      if (!names.has(need)) problems.push(`جدول User ستون «${need}» را ندارد.`);
    }
  } catch {
    problems.push('جدول User خوانده نشد — این فایل دیتابیس این برنامه نیست.');
  }
  try {
    const cols: any[] = await p.$queryRawUnsafe('PRAGMA table_info("Customer")');
    const names = new Set(cols.map((c) => String(c.name)));
    for (const need of ['code', 'name']) {
      if (!names.has(need)) problems.push(`جدول Customer ستون «${need}» را ندارد.`);
    }
    /*
     * ستون `isWalkIn` لازم نیست وجود داشته باشد — `ensureWalkInCustomer`
     * فقط اگر باشد می‌نویسدش. ولی اگر نبود، یادآوری می‌کنیم که مهاجرت
     * انجام نشده (اطلاعاتی، نه خطا).
     */
  } catch {
    problems.push('جدول Customer خوانده نشد — این فایل دیتابیس این برنامه نیست.');
  }
  return { ok: problems.length === 0, problems };
}

/**
 * صفر کردن کامل.
 *
 * ⚠ برگشت‌ناپذیر. همه‌ی بررسی‌ها **قبل** از اولین تغییر انجام می‌شوند؛ اگر
 * یکی رد شود، هیچ چیز تغییر نمی‌کند.
 */
export async function resetSystem(opts: ResetOptions): Promise<ResetResult> {
  if (String(opts?.confirm || '').trim() !== RESET_PHRASE) {
    return {
      ok: false,
      message: `برای تأیید، عبارت «${RESET_PHRASE}» را دقیقاً بنویسید. هیچ داده‌ای تغییر نکرد.`,
    };
  }
  /*
   * ── پیش‌بررسی (شکار باگ دور ۲۸) ──────────────────────────────────────────
   * خطای گزارش‌شده‌ی کاربر (`table Customer has no column named isWalkIn`)
   * نشان داد که «صفر کردن» می‌تواند **بعد از** خالی شدن جدول‌ها بشکند و
   * دیتابیس را بی‌کاربر رها کند. حالا همه‌ی پیش‌نیازها قبل از اولین تغییر
   * سنجیده می‌شوند و اگر چیزی نبود، هیچ ردیفی پاک نمی‌شود.
   */
  const pre = await resetPreflight();
  if (!pre.ok) {
    return {
      ok: false,
      message: `صفر کردن انجام نشد — دیتابیس آماده نیست:\n• ${pre.problems.join('\n• ')}\nهیچ داده‌ای تغییر نکرد.`,
    } as ResetResult;
  }

  const backupWanted = opts.backup !== false;
  let backupFile = '';
  if (backupWanted) {
    try {
      backupFile = backupNow();
    } catch (e: any) {
      return { ok: false, message: `پشتیبان‌گیری ناموفق بود، صفر کردن انجام نشد: ${e?.message || e}` };
    }
  }

  const p = db();
  const have = await existingTables(p);
  const counts: Record<string, number> = {};

  /* ۱) خالی کردن جدول‌های کاری — پایین به بالا */
  for (const table of RESET_ORDER) {
    if (!have.has(table)) continue;
    try {
      const before: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "${table}"`);
      const n = Number(before?.[0]?.c || 0);
      await p.$executeRawUnsafe(`DELETE FROM "${table}"`);
      if (n > 0) counts[table] = n;
    } catch (e: any) {
      /*
       * اگر جدولی با کلید خارجی گیر کرد، صفر کردن را **نیمه‌کاره** رها نکنیم:
       * با `PRAGMA foreign_keys=OFF` دوباره تلاش می‌کنیم (دیتابیس از ابتدا
       * یک‌جا خالی می‌شود، پس نقض یکپارچگی معنا ندارد).
       */
      try {
        await p.$executeRawUnsafe('PRAGMA foreign_keys=OFF');
        await p.$executeRawUnsafe(`DELETE FROM "${table}"`);
        await p.$executeRawUnsafe('PRAGMA foreign_keys=ON');
      } catch {
        throw new Error(`پاک کردن «${table}» ناموفق بود (${e?.message || e}). صفر کردن متوقف شد.`);
      }
    }
  }

  /* ۲) شمارنده‌ها و شناسه‌ها به صفر */
  try { await p.$executeRawUnsafe(`DELETE FROM sqlite_sequence`); } catch { /* جدول ممکن نیست */ }

  /* ۳) فهرست‌های پیش‌فرض، ماشینری، مشخصات شرکت و تنظیمات — دوباره از صفر */
  await ensureDefaultLookups();
  try { await settingsService.ensureDefaults(); } catch { /* دوباره در بالا آمدن بعدی */ }

  /* ۴) «مشتری گذری» و کاربر مدیر — سیستم آک ولی قابل استفاده */
  await ensureWalkInCustomer();
  let admin: { username: string; password: string } | null = null;
  if (opts.keepAdmin !== false) {
    /*
     * رمز پیش‌فرض `admin123` است — همان چیزی که نصب تازه هم می‌دهد.
     * عمداً رمز تصادفی نمی‌گذاریم: اپراتور باید بتواند بعد از تحویل،
     * بلافاصله وارد شود و رمز را عوض کند. در گزارش هم نوشته می‌شود.
     */
    const users: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "User"`);
    if (Number(users?.[0]?.c || 0) === 0) {
      await p.$executeRawUnsafe(
        `INSERT INTO "User" ("username","fullName","passwordHash","role","active") VALUES (?,?,?,?,1)`,
        'admin', 'مدیر سیستم', hashPassword('admin123'), 'manager',
      );
      admin = { username: 'admin', password: 'admin123' };
    } else {
      await ensureDefaultAdmin();
    }
  }

  /* ۵) لایسنس و پشتیبان‌های قبلی — ردّ مشتری قبلی */
  let removedLicense = false;
  try {
    const lf = path.join(dataDir(), LICENSE_FILE);
    if (fs.existsSync(lf)) { fs.unlinkSync(lf); removedLicense = true; }
    for (const f of ['license.trial', 'license.clock']) {
      const full = path.join(dataDir(), f);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
    /* فایل‌های «لاگ فعالیت» و درخواست تمدید هم پاک می‌شوند */
    for (const f of fs.readdirSync(dataDir())) {
      if (/\.(req|lic)$/i.test(f) || /^renew/i.test(f)) {
        try { fs.unlinkSync(path.join(dataDir(), f)); removedLicense = removedLicense || f.endsWith('.lic'); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  let removedBackups = 0;
  if (opts.wipeBackups !== false) {
    /*
     * پشتیبانِ همین لحظه نگه داشته می‌شود (تنها راه برگشت اپراتور)، بقیه پاک
     * می‌شوند — وگرنه داده‌ی مشتری قبلی در `backups/` باقی می‌ماند.
     */
    removedBackups = wipeBackups(backupFile || undefined);
  }

  /* ۶) مهر و گزارش — بیرون از ActivityLog (که خودش پاک شد) */
  const at = new Date().toISOString();
  const report = {
    ...(resetMark() || {}),
    at, operator: opts.operator || 'system', reason: String(opts.reason || '').slice(0, 300),
    counts, total: Object.values(counts).reduce((a, b) => a + b, 0),
    backupFile: backupFile ? path.basename(backupFile) : '',
    admin, removedLicense, removedBackups,
    appVersion: process.env.npm_package_version || '',
    host: osHost(),
    id: crypto.randomBytes(6).toString('hex'),
  };
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(path.join(dataDir(), RESET_MARK_FILE), JSON.stringify(report, null, 2), 'utf8');
    fs.appendFileSync(
      path.join(dataDir(), 'reset-history.log'),
      `${at} · ${report.operator} · ${report.total} ردیف · ${report.reason || '—'} · نسخه‌ی پشتیبان: ${report.backupFile || '—'}\n`,
      'utf8',
    );
  } catch { /* ignore */ }

  const total = report.total;
  /*
   * پیام باید **دقیق** باشد: قبلاً همیشه «کاربر مدیر: admin / admin123» می‌گفت،
   * حتی وقتی کاربران دست‌نخورده مانده بودند (جدول `User` جزو داده‌ی کاری نیست
   * و پاک نمی‌شود). اپراتور بعد از تحویل با رمز اشتباه روبه‌رو می‌شد.
   */
  const adminNote = admin ? ' کاربر مدیر: admin / admin123' : '';
  return {
    ok: true,
    message: total
      ? `سیستم صفر شد — ${total.toLocaleString('fa-IR')} ردیف پاک شد.${adminNote}`
      : `دیتابیس از قبل خالی بود؛ فهرست‌های پیش‌فرض و «مشتری گذری» بازسازی شد.${adminNote}`,
    counts, total, backupFile: report.backupFile, admin, at,
    operator: report.operator, removedLicense, removedBackups,
    reason: report.reason,
  };
}

function osHost(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return String(require('node:os').hostname());
  } catch { return ''; }
}

/** فهرست جدول‌هایی که در این نسخه واقعاً هست — برای صفحه‌ی ابزار */
export async function resetPlan(): Promise<{ tables: string[]; missing: string[] }> {
  const p = db();
  const have = await existingTables(p);
  return {
    tables: RESET_ORDER.filter((t) => have.has(t)),
    missing: RESET_ORDER.filter((t) => !have.has(t)),
  };
}

/** تعداد کل ردیف‌های «داده‌ی کاری» — معیار «آک بودن» سیستم */
export async function workingRowCount(): Promise<number> {
  const inv = await dataInventory();
  /* کاربران، فهرست‌ها و ماشینری سیستم را «قابل استفاده» می‌کنند، نه «داده‌دار» */
  const meta = new Set(['User', 'LookupItem', 'Machinery', 'Company', 'Setting']);
  /*
   * «مشتری گذری» هم داده‌ی کاری نیست: یک ردیف ثابت سیستمی است که همیشه
   * می‌ماند. اگر شمرده شود، سیستم بعد از صفر کردن هم «داده‌دار» نشان داده
   * می‌شود (همان باگی که تست ابزار گرفت).
   */
  let walkIn = 0;
  try {
    const r: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) c FROM "Customer" WHERE COALESCE("isWalkIn",0)=1`);
    walkIn = Number(r?.[0]?.c || 0);
  } catch { /* ignore */ }
  return Object.entries(inv.counts)
    .filter(([t]) => !meta.has(t))
    .reduce((a, [t, n]) => a + (t === 'Customer' ? Math.max(0, n - walkIn) : n), 0);
}

export { TABLE_LIST };
