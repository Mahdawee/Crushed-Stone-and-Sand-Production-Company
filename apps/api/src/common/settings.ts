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
  /*
   * نرخ دالر و کلید «دالری در سود/زیان».
   *
   * باگ (شکار باگ دور ۳۲): `usdRate` در تنظیمات ذخیره و اعتبارسنجی می‌شد
   * ولی **هیچ‌جا خوانده نمی‌شد** — کاربر نرخ می‌زد و هیچ عددی عوض نمی‌شد.
   * حالا اگر `usdInProfit='1'` باشد، مصارف دالری با همین نرخ به افغانی
   * تبدیل و در «مجموع مصارف» و سود/زیان حساب می‌شوند.
   * پیش‌فرض `0` (خاموش) است تا عددهای فعلی هیچ شرکتی بی‌خبر عوض نشود؛
   * تصمیمش با مدیر است.
   */
  usdRate: '0',
  usdInProfit: '0',
  theme: 'light',
  accent: 'teal',
  density: 'comfortable',
  corners: 'normal', // soft | normal | sharp
  fontFamily: 'vazirmatn',
  tableZebra: '1',
  companyNameInDocs: '1',
  backupReminderDays: '7',
  defaultCurrency: 'AFN',
  attendanceWorkHours: '8',
  overtimeRate: '1.25',
};

/**
 * اعتبارسنجی تنظیمات — «هر چیزی که فرستاده شد» ذخیره نشود.
 *
 * باگ (با فاز تست پیدا شد): `PUT /settings` با `{calendar:'martian'}` هم ۲۰۰
 * برمی‌گرداند و مقدار نامعتبر ذخیره می‌شد؛ بعد از آن تقویم/گزارش‌ها رفتار
 * غیرقابل پیش‌بینی داشتند. همین برای تم و حالت صندوق هم صادق بود.
 */
export const SETTING_RULES: Record<string, (v: string) => boolean> = {
  calendar: (v) => v === 'jalali' || v === 'gregorian',
  cashMode: (v) => v === 'simple' || v === 'accurate',
  theme: (v) => v === 'light' || v === 'vivid' || v === 'dark',
  accent: (v) => ['teal', 'emerald', 'blue', 'indigo', 'violet', 'amber', 'rose', 'slate'].includes(v),
  density: (v) => v === 'comfortable' || v === 'compact',
  fontFamily: (v) => v === 'vazirmatn' || v === 'system',
  corners: (v) => v === 'soft' || v === 'normal' || v === 'sharp',
  defaultCurrency: (v) => v === 'AFN' || v === 'USD',
  tableZebra: (v) => v === '0' || v === '1',
  companyNameInDocs: (v) => v === '0' || v === '1',
  attendanceWorkHours: (v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 24,
  overtimeRate: (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 10,
  usdRate: (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1_000_000,
  usdInProfit: (v) => v === '0' || v === '1',
  backupReminderDays: (v) => Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 365,
};
/** نشانه‌ی «کلید ناشناخته — نادیده بگیر» (نه پیام خطا) */
export const SKIP_UNKNOWN = '__skip_unknown__';
/** آیا مقدار برگشتی از validate پیام خطای واقعی است؟ */
export const isSettingError = (r: string | null): r is string => !!r && r !== SKIP_UNKNOWN;

/** پیشوند سند: ۱ تا ۳ حرف لاتین بزرگ */
const PREFIX_KEYS = ['docPrefixSale', 'docPrefixExpense', 'docPrefixReceipt', 'docPrefixSalary'];

export class SettingsService {
  /**
   * کش تنظیمات در حافظه.
   *
   * باگ کارایی (بازبینی): `get()` هر بار `all()` را صدا می‌زد و `all()` هم
   * اول `ensureDefaults()` (۱۹ درج/به‌روزرسانی) و بعد یک `SELECT` می‌زد.
   * هر ثبت فروش ۲–۳ تنظیم می‌خواند → ۶–۹ رفت‌وبرگشت اضافه برای هر کلیک.
   * حالا یک کش با مهلت ۱۵ ثانیه + پاک‌سازی فوری هنگام `set`.
   */
  private cache: { at: number; data: Record<string, string> } | null = null;
  private static TTL = 15_000;

  clearCache() {
    this.cache = null;
  }

  async ensureDefaults() {
    await ensureSchemaAsync();
    if (this.cache && Date.now() - this.cache.at < SettingsService.TTL) return;
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
    if (this.cache && Date.now() - this.cache.at < SettingsService.TTL) return this.cache.data;
    await this.ensureDefaults();
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "key","value" FROM "Setting"`);
    const out: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const r of rows) out[r.key] = r.value;
    this.cache = { at: Date.now(), data: out };
    return out;
  }

  async get(key: string): Promise<string> {
    const all = await this.all();
    return all[key] ?? '';
  }

  async set(key: string, value: string) {
    await ensureSchemaAsync();
    const err = SettingsService.validate(key, value);
    if (isSettingError(err)) throw new Error(err);
    if (err === SKIP_UNKNOWN) return { ok: true, skipped: true };
    await db().$executeRawUnsafe(
      `INSERT INTO "Setting" ("key","value") VALUES (?,?) ON CONFLICT("key") DO UPDATE SET "value"=excluded."value"`,
      String(key),
      String(value ?? ''),
    );
    this.clearCache();
    return { ok: true };
  }

  /** پیام خطای فارسی برای مقدار نامعتبر، یا null اگر مقدار درست است. */
  static validate(key: string, value: any): string | null {
    const raw = String(value ?? '').trim();
    const rule = SETTING_RULES[key];
    if (rule) return rule(raw) ? null : `مقدار «${raw}» برای تنظیم «${key}» مجاز نیست.`;
    if (PREFIX_KEYS.includes(key)) {
      const ok = /^[A-Za-z]{1,3}$/.test(raw);
      return ok ? null : `پیشوند سند باید ۱ تا ۳ حرف انگلیسی باشد (دریافت‌شده: «${raw}»).`;
    }
    /*
     * کلید ناشناخته: خطا نمی‌دهیم ولی ذخیره هم نمی‌کنیم.
     * چرا خطا نه؟ چون صفحه‌ی تنظیمات کل آبجکت تنظیمات را می‌فرستد؛ اگر در
     * دیتابیس کاربر یک کلید قدیمی/ناشناخته مانده باشد، خطا دادن یعنی «هیچ
     * تنظیماتی ذخیره نشود» — که برای کاربر بدتر از نادیده‌گرفتن است.
     */
    return SKIP_UNKNOWN;
  }

  async setMany(values: Record<string, string>) {
    await ensureSchemaAsync();
    const entries = Object.entries(values || {});
    /*
     * اول همه را اعتبارسنجی کن، بعد ذخیره — وگرنه نیمه‌کاره ذخیره می‌شد
     * (مثلاً calendar درست و theme غلط → فقط اولی ذخیره شود).
     */
    for (const [k, v] of entries) {
      const err = SettingsService.validate(k, v);
      if (isSettingError(err)) throw new Error(err);
    }
    for (const [k, v] of entries) {
      if (SettingsService.validate(k, v) === SKIP_UNKNOWN) continue;
      await this.set(k, v);
    }
    return this.all();
  }

  async calendar(): Promise<CalendarMode> {
    const c = await this.get('calendar');
    return c === 'gregorian' ? 'gregorian' : 'jalali';
  }
}

export const settingsService = new SettingsService();
