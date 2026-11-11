/**
 * schema.ts — creates / repairs the SQLite structure at start-up.
 *
 * We keep the DDL here (instead of relying on `prisma migrate`, which needs an
 * internet connection the first time it downloads an engine) so that the app
 * can be installed and upgraded on a machine with **no internet at all**.
 *
 * Every statement is idempotent (CREATE TABLE IF NOT EXISTS) and a tiny
 * "add column if missing" pass upgrades databases created by older versions.
 */
import { db } from './db';
import { RECEIPT_SOURCE_ALIASES, RECEIPT_SOURCES, WALK_IN_CODE, WALK_IN_NAME } from './common/domain';

type Column = { name: string; ddl: string };

const TABLES: { name: string; sql: string; columns?: Column[] }[] = [
  {
    name: 'Company',
    sql: `CREATE TABLE IF NOT EXISTS "Company" (
      "id" INTEGER NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL DEFAULT 'فردای روشن',
      "activityType" TEXT NOT NULL DEFAULT 'تولید مواد ساختمانی',
      "address" TEXT NOT NULL DEFAULT '',
      "fiscalYear" TEXT NOT NULL DEFAULT '',
      "financeManager" TEXT NOT NULL DEFAULT '',
      "supervisor" TEXT NOT NULL DEFAULT '',
      "logoPath" TEXT,
      "phone" TEXT NOT NULL DEFAULT '',
      "email" TEXT NOT NULL DEFAULT '',
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'Employee',
    sql: `CREATE TABLE IF NOT EXISTS "Employee" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "fatherName" TEXT NOT NULL DEFAULT '',
      "position" TEXT NOT NULL DEFAULT '',
      "hireDate" TEXT NOT NULL DEFAULT '',
      "baseSalary" REAL NOT NULL DEFAULT 0,
      "phone" TEXT NOT NULL DEFAULT '',
      "nationalId" TEXT NOT NULL DEFAULT '',
      "address" TEXT NOT NULL DEFAULT '',
      "contractPeriod" TEXT NOT NULL DEFAULT '',
      "status" TEXT NOT NULL DEFAULT 'active',
      "note" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'Attendance',
    sql: `CREATE TABLE IF NOT EXISTS "Attendance" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "employeeId" INTEGER NOT NULL,
      "date" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'present',
      "checkIn" TEXT NOT NULL DEFAULT '',
      "checkOut" TEXT NOT NULL DEFAULT '',
      "overtime" REAL NOT NULL DEFAULT 0,
      "note" TEXT NOT NULL DEFAULT '',
      CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
  },
  {
    name: 'Customer',
    sql: `CREATE TABLE IF NOT EXISTS "Customer" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "contactPerson" TEXT NOT NULL DEFAULT '',
      "phone" TEXT NOT NULL DEFAULT '',
      "truckPlate" TEXT NOT NULL DEFAULT '',
      "openingBalance" REAL NOT NULL DEFAULT 0,
      "note" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'Sale',
    sql: `CREATE TABLE IF NOT EXISTS "Sale" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "no" TEXT NOT NULL,
      "date" TEXT NOT NULL,
      "customerId" INTEGER NOT NULL,
      "customerName" TEXT NOT NULL DEFAULT '',
      "driverName" TEXT NOT NULL DEFAULT '',
      "truckPlate" TEXT NOT NULL DEFAULT '',
      "destination" TEXT NOT NULL DEFAULT '',
      "materialId" INTEGER,
      "materialName" TEXT NOT NULL DEFAULT '',
      "volume" REAL NOT NULL DEFAULT 0,
      "unitPrice" REAL NOT NULL DEFAULT 0,
      "freightPerUnit" REAL NOT NULL DEFAULT 0,
      "freightTotal" REAL NOT NULL DEFAULT 0,
      "total" REAL NOT NULL DEFAULT 0,
      "contractorId" INTEGER,
      "contractorName" TEXT NOT NULL DEFAULT '',
      "paymentType" TEXT NOT NULL DEFAULT 'cash',
      "note" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
  },
  {
    name: 'Expense',
    sql: `CREATE TABLE IF NOT EXISTS "Expense" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "no" TEXT NOT NULL,
      "date" TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "categoryId" INTEGER,
      "categoryName" TEXT NOT NULL DEFAULT '',
      "contractorId" INTEGER,
      "contractorName" TEXT NOT NULL DEFAULT '',
      "purchaseBillNo" TEXT NOT NULL DEFAULT '',
      "shopName" TEXT NOT NULL DEFAULT '',
      "amountAfn" REAL NOT NULL DEFAULT 0,
      "amountUsd" REAL NOT NULL DEFAULT 0,
      "payerId" INTEGER,
      "payerName" TEXT NOT NULL DEFAULT '',
      "paymentType" TEXT NOT NULL DEFAULT 'cash',
      "note" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'Receipt',
    sql: `CREATE TABLE IF NOT EXISTS "Receipt" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "no" TEXT NOT NULL,
      "date" TEXT NOT NULL,
      "customerId" INTEGER NOT NULL,
      "customerName" TEXT NOT NULL DEFAULT '',
      "amount" REAL NOT NULL DEFAULT 0,
      "relatedBillNo" TEXT NOT NULL DEFAULT '',
      "sourceId" INTEGER,
      "sourceName" TEXT NOT NULL DEFAULT '',
      "receivedBy" TEXT NOT NULL DEFAULT '',
      "note" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Receipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
  },
  {
    name: 'Salary',
    sql: `CREATE TABLE IF NOT EXISTS "Salary" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "no" TEXT NOT NULL,
      "periodStart" TEXT NOT NULL,
      "periodLabel" TEXT NOT NULL DEFAULT '',
      "calendar" TEXT NOT NULL DEFAULT 'jalali',
      "year" INTEGER NOT NULL,
      "month" INTEGER NOT NULL,
      "payDate" TEXT NOT NULL DEFAULT '',
      "employeeId" INTEGER NOT NULL,
      "employeeName" TEXT NOT NULL DEFAULT '',
      "baseSalary" REAL NOT NULL DEFAULT 0,
      "bonus" REAL NOT NULL DEFAULT 0,
      "penalty" REAL NOT NULL DEFAULT 0,
      "overtimeAmount" REAL NOT NULL DEFAULT 0,
      "total" REAL NOT NULL DEFAULT 0,
      "payerName" TEXT NOT NULL DEFAULT '',
      "paymentType" TEXT NOT NULL DEFAULT 'cash',
      "note" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Salary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
  },
  {
    name: 'LookupItem',
    sql: `CREATE TABLE IF NOT EXISTS "LookupItem" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "type" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "extra" TEXT NOT NULL DEFAULT '',
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "active" BOOLEAN NOT NULL DEFAULT true
    )`,
  },
  {
    name: 'User',
    sql: `CREATE TABLE IF NOT EXISTS "User" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "username" TEXT NOT NULL,
      "fullName" TEXT NOT NULL DEFAULT '',
      "passwordHash" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'manager',
      "active" BOOLEAN NOT NULL DEFAULT true,
      "lastLoginAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'Setting',
    sql: `CREATE TABLE IF NOT EXISTS "Setting" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "value" TEXT NOT NULL
    )`,
  },
  {
    name: 'Machinery',
    sql: `CREATE TABLE IF NOT EXISTS "Machinery" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "model" TEXT NOT NULL DEFAULT '',
      "plateNo" TEXT NOT NULL DEFAULT '',
      "count" INTEGER NOT NULL DEFAULT 1,
      "status" TEXT NOT NULL DEFAULT 'active',
      "note" TEXT NOT NULL DEFAULT ''
    )`,
  },
  {
    name: 'ActivityLog',
    sql: `CREATE TABLE IF NOT EXISTS "ActivityLog" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "username" TEXT NOT NULL DEFAULT '',
      "action" TEXT NOT NULL,
      "entity" TEXT NOT NULL DEFAULT '',
      "entityId" INTEGER,
      "detail" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'Sequence',
    sql: `CREATE TABLE IF NOT EXISTS "Sequence" (
      "scope" TEXT NOT NULL PRIMARY KEY,
      "value" INTEGER NOT NULL DEFAULT 0
    )`,
  },
];

const INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "Employee_code_key" ON "Employee"("code")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Customer_code_key" ON "Customer"("code")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Sale_no_key" ON "Sale"("no")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Expense_no_key" ON "Expense"("no")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Receipt_no_key" ON "Receipt"("no")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Salary_no_key" ON "Salary"("no")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Salary_employee_period_key" ON "Salary"("employeeId","periodStart")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Attendance_employee_date_key" ON "Attendance"("employeeId","date")`,
  `CREATE INDEX IF NOT EXISTS "Attendance_date_idx" ON "Attendance"("date")`,
  `CREATE INDEX IF NOT EXISTS "Sale_date_idx" ON "Sale"("date")`,
  `CREATE INDEX IF NOT EXISTS "Sale_customer_idx" ON "Sale"("customerId")`,
  `CREATE INDEX IF NOT EXISTS "Expense_date_idx" ON "Expense"("date")`,
  `CREATE INDEX IF NOT EXISTS "Receipt_date_idx" ON "Receipt"("date")`,
  `CREATE INDEX IF NOT EXISTS "Receipt_customer_idx" ON "Receipt"("customerId")`,
  `CREATE INDEX IF NOT EXISTS "Lookup_type_idx" ON "LookupItem"("type")`,
  `CREATE INDEX IF NOT EXISTS "Salary_period_idx" ON "Salary"("periodStart")`,
  `CREATE INDEX IF NOT EXISTS "ActivityLog_date_idx" ON "ActivityLog"("createdAt")`,
];

