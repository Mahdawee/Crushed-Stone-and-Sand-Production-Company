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
  const end = fromCalendar(y, 12, mode === 'jalali' ? 29 : 31, mode);
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

/** All calendar days between two ISO dates (inclusive) as Gregorian ISO strings. */
export function daysBetween(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  let cur = startISO;
  let guard = 0;
  while (cur <= endISO && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * Parse a user-entered date. Accepts Dari/Arabic digits ("۱۴۰۴/۰۵/۱۲",
 * "1404-5-12") and normalises it into a Gregorian ISO string using the
 * active calendar. Throws a friendly Persian error on bad input.
 */
export function parseUserDate(input: string, mode: CalendarMode): string {
  const raw = fromDariDigits(String(input ?? '').trim());
  const m = raw.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) {
    if (isValidISO(raw)) return raw;
    throw new Error('تاریخ درست نیست. نمونه درست: ۱۴۰۴/۰۵/۱۲');
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mode === 'jalali') {
    if (!jalaali.isValidJalaaliDate(y, mo, d)) throw new Error('تاریخ شمسی درست نیست.');
    return fromCalendar(y, mo, d, 'jalali');
  }
  const candidate = iso(y, mo, d);
  if (!isValidISO(candidate)) throw new Error('تاریخ میلادی درست نیست.');
  return candidate;
}

/** Fiscal-year label shown everywhere, e.g. "۱۴۰۴–۱۴۰۵". */
export function fiscalLabel(mode: CalendarMode, dateISO = todayISO()) {
  const y = toCalendar(dateISO, mode).jy;
  return mode === 'jalali' ? `${y}` : `${y}`;
}
