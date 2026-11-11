/**
 * حذف نرم — «فقط از ظاهر حذف شود، نه از سابقه».
 *
 * درخواست کاربر: «قابلیت حذف و ویرایش در جاهای که نیاز است اضافه شود و
 * حذف‌ها نرم باشند یعنی فقط ظاهر حذف می‌شود ولی از سابقه فعالیت‌ها قابل
 * بازیابی بدون آسیب».
 *
 * ## چرا «حذف سخت» خطرناک است
 * در این برنامه، یک «بل فروش» حذف‌شده یعنی مانده‌ی حساب مشتری عوض می‌شود؛
 * یک «کارمند» حذف‌شده یعنی معاش‌های قبلی‌اش یتیم می‌شوند. اگر حذف اشتباهی
 * باشد، بازگرداندنش از پشتیبان، همه‌ی کارهای بعد از آن را هم از بین می‌برد.
 *
 * ## طراحی
 *   • هر ردیف ستون `deletedAt` (TEXT) و `deletedBy` (TEXT) دارد.
 *   • `deletedAt IS NULL` (یا `''`) → فعال.
 *   • حذف = پر کردن این دو ستون. ردیف سر جایش می‌ماند.
 *   • همه‌ی کوئری‌های خواندن باید `AND COALESCE("deletedAt",'')=''` داشته
 *     باشند تا حذف‌شده‌ها در لیست‌ها دیده نشوند.
 *   • «سطل بازیافت» همین ردیف‌ها را نشان می‌دهد و `restore` برمی‌گرداند.
 *
 * ⚠ عمداً از `prisma.$softDelete` استفاده نمی‌کنیم: کل پروژه با SQL خام کار
 * می‌کند و مخلوط کردن دو سبک، منبع باگ‌های سکوت‌آمیز می‌شود.
 */
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { logActivity } from './activity';

/** جدول‌هایی که حذف نرم دارند — با نام فارسی برای UI */
export const SOFT_TABLES: Record<string, { label: string; titleCol: string; extraCols?: string[] }> = {
  Sale: { label: 'بل فروش', titleCol: 'no', extraCols: ['customerName', 'total'] },
  Receipt: { label: 'رسید', titleCol: 'no', extraCols: ['customerName', 'amount'] },
  Expense: { label: 'مصرف', titleCol: 'no', extraCols: ['description', 'amountAfn'] },
  Customer: { label: 'مشتری', titleCol: 'name', extraCols: ['code', 'phone'] },
  Employee: { label: 'کارمند', titleCol: 'name', extraCols: ['code', 'position'] },
  Salary: { label: 'معاش', titleCol: 'no', extraCols: ['employeeName', 'total'] },
  Attendance: { label: 'حضور و غیاب', titleCol: 'date' },
  Machinery: { label: 'ماشینری', titleCol: 'name', extraCols: ['model', 'plateNo'] },
};

const SAFE = /^[A-Za-z]+$/;

function assertTable(table: string) {
  if (!SOFT_TABLES[table] || !SAFE.test(table)) {
    throw new Error(`جدول ناشناخته: ${table}`);
  }
}

/** آیا این ردیف حذف شده است؟ */
export async function isDeleted(table: string, id: number): Promise<boolean> {
  assertTable(table);
  await ensureSchemaAsync();
  const rows: any[] = await db().$queryRawUnsafe(
    `SELECT "deletedAt" FROM "${table}" WHERE "id" = ?`, id,
  );
  if (!rows.length) return false;
  return Boolean(rows[0].deletedAt);
}

/**
 * حذف نرم. اگر ردیف از قبل حذف شده باشد، بی‌صدا کاری نمی‌کند (idempotent).
 *
 * خروجی: `{ ok, row, already }` — `row` برای نمایش در پیام «حذف شد» است.
 */
