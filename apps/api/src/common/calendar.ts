/**
 * Calendar helpers — all dates are stored as Gregorian "YYYY-MM-DD" strings;
 * everything the user sees (input, lists, monthly / yearly reports) follows
 * the calendar chosen in Settings:  "jalali"  or  "gregorian".
 */
import * as jalaali from 'jalaali-js';

export type CalendarMode = 'jalali' | 'gregorian';

const JALALI_MONTHS = [
  'حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله',
  'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت',
];
const GREGORIAN_MONTHS = [
  'جنوری', 'فبروری', 'مارچ', 'اپریل', 'می', 'جون',
  'جولای', 'آگست', 'سپتمبر', 'اکتوبر', 'نومبر', 'دسمبر',
];

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const iso = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
export const toDariDigits = (s: string | number) =>
  String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
export const fromDariDigits = (s: string) =>
  String(s ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** Today in Gregorian ISO (local clock, not UTC). */
export function todayISO(): string {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function splitISO(isoStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = String(isoStr).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

export function isValidISO(isoStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoStr))) return false;
  const { y, m, d } = splitISO(isoStr);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Gregorian ISO → {y,m,d} in the requested calendar. */
export function toCalendar(isoStr: string, mode: CalendarMode) {
  const { y, m, d } = splitISO(isoStr);
  return mode === 'jalali' ? jalaali.toJalaali(y, m, d) : { jy: y, jm: m, jd: d };
}

/** Calendar date → Gregorian ISO. */
export function fromCalendar(y: number, m: number, d: number, mode: CalendarMode): string {
  if (mode === 'jalali') {
    const g = jalaali.toGregorian(y, m, d);
    return iso(g.gy, g.gm, g.gd);
  }
  return iso(y, m, d);
}

export function monthName(m: number, mode: CalendarMode): string {
  return (mode === 'jalali' ? JALALI_MONTHS : GREGORIAN_MONTHS)[m - 1] ?? '';
}

export function formatDate(isoStr: string, mode: CalendarMode, withMonthName = false): string {
  if (!isoStr || !isValidISO(isoStr)) return '';
  const c = toCalendar(isoStr, mode);
  const y = mode === 'jalali' ? c.jy : c.jy;
  const m = mode === 'jalali' ? c.jm : c.jm;
  const d = mode === 'jalali' ? c.jd : c.jd;
  if (withMonthName) return `${d} ${monthName(m, mode)} ${y}`;
  return `${y}/${pad2(m)}/${pad2(d)}`;
}

/**
 * Number of days in a calendar month — the single source of truth.
 *
 * Bug this fixes: `yearBucket`/`yearly` ended the year on the 29th of Esfand
 * unconditionally, so a leap year (Esfand 30) silently dropped every document
 * dated 1403/12/30 from year reports, and 31-day Gregorian months were cut short.
 */
export function monthLength(y: number, m: number, mode: CalendarMode): number {
  if (mode === 'jalali') return jalaali.jalaaliMonthLength(y, m);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * "Bucket" of a date in the active calendar → used for month & year reports.
 * Returns { year, month, start, end } where start/end are Gregorian ISO bounds.
 */
export function monthBucket(isoStr: string, mode: CalendarMode) {
  const c = toCalendar(isoStr, mode);
  const y = mode === 'jalali' ? c.jy : c.jy;
  const m = mode === 'jalali' ? c.jm : c.jm;
  const first = fromCalendar(y, m, 1, mode);
  const daysInMonth = mode === 'jalali' ? jalaali.jalaaliMonthLength(y, m) : new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = fromCalendar(y, m, daysInMonth, mode);
  return { year: y, month: m, start: first, end: last, label: `${monthName(m, mode)} ${y}` };
}

export function yearBucket(isoStr: string, mode: CalendarMode) {
  const c = toCalendar(isoStr, mode);
  const y = c.jy;
  const start = fromCalendar(y, 1, 1, mode);
  /* آخرین روز واقعی سال (اسفند ۲۹ یا ۳۰، دسمبر ۳۱) */
  const end = fromCalendar(y, 12, monthLength(y, 12, mode), mode);
  return { year: y, start, end };
}

/** First day of the current month in the active calendar (Gregorian ISO). */
export function startOfMonth(today: string, mode: CalendarMode) {
  const b = monthBucket(today, mode);
  return b.start;
}
export function endOfMonth(today: string, mode: CalendarMode) {
  return monthBucket(today, mode).end;
}
export function startOfYear(today: string, mode: CalendarMode) {
  return yearBucket(today, mode).start;
}
export function endOfYear(today: string, mode: CalendarMode) {
  return yearBucket(today, mode).end;
}

/** Add n days to a Gregorian ISO string. */
export function addDays(isoStr: string, n: number): string {
  const { y, m, d } = splitISO(isoStr);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Hard limit for a single report range — guards against a typo like 2000→2030. */
export const MAX_RANGE_DAYS = 400;

/**
 * Validate a user-picked range. Returns the inclusive day count, throws a
 * Persian error when the range is reversed or too long.
 */
export function assertRange(fromISO: string, toISO: string): number {
  if (!isValidISO(fromISO) || !isValidISO(toISO)) throw new Error('تاریخ‌های بازه درست نیستند.');
  if (fromISO > toISO) throw new Error('«از تاریخ» بعد از «تا تاریخ» است.');
  const days = Math.round(
    (Date.parse(toISO + 'T00:00:00Z') - Date.parse(fromISO + 'T00:00:00Z')) / 86400000,
  ) + 1;
  if (days > MAX_RANGE_DAYS) throw new Error(`بازه حداکثر ${MAX_RANGE_DAYS} روز می‌تواند باشد (الان ${days} روز).`);
  return days;
}

/** All calendar days between two ISO dates (inclusive) as Gregorian ISO strings. */
export function daysBetween(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  let cur = startISO;
  let guard = 0;
  while (cur <= endISO && guard++ < MAX_RANGE_DAYS) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * Parse a user-entered date into a Gregorian ISO string.
 *
 * IMPORTANT: a bare "YYYY-MM-DD" is ALWAYS Gregorian — that is how the UI and
 * other API clients hand dates over. A date with slashes ("۱۴۰۵/۰۸/۱۹" or
 * "1405/08/19") is read in the calendar the user has chosen (jalali/gregorian).
 *
 * The old version treated an ISO string as if it were in the active calendar,
 * so with the Jalali calendar on, storing "2026-11-10" ended up as year ۲۰۲۶
 * هجری شمسی (doc numbers like S-2026-0001) or, in lists, re-interpreting
 * already-Gregorian values as Jalali and shifting every filter by ~۶۲۱ سال.
 */
export function parseUserDate(input: string, mode: CalendarMode): string {
  const raw = fromDariDigits(String(input ?? '').trim());
  if (!raw) throw new Error('تاریخ را وارد کنید.');

  // already Gregorian ISO (what the UI sends)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (!isValidISO(raw)) throw new Error('تاریخ میلادی درست نیست.');
    return raw;
  }

  const m = raw.match(/^(\d{3,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) throw new Error('تاریخ درست نیست. نمونه درست: ۱۴۰۵/۰۸/۱۹');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];

  if (mode === 'jalali') {
    if (!jalaali.isValidJalaaliDate(y, mo, d)) throw new Error('تاریخ شمسی درست نیست.');
    return fromCalendar(y, mo, d, 'jalali');
  }
  const candidate = iso(y, mo, d);
  if (!isValidISO(candidate)) throw new Error('تاریخ میلادی درست نیست.');
  return candidate;
}

/** Gregorian ISO → the "YYYY-MM-DD" / "YYYY/MM/DD" shape of the active calendar. */
export function parseInputDateSafe(input: string, mode: CalendarMode): string | null {
  try { return parseUserDate(input, mode); } catch { return null; }
}

/** Fiscal-year label shown everywhere, e.g. "۱۴۰۴–۱۴۰۵". */
export function fiscalLabel(mode: CalendarMode, dateISO = todayISO()) {
  const y = toCalendar(dateISO, mode).jy;
  return mode === 'jalali' ? `${y}` : `${y}`;
}