/** Optional columns added in later releases (auto-upgrade of old databases). */
const UPGRADES: { table: string; column: string; ddl: string }[] = [
  { table: 'Company', column: 'logoPath', ddl: 'TEXT' },
  { table: 'Company', column: 'phone', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'Company', column: 'email', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'Salary', column: 'periodStart', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'Salary', column: 'periodLabel', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'Salary', column: 'calendar', ddl: "TEXT NOT NULL DEFAULT 'jalali'" },
  { table: 'Salary', column: 'payDate', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'Sale', column: 'contractorId', ddl: 'INTEGER' },
  { table: 'Sale', column: 'contractorName', ddl: "TEXT NOT NULL DEFAULT ''" },

  /*
   * ---- حذف نرم (soft delete) ----
   *
   * درخواست کاربر: «حذف‌ها نرم باشند، یعنی فقط از ظاهر حذف شوند ولی از
   * سابقه‌ی فعالیت‌ها قابل بازیابی باشند، بدون آسیب».
   *
   * `deletedAt` خالی = ردیف فعال. وقتی «حذف» می‌شود، فقط همین ستون پر
   * می‌شود؛ ردیف در دیتابیس می‌ماند و گزارش‌ها/مانده‌ها دست‌نخورده‌اند.
   * «سطل بازیافت» ردیف‌ها را با همین ستون پیدا و برمی‌گرداند.
   *
   * چرا TEXT و نه DATETIME: SQLite با ستون DATETIME و مقدار '' مشکل
   * مقایسه دارد؛ با TEXT همه‌چیز ساده و قابل خواندن است:
   *   deletedAt = NULL  → فعال
   *   deletedAt = '2026-11-10T08:00:00.000Z' → حذف‌شده
   */
  { table: 'Customer', column: 'deletedAt', ddl: 'TEXT' },
  { table: 'Employee', column: 'deletedAt', ddl: 'TEXT' },
  { table: 'Sale', column: 'deletedAt', ddl: 'TEXT' },
  { table: 'Receipt', column: 'deletedAt', ddl: 'TEXT' },
  { table: 'Expense', column: 'deletedAt', ddl: 'TEXT' },
  { table: 'Salary', column: 'deletedAt', ddl: 'TEXT' },
  { table: 'Attendance', column: 'deletedAt', ddl: 'TEXT' },
  /* چه کسی حذف کرد و چرا — برای بازیابی مطمئن */
  { table: 'Customer', column: 'deletedBy', ddl: 'TEXT' },
  { table: 'Employee', column: 'deletedBy', ddl: 'TEXT' },
  { table: 'Sale', column: 'deletedBy', ddl: 'TEXT' },
  { table: 'Receipt', column: 'deletedBy', ddl: 'TEXT' },
  { table: 'Expense', column: 'deletedBy', ddl: 'TEXT' },
  { table: 'Salary', column: 'deletedBy', ddl: 'TEXT' },
  { table: 'Attendance', column: 'deletedBy', ddl: 'TEXT' },
  /*
   * ماشینری هم حذف نرم دارد.
   *
   * چرا مهم است: ماشین‌ها در گزارش تولید و در قیمت تمام‌شده نقش دارند.
   * حذف سخت یک «کمپرسی» یعنی پرسیدن «این بل با کدام ماشین حمل شد؟» دیگر
   * جواب ندارد. با حذف نرم، نامش از فهرست می‌رود ولی سابقه سالم می‌ماند.
   */
  { table: 'Machinery', column: 'deletedAt', ddl: 'TEXT' },
  { table: 'Machinery', column: 'deletedBy', ddl: 'TEXT' },

  /*
   * ---- مشتری گذری (بدون حساب) ----
   *
   * درخواست کاربر: «اگر مشتری انتخاب نشود، معامله روی مشتری گذری ثبت شود».
   *
   * پرچم `isWalkIn` روی خود جدول مشتری است تا:
   *   • فهرست مشتریان و فهرست‌های کشویی فورم‌ها آن را نشان ندهند،
   *   • مانده‌ی آن در «مجموع بدهی مشتریان» شمرده نشود،
   *   • اما بل/رسیدِ گذری سند کامل و قابل گزارش باشد.
   * `isDemo` برای داده‌ی نمونه است (پاک‌کردن نمونه نباید داده‌ی واقعی را لمس کند).
   */
  { table: 'Customer', column: 'isWalkIn', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Sale', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Receipt', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Expense', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Salary', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Attendance', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Employee', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Customer', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Machinery', column: 'isDemo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
];

/**
 * مهاجرت داده (نسخه‌ی ۴): یکسان‌سازی منابع رسید و مفهوم «مربوط».
 *
 * چرا داده را هم می‌نویسیم و نه فقط در خواندن نگاشت می‌کنیم:
 *   ۱) فهرست‌های کشویی «بیانیه» و «پیش پرداخت» را هر دو داشتند؛ کاربر
 *      گفت یکی است. اگر ردیف تکراری بماند، دوباره انتخاب می‌شود.
 *   ۲) گزارش‌های SQL روی `sourceName` گروه می‌کنند؛ با دو املا، یک منبع
 *      در گزارش دو خط می‌شود.
 *
 * امن است: فقط `sourceName` رسیدها و `name` فهرست `receipt_source` بازنویسی
 * می‌شود — مبلغ، تاریخ و مشتری دست نمی‌خورد، هیچ ردیفی حذف نمی‌شود.
 */
export async function migrateReceiptSources() {
  const p = db();
  /* ۱) رسیدها: نام قدیمی → نام رسمی */
  for (const [from, to] of Object.entries(RECEIPT_SOURCE_ALIASES)) {
    if (from === to) continue;
    await p.$executeRawUnsafe(`UPDATE "Receipt" SET "sourceName"=? WHERE "sourceName"=?`, to, from);
  }
  /*
   * ۲) فهرست کشویی: نام قدیمی را به نام رسمی تغییر بده، بعد ردیف‌های تکراری
   *    همان نام را غیرفعال کن (قدیمی‌ترین فعال می‌ماند).
   *
   * ⚠ هیچ ردیفی حذف نمی‌شود: کاربر گفته «حذف‌ها نرم باشند». ردیف تکراری
   * فقط `active=0` می‌شود، پس اگر روزی لازم شد، از همان‌جا برمی‌گردد.
   */
  for (const [from, to] of Object.entries(RECEIPT_SOURCE_ALIASES)) {
    if (from === to) continue;
    await p.$executeRawUnsafe(
      `UPDATE "LookupItem" SET "name"=? WHERE "type"='receipt_source' AND "name"=?`,
      to, from,
    );
  }
  /* ۳) همه‌ی منابع رسمی باید در فهرست باشند (بیانیه، امانت، باقی داری، مربوط) */
  for (const s of RECEIPT_SOURCES) {
    const has = await p.$queryRawUnsafe(
      `SELECT COUNT(*) c FROM "LookupItem" WHERE "type"='receipt_source' AND "name"=?`,
      s.name,
    );
    if (!Number(has?.[0]?.c)) {
      await p.$executeRawUnsafe(
        `INSERT INTO "LookupItem" ("type","name","extra","sortOrder","active") VALUES ('receipt_source',?,?,?,1)`,
        s.name, s.kind, RECEIPT_SOURCES.findIndex((x) => x.name === s.name) + 1,
      );
    } else {
      /* دست‌کم یکی از ردیف‌های همین نام باید فعال باشد */
      await p.$executeRawUnsafe(
        `UPDATE "LookupItem" SET "active"=1
         WHERE "type"='receipt_source' AND "name"=?
           AND "id"=(SELECT MIN("id") FROM "LookupItem" WHERE "type"='receipt_source' AND "name"=?)`,
        s.name, s.name,
      );
    }
  }
  await dedupeReceiptSources();
}

/** ردیف‌های تکراری یک نام را غیرفعال می‌کند (قدیمی‌ترین فعال می‌ماند). */
async function dedupeReceiptSources() {
  const p = db();
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT "id","name" FROM "LookupItem" WHERE "type"='receipt_source' ORDER BY "id"`,
  );
  const keep = new Map<string, number>();
  for (const r of rows) {
    const name = String(r.name);
    if (!keep.has(name)) keep.set(name, Number(r.id));
    else {
      const keepId = keep.get(name)!;
      /* قدیمی‌تر (کمترین id) با نام رسمی می‌ماند، بقیه غیرفعال */
      await p.$executeRawUnsafe(`UPDATE "LookupItem" SET "active"=0 WHERE "id"=?`, Number(r.id));
      await p.$executeRawUnsafe(`UPDATE "LookupItem" SET "active"=1 WHERE "id"=?`, keepId);
    }
  }
}

/**
 * مطمئن می‌شود «مشتری گذری (بدون حساب)» موجود است و برمی‌گرداند شناسه‌اش.
 *
 * idempotent: اگر ردیف باشد، فقط پرچم و نامش هم‌تراز می‌شود (اگر کاربر نام
 * را عوض کرده باشد) و از سطل بازیافت برمی‌گردد؛ ردیف تکراری ساخته
 * نمی‌شود چون `code='000'` است و یکتا.
 */
export async function ensureWalkInCustomer(): Promise<number> {
  const p = db();
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT "id" FROM "Customer" WHERE "code"=? LIMIT 1`, WALK_IN_CODE,
  );
  if (rows?.length) {
    const id = Number(rows[0].id);
    await p.$executeRawUnsafe(
      `UPDATE "Customer" SET "isWalkIn"=1, "deletedAt"=NULL, "deletedBy"=NULL WHERE "id"=?`, id,
    );
    return id;
  }
  await p.$executeRawUnsafe(
    `INSERT INTO "Customer" ("code","name","contactPerson","phone","truckPlate","openingBalance","note","isWalkIn")
     VALUES (?,?,'','','',0,'',1)`,
    WALK_IN_CODE, WALK_IN_NAME,
  );
  const again: any[] = await p.$queryRawUnsafe(
    `SELECT "id" FROM "Customer" WHERE "code"=? LIMIT 1`, WALK_IN_CODE,
  );
  return Number(again?.[0]?.id);
}

