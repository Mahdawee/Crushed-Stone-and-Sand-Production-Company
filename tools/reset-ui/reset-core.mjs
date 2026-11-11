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
 * ── جدول‌های لایسنس و شماره‌گذاری (شکار باگ دور ۳۴) ──────────────────────
 * این چهار جدول در فهرست نبودند و «صفر کردن» آن‌ها را دست‌نخورده می‌گذاشت،
 * در حالی که صفحه صریح می‌گفت لایسنس پاک می‌شود. نتیجه: تأیید مشتری قبلی و
 * شماره‌ی سند ادامه‌دار روی سیستم تحویلی. توضیح کامل در
 * `apps/api/src/common/reset.ts` (همان فهرست، یک منبع حقیقت).
 */
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
  'License', 'LicenseClock', 'LicenseEvent', 'Sequence',
];

/** همان عبارت تأییدِ برنامه */
export const RESET_PHRASE = 'صفر کردن';

/**
 * هش رمز — **باید** با `apps/api/src/common/auth.ts` یکی باشد.
 *
 * باگ (شکار باگ دور ۲۷): این‌جا نسخه‌ی قدیمیِ SHA-256 با نمک ثابت بود. اگر
 * روزی سرور فرمت هش را عوض کند (که کرد: `scrypt`)، کاربرِ بازسازی‌شده با
 * ابزار صفر کردن می‌توانست وارد نشود. حالا همان الگوریتم و همان فرمت:
 *
 *     scrypt$<N>$<r>$<p>$<salt-hex>$<key-hex>
 *
 * تست `apps/api/test/auth.test.js` هر دو پیاده‌سازی را با هم می‌سنجد.
 */
