/**
 * دادهٔ مشترک ابزار لایسنس (سرور و کلاینت) — بدون crypto/fs تا در مرورگر هم
 * قابل استفاده باشد.
 */
export type LicenseKind = 'trial' | 'monthly' | 'yearly' | 'perpetual' | 'custom' | 'machine';

/**
 * نوع‌های دوره — همان فهرستی که API هم می‌شناسد.
 *
 * «ابد» و «فقط قفل دستگاه» یکی شدند (درخواست کاربر: «فکر می‌کنم عین هم است»)
 * و «ماشین» فقط برای خواندن لایسنس‌های قدیمی مانده است.
 */
export const LICENSE_KINDS = [
  { value: 'trial' as LicenseKind, label: 'آزمایشی', days: 7, hint: 'امروز تا ۷ روز (پایان = امروز + ۶)' },
  { value: 'monthly' as LicenseKind, label: 'ماهوار', days: 30, hint: 'امروز تا ۳۰ روز' },
  { value: 'yearly' as LicenseKind, label: 'سالانه', days: 365, hint: 'امروز تا ۳۶۵ روز' },
  { value: 'perpetual' as LicenseKind, label: 'ابد (همیشگی)', days: null, hint: 'بدون تاریخ پایان — قفل دستگاه فعال می‌ماند' },
  { value: 'custom' as LicenseKind, label: 'دلخواه', days: null, hint: 'تاریخ شروع و پایان را خودتان می‌دهید' },
  { value: 'machine' as LicenseKind, label: 'ماشین (قدیمی)', days: null, hint: 'همان «ابد»؛ فقط برای لایسنس‌های قدیمی' },
];

/** نوع‌هایی که برای **صدور تازه** پیشنهاد می‌شوند (بدون «ماشین» قدیمی) */
export const ISSUABLE_KINDS: LicenseKind[] = ['trial', 'monthly', 'yearly', 'perpetual', 'custom'];

export const KIND_DAYS: Record<LicenseKind, number | null> = {
  trial: 7, monthly: 30, yearly: 365, custom: null, perpetual: null, machine: null,
};

export const kindLabel = (k: string) => LICENSE_KINDS.find((x) => x.value === k)?.label || k;

/* ---------------- تاریخ شمسی (برای نمایش در ابزار) ---------------- */
const JALALI_MONTHS = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت'];
const toDari = (s: string | number) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const fromDari = (s: string) => String(s ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/** میلادی ISO → «۱۹ عقرب ۱۴۰۵» */
export function jalaliLabel(iso: string, dari = true): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jalaali = require('jalaali-js');
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const j = jalaali.toJalaali(y, m, d);
    const label = `${j.jd} ${JALALI_MONTHS[j.jm - 1]} ${j.jy}`;
    return dari ? toDari(label) : label;
  } catch {
    return iso;
  }
}

/** ورودی تاریخ (شمسی/میلادی) → میلادی ISO. برای فرم ابزار. */
export function parseDateToISO(input: string): string {
  const raw = fromDari(String(input || '').trim());
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = /^(\d{3,4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(raw);
  if (!m) throw new Error(`تاریخ درست نیست («${input}»). نمونه: ۱۴۰۵/۰۸/۱۹ یا 2026-11-10`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y >= 1300 && y <= 1500) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jalaali = require('jalaali-js');
    if (!jalaali.isValidJalaaliDate(y, mo, d)) throw new Error(`تاریخ شمسی درست نیست («${input}»).`);
    const g = jalaali.toGregorian(y, mo, d);
    return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * بازه‌ی پیش‌فرض هر نوع دوره — «تاریخ شروع همیشه امروز».
 *
 * ## دو باگ که این تابع می‌بندد
 * ۱) تاریخ شروع در فورم به‌صورت شمسی ساخته می‌شد با یک محاسبه‌ی تقریبی غلط
 *    (`سال/01/01` — همیشه اول حمل!). کاربر «تاریخ شروع» را می‌دید که هیچ
 *    ربطی به امروز نداشت و اگر همان را می‌فرستاد، لایسنس هشت‌ماه جلوتر
 *    شروع می‌شد و روی دستگاه مشتری «معتبر نیست» می‌داد.
 * ۲) با عوض‌کردن نوع دوره، تاریخ **پایان** دوباره حساب نمی‌شد؛ اگر قبلاً
 *    «دلخواه» انتخاب شده بود و پایان دستی داشت، با انتخاب «آزمایشی» همان
 *    تاریخِ دلخواه می‌ماند. حالا هر تغییر نوع، بازه را از امروز می‌سازد.
 *
 * قاعده: «آزمایشی/ماهوار/سالانه» = از امروز تا (امروز + روزها − ۱)، پس
 * «آزمایشی» یعنی امروز تا ۷ روز (۶ روز بعد). «ابد» پایان ندارد و «دلخواه»
 * دست کاربر است.
 */
export function defaultRange(kind: LicenseKind, start: string): { start: string; end: string | null } {
  const days = KIND_DAYS[kind];
  return days == null ? { start, end: null } : { start, end: addDaysISO(start, days - 1) };
}

/** آخرین روز شمسی یک تاریخ ISO — «۱۴۰۵/۰۸/۱۹» (پیش‌فرض فورم) */
export function jalaliISOInput(iso: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jalaali = require('jalaali-js');
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const j = jalaali.toJalaali(y, m, d);
    return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}