let schemaPromise: Promise<void> | null = null;

/**
 * آخرین دیتابیسی که ساختارش کامل بررسی شده — به‌همراه نسخه‌ی مهر.
 *
 * باگ کارایی (بازبینی): نسخه‌ی قبلی `ensureSchemaAsync` در **هر درخواست**
 * برای هر ۹ ستون اختیاری یک `PRAGMA table_info` می‌زد — یعنی ۹ رفت‌وبرگشت
 * اضافه قبل از هر کار.ثبت بل فروش (سریع‌ترین حالت) از ~۹ms به چند برابر
 * می‌رسید و با هزاران ثبت روزانه محسوس بود.
 *
 * حالا مهر `PRAGMA user_version` نگه‌دارنده‌ی نسخه‌ی ساختار است: اگر ساختار
 * همین کد روی همین فایل یک بار بررسی شده باشد، دیگر تکرار نمی‌شود. مهر در
 * خود دیتابیس است، پس بعد از ری‌استارت هم دوباره کامل بررسی می‌شود اگر
 * نسخه‌ی برنامه تغییر کرده باشد.
 */
const SCHEMA_VERSION = 6;
let schemaReadyFor: string | null = null;
let schemaReadyVersion = -1;

async function runSchema() {
  const p = db();
  await p.$executeRawUnsafe('PRAGMA journal_mode = WAL;');
  await p.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
  /*
   * `synchronous=NORMAL` در حالت WAL امن است (داده از دست نمی‌رود، فقط در
   * قطع برق ممکن است آخرین تراکنش برگردد) و هر ثبت را چند برابر سریع‌تر
   * می‌کند. پیش‌فرض FULL یعنی fsync برای هر نوشتن.
   */
  await p.$executeRawUnsafe('PRAGMA synchronous = NORMAL;');
  for (const t of TABLES) await p.$executeRawUnsafe(t.sql);
  for (const sql of INDEXES) await p.$executeRawUnsafe(sql);
}