export function hashPassword(pw) {
  const N = 16384, r = 8, p = 1, keylen = 32;
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw ?? ''), salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${key.toString('hex')}`;
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

/**
 * آیا این «نود» می‌تواند اصلاً کار کند؟ (شکار باگ دور ۳۴)
 *
 * چرا لازم است: نسخه‌ی نصب‌شده `node.exe` خودش را همراه دارد. اگر روزی کاپی
 * قدیمی یا ناقصی از آن کنار ابزار بیفتد، اپراتور فقط پیام مبهم «ماژول sqlite
 * بارگذاری نشده» یا صفحه‌ای با صفر ردیف می‌دید و فکر می‌کرد سیستم آک است.
 * حالا ابزار **قبل** از هر کاری نسخه را می‌سنجد و پیام روشن می‌دهد.
 */
export async function runtimeInfo() {
  const raw = String(process.versions?.node || '');
  const major = Number(raw.split('.')[0] || 0);
  let sqlite = false;
  let error = '';
  try {
    const m = await sqliteModule();
    sqlite = typeof m?.DatabaseSync === 'function';
    if (!sqlite) error = 'ماژول node:sqlite کلاس DatabaseSync ندارد.';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ok = sqlite && major >= 22;
  return {
    ok,
    node: raw,
    major,
    sqlite,
    error,
    message: ok
      ? `Node ${raw} — آماده`
      : major < 22
        ? `نسخه‌ی Node خیلی قدیمی است (${raw}). نسخه‌ی ۲۲ یا بالاتر لازم است.`
        : `این Node نمی‌تواند دیتابیس را بخواند: ${error || 'دلیل نامشخص'}`,
  };
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

/** ستون‌های یک جدول (برای تشخیص دیتابیسِ نصب‌های قدیمی). */
function columnsOf(db, table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((r) => String(r.name)));
  } catch { return new Set(); }
}

/**
 * ── باگ جدی (گزارش کاربر) ────────────────────────────────────────────────
 * «صفر کردن سیستم درست کار نمی‌کند: table Customer has no column named
 *  isWalkIn».
 *
 * ریشه: این ابزار موقع ساختن «مشتری گذری» ستون `isWalkIn` را **بدون بررسی**
 * در `INSERT` می‌نوشت. `isWalkIn` (و `isDemo`) ستون‌هایی هستند که برنامه با
 * مهاجرت (`ALTER TABLE … ADD COLUMN` در `schema.ts`) اضافه می‌کند؛ در
 * دیتابیسی که این ابزار برای اولین بار می‌بیند — یا در نسخه‌ای که هنوز
 * مهاجرت را اجرا نکرده — وجود ندارند.
 *
 * بدتر از خود خطا: خطا **بعد از** خالی کردن جدول‌ها رخ می‌داد. یعنی کاربر
 * با دیتابیسِ پاک‌شده و **بدون هیچ کاربری** می‌ماند و برنامه دیگر قابل ورود
 * نبود — در حالی که فکر می‌کرد عملیات شکست خورده و داده‌اش سر جایش است.
 *
 * دو اصلاح:
 *   ۱) این‌جا هم مثل خود برنامه، ستون‌های لازم با `ALTER TABLE` اضافه می‌شوند
 *      (همان DDL، همان پیش‌فرض) — صفر کردن روی هر نصب قدیمی کار می‌کند و
 *      برنامه بعد از باز شدن حتی یک مهاجرت هم لازم ندارد.
 *   ۲) نوشتن‌ها ستون‌های اختیاری را فقط اگر **واقعاً وجود دارند** می‌نویسند
 *      (دفاع دوم، برای هر ستونی که در آینده اضافه شود).
 */
const OPTIONAL_COLUMNS = [
  { table: 'Customer', column: 'isWalkIn', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Customer', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Sale', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Receipt', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Expense', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Salary', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Attendance', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Employee', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Machinery', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
];

/** ستون‌های کمکیِ گم‌شده را اضافه می‌کند؛ خروجی: فهرست تغییرها. */
function ensureOptionalColumns(db, have) {
  const added = [];
  for (const u of OPTIONAL_COLUMNS) {
    if (!have.has(u.table)) continue;
    const cols = columnsOf(db, u.table);
    if (cols.has(u.column)) continue;
    try {
      db.exec(`ALTER TABLE "${u.table}" ADD COLUMN "${u.column}" ${u.ddl}`);
      added.push(`${u.table}.${u.column}`);
    } catch { /* اگر نشد، مسیر نوشتن ستون اختیاری را نادیده می‌گیرد */ }
  }
  return added;
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
 * پیش‌بررسی: آیا دیتابیس سالم است و آیا بعد از خالی‌شدن، کاربرِ ورودپذیر
 * باقی می‌ماند؟ اگر نه، **قبل از هر تغییری** خطا می‌دهد.
 *
 * چرا لازم است: عملیات «صفر کردن» برگشت‌ناپذیر است؛ اگر نیمه‌کاره بشکند،
 * کاربر با دیتابیس پاک‌شده و بی‌کاربر می‌ماند (همان اتفاقی که با
 * `isWalkIn` افتاد). حالا همه‌ی پیش‌نیازها قبل از اولین `DELETE` سنجیده
 * می‌شوند و اگر چیزی نبود، هیچ داده‌ای لمس نمی‌شود.
 */
/** ⚠ async است چون ماژول `node:sqlite` را (اگر هنوز بارگذاری نشده) خودش می‌آورد. */
export async function preflight({ dbFile }) {
  await databaseClass();
  const problems = [];
  let db;
  try {
    /*
     * خواندن-نوشتن باز می‌شود (نه فقط خواندن): بخشی از پیش‌بررسی باید یک
     * نوشتن آزمایشی انجام دهد و `ROLLBACK` کند. اگر فایل قفل باشد (برنامه
     * باز است)، همین‌جا پیام روشن می‌دهیم، نه وسط کار.
     */
    db = openDbSync(dbFile, false);
  } catch (e) {
    return { ok: false, problems: [`فایل دیتابیس باز نشد: ${e?.message || e}`] };
  }
  try {
    const check = db.prepare('PRAGMA quick_check').all() || [];
    const verdict = String(check?.[0]?.quick_check ?? check?.[0]?.['quick_check(1)'] ?? 'ok');
    if (verdict && verdict !== 'ok') problems.push(`دیتابیس آسیب‌دیده است (${verdict}).`);
    const have = new Set(tablesIn(db));
    if (!have.has('Customer') || !have.has('User')) {
      problems.push('این فایل دیتابیس خودِ برنامه (فردای روشن) نیست — جدول Customer/User ندارد.');
    }
    if (have.has('User')) {
      const cols = columnsOf(db, 'User');
      for (const need of ['username', 'passwordHash', 'role', 'active']) {
        if (!cols.has(need)) problems.push(`جدول User ستون «${need}» را ندارد — ساختار دیتابیس ناشناخته است.`);
      }
      /*
       * ساختار مورد انتظار «صفر کردن»: باید بتوانیم مدیر را دوباره بسازیم.
       * اگر جدول User ستون‌های لازم را داشته باشد، نوشتن مدیر با اطمینان
       * انجام می‌شود — همان چیزی که خطای گزارش‌شده را از ریشه می‌بندد.
       */
      if (!problems.length) {
        /*
         * آزمایشِ نوشتن با `BEGIN … ROLLBACK`: مطمئن می‌شویم ساخت کاربر
         * مدیر **واقعاً** کار می‌کند، بدون این‌که چیزی در دیتابیس بماند.
         * (چرا لازم است: خطای گزارش‌شده بعد از خالی شدن جدول‌ها رخ می‌داد؛
         * پیش‌بررسی باید همان نوشتن را قبل از پاک کردن بیازماید.)
         */
        try {
          db.exec('BEGIN');
          db.prepare(
            `INSERT INTO "User" ("username","fullName","passwordHash","role","active") VALUES (?,?,?,?,1)`,
          ).run('__preflight__', '', hashPassword('x'), 'manager');
          db.exec('ROLLBACK');
        } catch (e) {
          try { db.exec('ROLLBACK'); } catch { /* ignore */ }
          problems.push(`ساخت کاربر مدیر ممکن نیست: ${e?.message || e}`);
        }
      }
    }
    if (have.has('Customer')) {
      const cols = columnsOf(db, 'Customer');
      for (const need of ['code', 'name']) {
        if (!cols.has(need)) problems.push(`جدول Customer ستون «${need}» را ندارد — ساختار دیتابیس ناشناخته است.`);
      }
    }
    return { ok: problems.length === 0, problems };
  } catch (e) {
    return { ok: false, problems: [`بررسی دیتابیس ناموفق بود: ${e?.message || e}`] };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
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

  /* ۰) پیش‌بررسی — قبل از پشتیبان و قبل از هر تغییری (کلاس sqlite را خودش می‌آورد) */
  const pre = await preflight(paths);
  if (!pre.ok) {
    return {
      ok: false,
      problems: pre.problems,
      message: `صفر کردن انجام نشد — دیتابیس آماده نیست:\n• ${pre.problems.join('\n• ')}`,
    };
  }

  let backupFile = '';
  try { backupFile = backupNow(paths); }
  catch (e) { return { ok: false, message: `پشتیبان‌گیری ناموفق بود، صفر کردن انجام نشد: ${e.message || e}` }; }

  const db = openDbSync(paths.dbFile);
  const counts = {};
  let wiped = false;
  let closed = false;
  try {
    const have = new Set(tablesIn(db));
    /* بدون بررسی کلید خارجی — همه‌ی جدول‌ها یک‌جا خالی می‌شوند */
    try { db.exec('PRAGMA foreign_keys=OFF'); } catch { /* ignore */ }
    for (const t of RESET_ORDER) {
      if (!have.has(t)) continue;
      let n = 0;
      try { n = Number(db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get()?.c || 0); } catch { /* ignore */ }
      try { db.exec(`DELETE FROM "${t}"`); } catch (e) {
        /* پیام کوتاه — توضیح «نیمه‌کاره/برگشت» را لایه‌ی بالاتر می‌دهد */
        throw new Error(`پاک کردن «${t}» ناموفق بود (${e.message || e})`);
      }
      if (n > 0) counts[t] = n;
    }
    try { db.exec('DELETE FROM sqlite_sequence'); } catch { /* ignore */ }
    /*
     * ── پاک‌سازی فیزیکی فایل (شکار باگ دور ۳۴) ─────────────────────────────
     * `DELETE` فقط صفحه‌ها را «آزاد» می‌کند؛ داده‌ی مشتری قبلی در فایل
     * می‌ماند و با ابزار بازیابی قابل بازگردانی است — یعنی «ردّ مشتری قبلی»
     * واقعاً پاک نمی‌شد و حجم فایل هم همان می‌ماند. `VACUUM` فایل را از نو
     * می‌سازد (داده‌ی آزادشده حذف می‌شود) و اندازه هم کوچک می‌شود.
     * `wal_checkpoint(TRUNCATE)` هم WAL را خالی می‌کند تا ردیف‌های قدیمی در
     * فایل کنارِ دیتابیس نمانند.
     */
    try { db.exec('VACUUM'); } catch { /* اگر نشد، صفر کردن موفق است */ }
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    try { db.exec('PRAGMA foreign_keys=ON'); } catch { /* ignore */ }
    wiped = true;

    /* ۲.۵) ستون‌های کمکی — دیتابیس نصب‌های قدیمی ممکن است نداشته باشند
       (`isWalkIn`/`isDemo`). پیش از این، نبودشان همین‌جا وسط کار می‌شکست
       (گزارش کاربر: «table Customer has no column named isWalkIn»). */
    const addedColumns = ensureOptionalColumns(db, have);

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

    /*
     * «مشتری گذری» — بل فروش بدون مشتری باید همان لحظه قابل ثبت باشد.
     *
     * ستون `isWalkIn` اختیاری نوشته می‌شود: اگر دیتابیس قدیمی باشد و
     * `ensureOptionalColumns` هم نتوانسته اضافه‌اش کند، ردیف بدون آن ساخته
     * می‌شود — نبودِ یک پرچم نباید کل صفر کردن را بشکند.
     */
    if (have.has('Customer')) {
      const row = db.prepare('SELECT "id" FROM "Customer" WHERE "code"=?').get('000');
      if (!row) {
        /*
         * فقط `code` و `name` نوشته می‌شوند (هر دو NOT NULL و بی‌پیش‌فرض)،
         * بقیه‌ی ستون‌ها پیش‌فرض خودشان را می‌گیرند و `isWalkIn` تنها اگر
         * وجود داشته باشد. این شکل روی هر نسخه‌ای از جدول Customer کار
         * می‌کند — همان درسی که خطای «no column named isWalkIn» داد.
         */
        const custCols = columnsOf(db, 'Customer');
        const cols = ['"code"', '"name"'];
        const vals = ["'000'", "'مشتری گذری (بدون حساب)'"];
        if (custCols.has('isWalkIn')) { cols.push('"isWalkIn"'); vals.push('1'); }
        db.prepare(`INSERT INTO "Customer" (${cols.join(',')}) VALUES (${vals.join(',')})`).run();
      }
    }

    /*
     * ۱.۵) لایسنس و ساعت دوره‌ی آزمایشی — ردّ مشتری قبلی (شکار باگ دور ۳۴)
     *
     * باگ: این‌جا فقط `license.key` و `*.req/*.lic/renew*` پاک می‌شد، ولی
     * `license.trial` و `license.clock` می‌ماندند. روی نصب آفلاین، دوره‌ی
     * آزمایشی از همان مُهرِ قبلی ادامه می‌داد — یعنی مشتری **جدید** برنامه را
     * با «دوره‌ی آزمایشی تمام شد» تحویل می‌گرفت یا روزهای کمتری داشت. صفحه
     * هم صریح می‌گفت لایسنس پاک می‌شود، پس رفتار با وعده یکی نبود.
     *
     * نسخه‌ی آنلاین (`common/reset.ts`) هر سه فایل را پاک می‌کرد؛ حالا هر دو
     * یک کار می‌کنند.
     */
    let removedLicense = false;
    for (const f of safeReaddir(paths.dataDir)) {
      const isLicense = f === 'license.key' || f === 'license.trial' || f === 'license.clock';
      const isOld = /\.(req|lic)$/i.test(f) || /^renew/i.test(f);
      if (!isLicense && !isOld) continue;
      try {
        fs.unlinkSync(path.join(paths.dataDir, f));
        removedLicense = removedLicense || isOld || f !== 'license.clock';
      } catch { /* ignore */ }
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const at = new Date().toISOString();
    const report = {
      at, operator: opts.operator || 'reset-tool', reason: String(opts.reason || '').slice(0, 300),
      counts, total, backupFile: path.basename(backupFile), admin,
      removedLicense, removedBackups: 0, mode: 'offline', host: hostName(),
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

    if (opts.wipeBackups !== false) report.removedBackups = wipeBackups(paths, backupFile);
    fs.writeFileSync(path.join(paths.dataDir, RESET_MARK_FILE), JSON.stringify(report, null, 2), 'utf8');

    return {
      ok: true,
      message: total
        ? `سیستم صفر شد — ${total.toLocaleString('fa-IR')} ردیف پاک شد. مدیر: admin / admin123`
        : 'دیتابیس از قبل خالی بود؛ کاربر مدیر و مشتری گذری بازسازی شد.',
      counts, total, backupFile: report.backupFile, admin, at,
      operator: report.operator, removedLicense: report.removedLicense,
      removedBackups: report.removedBackups, mode: 'offline',
    };
  } catch (e) {
    /*
     * اتصال **اول** بسته می‌شود، بعد فایل برگردانده می‌شود: اگر با اتصال
     * باز فایل را عوض کنیم، SQLite در بستن، WAL خودش (حاوی DELETEها) را
     * دوباره روی فایل تازه می‌نویسد و بازگردانی بی‌اثر می‌شود.
     */
    try { db.close(); } catch { /* ignore */ }
    closed = true;
    /*
     * ── برگشتِ خودکار (باگ گزارش‌شده) ────────────────────────────────────
     * پیش‌تر اگر بعد از خالی کردن جدول‌ها خطایی رخ می‌داد (مثل نبود ستون
     * `isWalkIn`)، دیتابیس **نیمه‌کاره** رها می‌شد: داده رفته بود و کاربر
     * مدیر هم ساخته نشده بود، ولی پیام خطا می‌گفت «صفر کردن انجام نشد».
     * حالا در هر خطایی پشتیبانِ همین چند لحظه پیش برگردانده می‌شود و
     * دیتابیس دقیقاً به حالت قبل برمی‌گردد.
     */
    const rolled = rolledBack(backupFile, paths);
    return {
      ok: false,
      rolledBack: rolled,
      backupFile: path.basename(backupFile),
      message: `صفر کردن نیمه‌کاره ماند: ${e?.message || e}\n` +
        (rolled
          ? 'دیتابیس به حالت قبلِ صفر کردن برگردانده شد — هیچ داده‌ای از دست نرفت.'
          : `برگرداندن خودکار ناموفق بود؛ فایل پشتیبان را دستی بازگردانید: ${path.basename(backupFile)}`),
    };
  } finally {
    if (!closed) {
      try { db.exec('PRAGMA foreign_keys=ON'); } catch { /* ignore */ }
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * بازگرداندن دیتابیس از پشتیبانِ همین عملیات.
 *
 * ⚠ اتصال باید **بسته** باشد، وگرنه ویندوز اجازه‌ی بازنویسی فایل را نمی‌دهد
 * (EBUSY) — به همین دلیل بعد از `db.close()` در `finally` صدا زده نمی‌شود،
 * بلکه پیش از آن مسیر خطا.
 */
function rolledBack(backupFile, paths) {
  try {
    if (!backupFile || !fs.existsSync(backupFile)) return false;
    fs.copyFileSync(backupFile, paths.dbFile);
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(paths.dbFile + suffix, { force: true }); } catch { /* ignore */ }
    }
    return true;
  } catch { return false; }
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}
function hostName() {
  /* ماژول ESM است — `require` این‌جا وجود ندارد؛ از خودِ پروسه می‌خوانیم */
  try { return String(process.env.COMPUTERNAME || process.env.HOSTNAME || ''); } catch { return ''; }
}
