/** Calendar helpers used by the UI (mirror of the API rules). */
import * as jalaali from 'jalaali-js';

export type CalendarMode = 'jalali' | 'gregorian';

const JALALI_MONTHS = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت'];
const GREGORIAN_MONTHS = ['جنوری', 'فبروری', 'مارچ', 'اپریل', 'می', 'جون', 'جولای', 'آگست', 'سپتمبر', 'اکتوبر', 'نومبر', 'دسمبر'];

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const monthName = (m: number, mode: CalendarMode) => (mode === 'jalali' ? JALALI_MONTHS : GREGORIAN_MONTHS)[m - 1] || '';
export const months = (mode: CalendarMode) => (mode === 'jalali' ? JALALI_MONTHS : GREGORIAN_MONTHS);

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function toCalendar(isoStr: string, mode: CalendarMode) {
  const [y, m, d] = String(isoStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return { jy: 0, jm: 0, jd: 0 };
  return mode === 'jalali' ? jalaali.toJalaali(y, m, d) : { jy: y, jm: m, jd: d };
}

export function fromCalendar(y: number, m: number, d: number, mode: CalendarMode): string {
  if (mode === 'jalali') {
    const g = jalaali.toGregorian(y, m, d);
    return `${g.gy}-${pad2(g.gm)}-${pad2(g.gd)}`;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function formatDate(isoStr: string, mode: CalendarMode, withMonthName = false): string {
  if (!isoStr || String(isoStr).length < 10) return '';
  const c = toCalendar(isoStr, mode);
  if (!c.jy) return '';
  if (withMonthName) return `${c.jd} ${monthName(c.jm, mode)} ${c.jy}`;
  return `${c.jy}/${pad2(c.jm)}/${pad2(c.jd)}`;
}

/** Value shown inside <input> when the active calendar is Jalali/Gregorian. */
export function toInputDate(isoStr: string, mode: CalendarMode): string {
  if (!isoStr) return '';
  const c = toCalendar(isoStr, mode);
  return c.jy ? `${c.jy}/${pad2(c.jm)}/${pad2(c.jd)}` : '';
}

/**
 * Parse "1404/05/12" (Dari digits allowed) into a Gregorian ISO string.
 *
 * ── باگ (شکار باگ دور ۳۴) ──────────────────────────────────────────────────
 * فقط جداکننده تعیین می‌کرد تاریخ شمسی است یا میلادی. با تقویم شمسی، تایپ
 * «2026/11/10» سال ۲۰۲۶ **هجری** حساب می‌شد و سند ۶۲۱ سال جلو می‌افتاد
 * (بی‌هیچ خطایی، سند هم از فهرست ماه بیرون می‌رفت). برعکسش هم: با تقویم
 * میلادی، «1405/08/19» سال ۱۴۰۵ میلادی می‌شد.
 * حالا **بازه‌ی سال** تعیین‌کننده است: ۱۰۰۰–۱۷۰۰ شمسی، بالاتر میلادی — همان
 * قاعده‌ی سرور (`common/calendar.ts`) تا هر دو طرف یک چیز بگویند.
 */
export function parseInputDate(input: string, mode: CalendarMode): string {
  const raw = String(input || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).trim();
  const m = raw.match(/^(\d{3,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const y0 = Number(raw.slice(0, 4));
      /* «YYYY-MM-DD» با سال شمسی (۱۴۰۵…) هم همان تاریخ شمسی است */
      if (y0 >= 1000 && y0 <= 1700) {
        const jm = Number(raw.slice(5, 7));
        const jd = Number(raw.slice(8, 10));
        if (jalaali.isValidJalaaliDate(y0, jm, jd)) return fromCalendar(y0, jm, jd, 'jalali');
      }
      return raw;
    }
    throw new Error('تاریخ درست نیست — نمونه: ۱۴۰۴/۰۵/۱۲');
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const readJalali = () => {
    if (!jalaali.isValidJalaaliDate(y, mo, d)) throw new Error('تاریخ شمسی درست نیست.');
    return fromCalendar(y, mo, d, 'jalali');
  };
  const readGregorian = () => {
    const date = `${y}-${pad2(mo)}-${pad2(d)}`;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
      throw new Error('تاریخ میلادی درست نیست.');
    }
    return date;
  };
  if (y >= 1000 && y <= 1700) return readJalali();
  if (y >= 1700) return readGregorian();
  return mode === 'jalali' ? readJalali() : readGregorian();
}

/**
 * تعداد روزهای یک ماه تقویمی.
 *
 * مقاوم‌سازی: اگر سال/ماه نامعتبر باشد (رشته‌ی خالی، NaN، ماه ۱۳)، قبلاً
 * `jalaali.jalaaliMonthLength` استثنا می‌داد و — چون این تابع در رندر تقویم
 * صدا زده می‌شود — کل صفحه سفید می‌شد. حالا همیشه یک عدد معتبر برمی‌گردد.
 */
export function monthLength(y: number, m: number, mode: CalendarMode) {
  const yy = Number.isFinite(y) ? Math.trunc(y) : currentYearSafe(mode);
  const mm = Number.isFinite(m) ? Math.trunc(m) : 1;
  const month = Math.min(12, Math.max(1, mm));
  if (mode === 'jalali') {
    try { return jalaali.jalaaliMonthLength(yy, month); } catch { return month <= 6 ? 31 : month <= 11 ? 30 : 29; }
  }
  return new Date(Date.UTC(yy, month, 0)).getUTCDate();
}
/** سال جاری، بدون وابستگی به ترتیب تعریف توابع بالای فایل. */
function currentYearSafe(mode: CalendarMode) {
  try { return toCalendar(todayISO(), mode).jy; } catch { return new Date().getFullYear(); }
}

export function currentYear(mode: CalendarMode) {
  return toCalendar(todayISO(), mode).jy;
}
export function currentMonth(mode: CalendarMode) {
  return toCalendar(todayISO(), mode).jm;
}
export function monthKey(mode: CalendarMode) {
  const c = toCalendar(todayISO(), mode);
  return `${c.jy}-${pad2(c.jm)}`;
}
export function startOfMonthISO(mode: CalendarMode) {
  const c = toCalendar(todayISO(), mode);
  return fromCalendar(c.jy, c.jm, 1, mode);
}

/** Persian/Arabic digits → latin (for numbers typed on a Persian keyboard). */
export const normalizeDigits = (s: string) =>
  String(s ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

export const num = (v: any): number => {
  const n = Number(normalizeDigits(String(v ?? '')).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export const money = (v: any): string => {
  const n = Number(v) || 0;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

/* =========================== date picker helpers ========================= */

/** ابتدای هفته در افغانستان: شنبه */
export const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
export const WEEKDAYS_FULL = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

/** شماره ستون روز در هفته (۰ = شنبه) برای یک تاریخ تقویمی. */
export function weekdayIndex(y: number, m: number, d: number, mode: CalendarMode): number {
  const isoStr = fromCalendar(y, m, d, mode);
  const [gy, gm, gd] = isoStr.split('-').map(Number);
  return (new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay() + 1) % 7;
}

export const daysInMonth = (y: number, m: number, mode: CalendarMode) => monthLength(y, m, mode);

/** ساخت شبکه ماه برای تقویم: null = خانه خالی قبل از روز اول. */
export function monthGrid(y: number, m: number, mode: CalendarMode): (number | null)[] {
  const pad = weekdayIndex(y, m, 1, mode);
  const len = monthLength(y, m, mode);
  const cells: (number | null)[] = Array(pad).fill(null);
  for (let d = 1; d <= len; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  let nm = m + delta;
  let ny = y;
  while (nm < 1) { nm += 12; ny -= 1; }
  while (nm > 12) { nm -= 12; ny += 1; }
  return { y: ny, m: nm };
}

/** افزودن/کاستن روز از یک تاریخ ISO میلادی. */
export function addDaysISO(isoStr: string, n: number): string {
  const [y, m, d] = String(isoStr).slice(0, 10).split('-').map(Number);
  /* ورودی نامعتبر → «امروز»، نه `NaN-NaN-NaN` که تقویم را سفید می‌کند */
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return todayISO();
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  if (Number.isNaN(dt.getTime())) return todayISO();
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** «امروز» به صورت ISO میلادی. */
export const todayISOValue = () => todayISO();

/**
 * ورودی کاربر را بدون خطا به ISO میلادی تبدیل می‌کند.
 * «1405/08/19» یا «۱۴۰۵/۸/۱۹» یا «2026-11-10» — در صورت نامعتبر بودن '' برمی‌گرداند.
 */
export function parseLoose(input: string, mode: CalendarMode): string {
  const normalized = normalizeDigits(String(input ?? '')).replace(/\s/g, '');
  if (!normalized) return '';

  /* «YYYY-MM-DD» همیشه میلادی است — همان چیزی که در دیتابیس ذخیره می‌شود */
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]), mo = Number(isoMatch[2]), d = Number(isoMatch[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
    return ok ? `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}` : '';
  }

  const raw = normalized.replace(/[.\-]/g, '/');
  const m = raw.match(/^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) return '';
  if (d < 1 || d > monthLength(y, mo, mode)) return '';
  return fromCalendar(y, mo, d, mode);
}

/** تاریخ نسبی خوانا: «۳ روز پیش» / «فردا» / «امروز» */
export function relativeDay(isoStr: string): string {
  if (!isoStr) return '';
  const diff = Math.round((Date.parse(isoStr.slice(0, 10)) - Date.parse(todayISO())) / 86400000);
  if (diff === 0) return 'امروز';
  if (diff === 1) return 'فردا';
  if (diff === -1) return 'دیروز';
  if (diff > 1) return `${diff} روز بعد`;
  return `${-diff} روز پیش`;
}