/** Kick off (or reuse) the schema creation — every request awaits it. */
function kickSchema(force = false) {
  if (force) {
    schemaPromise = null;
    schemaReadyFor = null;
    schemaReadyVersion = -1;
  }
  if (!schemaPromise) schemaPromise = runSchema();
}

/** Await the structure, then run the "add missing column" upgrade pass. */
export async function ensureSchemaAsync(force = false) {
  kickSchema(force);
  await schemaPromise;

  /* شناسه‌ی فایل دیتابیس — اگر مسیر عوض شد (تست/بازگردانی) بررسی دوباره */
  const file = process.env.FD_DB_FILE || `${process.env.FD_DATA_DIR || 'default'}`;
  if (!force && schemaReadyFor === file && schemaReadyVersion === SCHEMA_VERSION) return true;

  const p = db();
  /* مهر نسخه در خود دیتابیس — بعد از آپدیت برنامه، بررسی دوباره انجام می‌شود */
  let dbVersion = 0;
  try {
    const v: any[] = await p.$queryRawUnsafe('PRAGMA user_version');
    dbVersion = Number(v?.[0]?.user_version ?? 0);
  } catch { /* ignore */ }

  if (dbVersion !== SCHEMA_VERSION) {
    for (const u of UPGRADES) {
      const cols: any[] = await p.$queryRawUnsafe(`PRAGMA table_info("${u.table}")`);
      if (!cols.some((c) => c.name === u.column)) {
        await p.$executeRawUnsafe(`ALTER TABLE "${u.table}" ADD COLUMN "${u.column}" ${u.ddl}`);
      }
    }
    /*
     * مشتری گذری: ردیف ثابت «بدون حساب» باید همیشه موجود باشد، وگرنه
     * بل فروشی که مشتری انتخاب نکرده جایی برای ثبت ندارد. این کار
     * idempotent است (اگر هست، فقط به‌روز می‌شود).
     */
    try {
      await ensureWalkInCustomer();
    } catch (e: any) {
      console.warn('ساخت مشتری گذری انجام نشد:', e?.message || e);
    }
    try {
      await migrateReceiptSources();
    } catch (e: any) {
      /*
       * مهاجرت داده نباید برنامه را از کار بیندازد؛ اگر شکست خورد، همان
       * نگاشت خواندنی (`canonicalReceiptSource`) کار را انجام می‌دهد و
       * دفعه‌ی بعد دوباره تلاش می‌شود (مهر نسخه ست نمی‌شود).
       */
      console.warn('مهاجرت منابع رسید انجام نشد:', e?.message || e);
    }
    await p.$executeRawUnsafe(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  /*
   * «مشتری گذری» را در **هر** بار بالا آمدن چک کن، نه فقط وقتی نسخه‌ی
   * ساختار عوض می‌شود.
   *
   * ## باگ
   * اگر ردیف گذری پاک/غیرفعال می‌شد (پاک‌سازی دستی، restore یک پشتیبان
   * قدیمی، یا دیتابیسی که قبل از نسخه‌ی ۵ ساخته شده ولی مهرش ۵ شده)،
   * تمام بل‌های بدون مشتری با خطای ۵۰۰ («مشتری پیدا نشد») رد می‌شدند و
   * راه برگشتی از داخل برنامه نبود، چون کد `000` برای کاربران رزرو است.
   *
   * تابع idempotent است: اگر ردیف سالم باشد فقط یک SELECT اضافه است.
   */
  try {
    await ensureWalkInCustomer();
  } catch (e: any) {
    console.warn('اطمینان از مشتری گذری انجام نشد:', e?.message || e);
  }

  schemaReadyFor = file;
  schemaReadyVersion = SCHEMA_VERSION;
  return true;
}

export const TABLE_LIST = TABLES.map((t) => t.name);