export async function softDelete(
  table: string, id: number, opts: { username?: string; reason?: string } = {},
): Promise<{ ok: boolean; already: boolean; row: any | null }> {
  assertTable(table);
  await ensureSchemaAsync();
  const meta = SOFT_TABLES[table];
  const cols = ['id', meta.titleCol, ...(meta.extraCols || [])].map((c) => `"${c}"`).join(',');
  const rows: any[] = await db().$queryRawUnsafe(`SELECT ${cols}, "deletedAt" FROM "${table}" WHERE "id" = ?`, id);
  if (!rows.length) return { ok: false, already: false, row: null };
  if (rows[0].deletedAt) return { ok: true, already: true, row: rows[0] };

  const stamp = new Date().toISOString();
  const who = (opts.username || 'system').slice(0, 80);
  await db().$executeRawUnsafe(
    `UPDATE "${table}" SET "deletedAt" = ?, "deletedBy" = ? WHERE "id" = ?`, stamp, who, id,
  );
  await logActivity({
    username: who, action: 'soft-delete', entity: table, entityId: id,
    detail: `${meta.label} ${rows[0][meta.titleCol] ?? id} حذف شد${opts.reason ? ` — ${opts.reason}` : ''}`,
  });
  return { ok: true, already: false, row: rows[0] };
}

/** بازگرداندن ردیف حذف‌شده */
export async function restore(
  table: string, id: number, opts: { username?: string } = {},
): Promise<{ ok: boolean; row: any | null }> {
  assertTable(table);
  await ensureSchemaAsync();
  const meta = SOFT_TABLES[table];
  const rows: any[] = await db().$queryRawUnsafe(
    `SELECT "id", "${meta.titleCol}" AS t, "deletedAt" FROM "${table}" WHERE "id" = ?`, id,
  );
  if (!rows.length) return { ok: false, row: null };
  if (!rows[0].deletedAt) return { ok: true, row: rows[0] };

  await db().$executeRawUnsafe(
    `UPDATE "${table}" SET "deletedAt" = NULL, "deletedBy" = NULL WHERE "id" = ?`, id,
  );
  const who = (opts.username || 'system').slice(0, 80);
  await logActivity({
    username: who, action: 'restore', entity: table, entityId: id,
    detail: `${meta.label} ${rows[0].t ?? id} بازیابی شد`,
  });
  return { ok: true, row: rows[0] };
}

/** فهرست حذف‌شده‌ها — برای «سطل بازیافت» */
export async function listDeleted(table: string, limit = 200, offset = 0): Promise<any[]> {
  assertTable(table);
  await ensureSchemaAsync();
  const meta = SOFT_TABLES[table];
  const cols = ['id', meta.titleCol, ...(meta.extraCols || [])].map((c) => `"${c}"`).join(',');
  const take = Math.min(Math.max(Math.trunc(limit) || 1, 1), 500);
  const skip = Math.max(Math.trunc(offset) || 0, 0);
  return db().$queryRawUnsafe(
    /*
     * `ORDER BY deletedAt DESC, id DESC` — بدون کلید دوم، ردیف‌هایی که در
     * یک ثانیه حذف شده‌اند ترتیب ثابتی نداشتند و با صفحه‌بندی می‌توانستند
     * هم دو بار دیده شوند و هم هیچ‌جا. (همان باگ کلاسیک OFFSET)
     */
    `SELECT ${cols}, "deletedAt", "deletedBy" FROM "${table}"
     WHERE COALESCE("deletedAt",'') <> '' ORDER BY "deletedAt" DESC, "id" DESC LIMIT ? OFFSET ?`,
    take, skip,
  );
}

/** تعداد کل ردیف‌های حذف‌شده‌ی یک جدول (برای صفحه‌بندی سطل بازیافت) */
export async function deletedCountOf(table: string): Promise<number> {
  assertTable(table);
  await ensureSchemaAsync();
  const r: any[] = await db().$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM "${table}" WHERE COALESCE("deletedAt",'') <> ''`,
  );
  return Number(r?.[0]?.n) || 0;
}

/** شمارش حذف‌شده‌ها در همه‌ی جدول‌ها — برای نشان روی منو */
export async function deletedCounts(): Promise<Record<string, number>> {
  await ensureSchemaAsync();
  const out: Record<string, number> = {};
  for (const table of Object.keys(SOFT_TABLES)) {
    try {
      const r: any[] = await db().$queryRawUnsafe(
        `SELECT COUNT(*) AS n FROM "${table}" WHERE COALESCE("deletedAt",'') <> ''`,
      );
      out[table] = Number(r[0]?.n) || 0;
    } catch { out[table] = 0; }
  }
  return out;
}
