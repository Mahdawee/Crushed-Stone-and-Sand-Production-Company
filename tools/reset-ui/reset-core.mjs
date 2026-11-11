/**
 * هسته‌ی «صفر کردن سیستم» برای حالت **آفلاین** (برنامه بسته است) — JavaScript
 * خالص و بدون هیچ بسته‌ی بیرونی (`node:sqlite` خودِ Node ۲۲).
 *
 * ## چرا نسخه‌ی جدا از `apps/api/src/common/reset.ts`
 * آن نسخه با Prisma و لایه‌ی اپلیکیشن کار می‌کند و فقط وقتی برنامه **باز**
 * است در دسترس است. این نسخه باید روی کمپیوتری اجرا شود که برنامه بسته است
 * (برای تحویل سیستم) — پس باید مستقل و بی‌وابستگی باشد.
 *
 * برای اینکه دو نسخه از هم جدا نیفتند:
 *   • فهرست جدول‌ها همین‌جا و در `reset.ts` یکی است (تست `license-dates`/
 *     `reset-tool` مقایسه می‌کند).
 *   • «مشتری گذری» و کاربر مدیر با همان قاعده‌ی برنامه ساخته می‌شوند.
 *   • فهرست‌های پیش‌فرض (مواد، دسته‌های مصرف…) **این‌جا** ساخته نمی‌شوند؛
 *     برنامه در بالا آمدن بعدی، اگر `LookupItem` خالی باشد آن‌ها را می‌سازد
 *     (`ensureDefaultLookups` در شِما). یک منبع حقیقت، بدون کاپی دوم.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * جدول‌هایی که خالی می‌شوند — پایین به بالا.
 * ⚠ با `RESET_ORDER` در `apps/api/src/common/reset.ts` یکی بماند.
 */
export const RESET_ORDER = [
  'Revision', 'ActivityLog',
  'Payment', 'Receipt', 'Sale', 'SaleItem',
  'Expense', 'Salary', 'Attendance', 'Employee', 'Customer',
  'LookupItem', 'Machinery', 'Vehicle', 'Product', 'Inventory',
  'StockMove', 'Shipment', 'Deal', 'Document', 'JournalEntry', 'JournalLine',
  'Company', 'Setting',
];

/** همان عبارت تأییدِ برنامه */
export const RESET_PHRASE = 'صفر کردن';

/** همان الگوریتم هش رمز برنامه (`sha256(pw + 'farday::salt')`) */
export function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw) + 'farday::salt').digest('hex');
}

export const RESET_MARK_FILE = 'system-reset.json';

/** آیا این نصب قبلاً صفر شده است؟ */
export function resetMark(dataDir) {
  try {
    const f = path.join(dataDir, RESET_MARK_FILE);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch { return null; }
}

/* `node:sqlite` در Node 22 هست؛ اگر نبود، پیام روشن می‌دهیم نه «require is
   not defined» (این ماژول ESM است). */
async function sqliteModule() {
  try {
    const m = await import('node:sqlite');
    return m;
  } catch (e) {
    throw new Error('این نسخه‌ی Node از «node:sqlite» پشتیبانی نمی‌کند (Node 22+ لازم است).');
  }
}
let DatabaseSyncCtor = null;
async function databaseClass() {
  if (!DatabaseSyncCtor) DatabaseSyncCtor = (await sqliteModule()).DatabaseSync;
  return DatabaseSyncCtor;
}

function openDbSync(file, readOnly = false) {
  if (!DatabaseSyncCtor) {
    throw new Error('ماژول sqlite بارگذاری نشده است.');
  }
  return new DatabaseSyncCtor(file, readOnly ? { readOnly: true } : {});
}

function tablesIn(db) {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'",
  ).all().map((r) => String(r.name));
}

const INTEREST = [
  'Sale', 'Receipt', 'Expense', 'Salary', 'Attendance', 'Employee', 'Customer',
  'LookupItem', 'Machinery', 'User', 'ActivityLog',
];
/** این‌ها سیستم را «قابل استفاده» می‌کنند، نه «داده‌دار» */
const META = new Set(['LookupItem', 'User', 'Machinery', 'Company', 'Setting']);

