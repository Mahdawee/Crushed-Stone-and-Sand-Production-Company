import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { CalendarMode } from './calendar';

/** Default settings — created on first run. */
export const DEFAULT_SETTINGS: Record<string, string> = {
  calendar: 'jalali',
  docPrefixSale: 'S',
  docPrefixExpense: 'E',
  docPrefixReceipt: 'R',
  docPrefixSalary: 'P',
  cashMode: 'simple', // simple | accurate  (موجودی دخل)
  usdRate: '0',
  theme: 'light',
  accent: 'teal',
  density: 'comfortable',
  fontFamily: 'vazirmatn',
  tableZebra: '1',
  companyNameInDocs: '1',
  backupReminderDays: '7',
  defaultCurrency: 'AFN',
  attendanceWorkHours: '8',
  overtimeRate: '1.25',
};

export class SettingsService {
  async ensureDefaults() {
    await ensureSchemaAsync();
    const p = db();
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await p.$executeRawUnsafe(
        `INSERT INTO "Setting" ("key","value") VALUES (?,?) ON CONFLICT("key") DO NOTHING`,
        key,
        value,
      );
    }
  }

  async all(): Promise<Record<string, string>> {
    await this.ensureDefaults();
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "key","value" FROM "Setting"`);
    const out: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async get(key: string): Promise<string> {
    const all = await this.all();
    return all[key] ?? '';
  }

  async set(key: string, value: string) {
    await ensureSchemaAsync();
    await db().$executeRawUnsafe(
      `INSERT INTO "Setting" ("key","value") VALUES (?,?) ON CONFLICT("key") DO UPDATE SET "value"=excluded."value"`,
      String(key),
      String(value ?? ''),
    );
    return { ok: true };
  }

  async setMany(values: Record<string, string>) {
    for (const [k, v] of Object.entries(values || {})) await this.set(k, v);
    return this.all();
  }

  async calendar(): Promise<CalendarMode> {
    const c = await this.get('calendar');
    return c === 'gregorian' ? 'gregorian' : 'jalali';
  }
}

export const settingsService = new SettingsService();
