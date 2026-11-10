import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { toCalendar, CalendarMode } from './calendar';

/** Which table each prefix belongs to (used to guarantee uniqueness). */
const PREFIX_TABLES: Record<string, string> = {
  S: 'Sale',
  E: 'Expense',
  R: 'Receipt',
  P: 'Salary',
  SA: 'Sale',
  EX: 'Expense',
  RC: 'Receipt',
  SL: 'Salary',
};

/**
 * Automatic document numbers, e.g. "S-1404-0042" / "E-2025-0007".
 *
 * The counter is per prefix + fiscal year. Even if numbers were entered
 * manually before (or data was imported), the function keeps incrementing
 * until it finds a number that is not used yet — a duplicate is impossible.
 */
export async function nextDocNo(
  prefix: string,
  mode: CalendarMode,
  dateISO: string,
): Promise<string> {
  await ensureSchemaAsync();
  const p = prefix || 'D';
  const year = toCalendar(dateISO, mode).jy;
  const scope = `${p}-${year}`;
  const table = PREFIX_TABLES[p];
  const conn = db();
  await conn.$executeRawUnsafe(
    `INSERT INTO "Sequence" ("scope","value") VALUES (?,0) ON CONFLICT("scope") DO NOTHING`,
    scope,
  );
  for (let attempt = 0; attempt < 5000; attempt++) {
    await conn.$executeRawUnsafe(`UPDATE "Sequence" SET "value" = "value" + 1 WHERE "scope" = ?`, scope);
    const rows: any[] = await conn.$queryRawUnsafe(
      `SELECT "value" FROM "Sequence" WHERE "scope" = ?`,
      scope,
    );
    const value = Number(rows?.[0]?.value ?? 1);
    const no = `${p}-${year}-${String(value).padStart(4, '0')}`;
    if (!table) return no;
    const used: any[] = await conn.$queryRawUnsafe(
      `SELECT 1 FROM "${table}" WHERE "no" = ? LIMIT 1`,
      no,
    );
    if (!used?.length) return no;
  }
  // extremely unlikely — fall back to a timestamp suffix
  return `${p}-${year}-${Date.now().toString().slice(-6)}`;
}

/** Repair a counter after an import / restore. */
export async function syncSequence(prefix: string, year: number, usedValues: number[]) {
  const scope = `${prefix}-${year}`;
  const max = usedValues.length ? Math.max(...usedValues) : 0;
  await db().$executeRawUnsafe(
    `INSERT INTO "Sequence" ("scope","value") VALUES (?,?) ON CONFLICT("scope") DO UPDATE SET "value"=excluded."value"`,
    scope,
    max,
  );
}