/** وضعیت داده — برای صفحه‌ی ابزار، قبل از تأیید */
export async function inventory({ dbFile, dataDir }) {
  const out = { database: dbFile, dataDir, exists: fs.existsSync(dbFile), dbSize: 0, counts: {}, total: 0, backups: 0, mark: null };
  try { out.dbSize = fs.statSync(dbFile).size; } catch { /* ignore */ }
  out.mark = resetMark(dataDir);
  const bdir = path.join(dataDir, 'backups');
  try { out.backups = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((f) => !f.startsWith('.')).length : 0; } catch { /* ignore */ }
  if (!out.exists) return out;
  let db;
  try {
    await databaseClass();
    db = openDbSync(dbFile, true);
    const have = new Set(tablesIn(db));
    for (const t of INTEREST) {
      if (!have.has(t)) continue;
      try { out.counts[t] = Number(db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get()?.c || 0); } catch { /* ignore */ }
    }
    /*
     * «مشتری گذری» داده‌ی کاری نیست: یک ردیف ثابت سیستمی است که همیشه
     * می‌ماند. اگر شمرده شود، سیستم بعد از صفر کردن هم «داده‌دار» نشان داده
     * می‌شود و اپراتور فکر می‌کند کار نیمه‌کاره مانده.
     */
    let walkIn = 0;
    try { walkIn = Number(db.prepare(`SELECT COUNT(*) c FROM "Customer" WHERE "isWalkIn"=1`).get()?.c || 0); } catch { /* ignore */ }
    out.walkIn = walkIn;
    out.total = Object.entries(out.counts)
      .filter(([t]) => !META.has(t))
      .reduce((a, [t, n]) => a + (t === 'Customer' ? Math.max(0, n - walkIn) : n), 0);
  } catch (e) {
    out.readError = e instanceof Error ? e.message : String(e);
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
  return out;
}

/**
 * پشتیبان اجباری — با اندازه‌گیری و بررسی خالی‌نبودن.
 * اگر پشتیبان ساخته نشود، صفر کردن **انجام نمی‌شود** (نبودِ راه برگشت).
 */
export function backupNow({ dbFile, dataDir }) {
  if (!fs.existsSync(dbFile)) throw new Error('فایل دیتابیس پیدا نشد؛ پشتیبان‌گیری ممکن نیست.');
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dst = path.join(dir, `pre-reset-${stamp}.db`);
  fs.copyFileSync(dbFile, dst);
  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(dbFile + s)) fs.copyFileSync(dbFile + s, dst + s);
  }
  if (fs.statSync(dst).size === 0) throw new Error('پشتیبان خالی ساخته شد؛ صفر کردن متوقف شد.');
  return dst;
}

function wipeBackups({ dataDir }, keep) {
  const dir = path.join(dataDir, 'backups');
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (keep && path.resolve(full) === path.resolve(keep)) continue;
    try { fs.rmSync(full, { recursive: true, force: true }); n++; } catch { /* ignore */ }
  }
  return n;
}

/**
 * صفر کردن کامل در حالت آفلاین.
 *
 * @param {{dbFile: string, dataDir: string}} paths
 * @param {{confirm: string, reason?: string, operator?: string, keepAdmin?: boolean, wipeBackups?: boolean}} opts
 */
export async function resetOffline(paths, opts) {
  if (String(opts?.confirm || '').trim() !== RESET_PHRASE) {
    return { ok: false, message: `برای تأیید، عبارت «${RESET_PHRASE}» را دقیقاً بنویسید. هیچ داده‌ای تغییر نکرد.` };
  }
  if (!fs.existsSync(paths.dbFile)) {
    return { ok: false, message: 'فایل دیتابیس پیدا نشد — این کمپیوتر داده‌ای برای صفر کردن ندارد.' };
  }

  let backupFile = '';
  try { backupFile = backupNow(paths); }
  catch (e) { return { ok: false, message: `پشتیبان‌گیری ناموفق بود، صفر کردن انجام نشد: ${e.message || e}` }; }

  await databaseClass();
  const db = openDbSync(paths.dbFile);
  const counts = {};
  try {
    const have = new Set(tablesIn(db));
    /* بدون بررسی کلید خارجی — همه‌ی جدول‌ها یک‌جا خالی می‌شوند */
    try { db.exec('PRAGMA foreign_keys=OFF'); } catch { /* ignore */ }
    for (const t of RESET_ORDER) {
      if (!have.has(t)) continue;
      let n = 0;
      try { n = Number(db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get()?.c || 0); } catch { /* ignore */ }
      try { db.exec(`DELETE FROM "${t}"`); } catch (e) {
        throw new Error(`پاک کردن «${t}» ناموفق بود (${e.message || e}) — صفر کردن نیمه‌کاره ماند. پشتیبان: ${path.basename(backupFile)}`);
      }
      if (n > 0) counts[t] = n;
    }
    try { db.exec('DELETE FROM sqlite_sequence'); } catch { /* ignore */ }
    try { db.exec('PRAGMA foreign_keys=ON'); } catch { /* ignore */ }

    /* کاربر مدیر — وگرنه بعد از صفر کردن هیچ‌کس نمی‌تواند وارد شود */
    let admin = null;
    if (opts.keepAdmin !== false && have.has('User')) {
      const c = Number(db.prepare('SELECT COUNT(*) c FROM "User"').get()?.c || 0);
      if (c === 0) {
        db.prepare(
          'INSERT INTO "User" ("username","fullName","passwordHash","role","active") VALUES (?,?,?,?,1)',
        ).run('admin', 'مدیر سیستم', hashPassword('admin123'), 'manager');
        admin = { username: 'admin', password: 'admin123' };
      }
    }

    /* «مشتری گذری» — بل فروش بدون مشتری باید همان لحظه قابل ثبت باشد */
    if (have.has('Customer')) {
      const row = db.prepare('SELECT "id" FROM "Customer" WHERE "code"=?').get('000');
      if (!row) {
        db.prepare(
          `INSERT INTO "Customer" ("code","name","contactPerson","phone","truckPlate","openingBalance","note","isWalkIn")
           VALUES (?,'مشتری گذری (بدون حساب)','','','',0,'',1)`,
        ).run('000');
      }
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const at = new Date().toISOString();
    const report = {
      at, operator: opts.operator || 'reset-tool', reason: String(opts.reason || '').slice(0, 300),
      counts, total, backupFile: path.basename(backupFile), admin,
      removedBackups: 0, mode: 'offline', host: hostName(),
      id: crypto.randomBytes(6).toString('hex'),
    };
    fs.writeFileSync(path.join(paths.dataDir, RESET_MARK_FILE), JSON.stringify(report, null, 2), 'utf8');
    try {
      fs.appendFileSync(
        path.join(paths.dataDir, 'reset-history.log'),
        `${at} · ${report.operator} · ${total} ردیف · ${report.reason || '—'} · پشتیبان: ${report.backupFile}\n`,
        'utf8',
      );
    } catch { /* ignore */ }

    /* لاگ فعالیتِ خودِ فایل‌ها هم پاک می‌شود (ردّ مشتری قبلی) */
    for (const f of safeReaddir(paths.dataDir)) {
      if (/\.(req|lic)$/i.test(f) || /^renew/i.test(f) || f === 'license.key') {
        try { fs.unlinkSync(path.join(paths.dataDir, f)); } catch { /* ignore */ }
      }
    }

    if (opts.wipeBackups !== false) report.removedBackups = wipeBackups(paths, backupFile);
    fs.writeFileSync(path.join(paths.dataDir, RESET_MARK_FILE), JSON.stringify(report, null, 2), 'utf8');

    return {
      ok: true,
      message: total
        ? `سیستم صفر شد — ${total.toLocaleString('fa-IR')} ردیف پاک شد. مدیر: admin / admin123`
        : 'دیتابیس از قبل خالی بود؛ کاربر مدیر و مشتری گذری بازسازی شد.',
      counts, total, backupFile: report.backupFile, admin, at,
      operator: report.operator, removedBackups: report.removedBackups, mode: 'offline',
    };
  } finally {
    try { db.exec('PRAGMA foreign_keys=ON'); } catch { /* ignore */ }
    try { db.close(); } catch { /* ignore */ }
  }
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}
function hostName() {
  /* ماژول ESM است — `require` این‌جا وجود ندارد؛ از خودِ پروسه می‌خوانیم */
  try { return String(process.env.COMPUTERNAME || process.env.HOSTNAME || ''); } catch { return ''; }
}
