/**
 * داده‌ی گونه‌های لایسنس — بدون crypto و بدون Nest، تا هم ابزار لایسنس و
 * هم API بتوانند از یک منبع استفاده کنند.
 */
/** دوره‌های پشتیبانی‌شده — همان چیزی که در ابزار لایسنس انتخاب می‌شود. */
export type LicenseKind = 'trial' | 'monthly' | 'yearly' | 'perpetual' | 'custom' | 'machine';

export type LicensePayload = {
  v: 1;
  id: string;
  customer: string;
  kind: LicenseKind;
  start: string;
  end: string | null;
  machineKey: string;
  seats: number;
  note: string;
  issuedAt: string;
};
/**
 * دوره‌های پشتیبانی‌شده.
 *
 * ## چرا دو گزینه یکی شدند (درخواست کاربر)
 * قبلاً «ابد (همیشگی)» و «فقط قفل دستگاه» هر دو «بدون تاریخ پایان» بودند و
 * هر دو دستگاه را قفل می‌کردند؛ یعنی **دقیقاً یک چیز** با دو نام. کاربر حق
 * داشت بگوید چرا دو گزینه‌ی عین‌هم؟ حالا فقط یکی مانده: **ابد (همیشگی)** —
 * بدون پایان، ولی با قفل دستگاه (همان چیزی که از قبل هر دو انجام می‌دادند).
 *
 * لایسنس‌های قدیمی با `kind: 'machine'` هنوز معتبرند و همان‌طور نمایش داده
 * می‌شوند (`ماشین`)، ولی گزینه‌ی صدور تازه‌ای برایشان وجود ندارد.
 */
export const LICENSE_KINDS: { value: LicenseKind; label: string; hint: string; days: number | null }[] = [
  { value: 'trial', label: 'آزمایشی', hint: '۷ روز از امروز تا ۷ روز', days: 7 },
  { value: 'monthly', label: 'ماهوار', hint: '۳۰ روز از امروز', days: 30 },
  { value: 'yearly', label: 'سالانه', hint: '۳۶۵ روز از امروز', days: 365 },
  { value: 'perpetual', label: 'ابد (همیشگی)', hint: 'بدون تاریخ پایان — قفل دستگاه فعال می‌ماند', days: null },
  { value: 'custom', label: 'دلخواه', hint: 'تاریخ شروع و پایان را خودتان می‌دهید', days: null },
  /* فقط برای خواندن لایسنس‌های قدیمی — در فهرست انتخاب ابزار نمی‌آید */
  { value: 'machine', label: 'ماشین (قدیمی)', hint: 'همان «ابد»؛ فقط برای لایسنس‌های صادرشده‌ی قدیمی', days: null },
];

/** گزینه‌هایی که ابزار لایسنس برای **صدور تازه** نشان می‌دهد */
export const ISSUABLE_KINDS: LicenseKind[] = ['trial', 'monthly', 'yearly', 'perpetual', 'custom'];

/** طول روزهای هر دوره — یک منبع حقیقت برای ابزار لایسنس و سرور. */
export const KIND_DAYS: Record<LicenseKind, number | null> = {
  trial: 7,
  monthly: 30,
  yearly: 365,
  custom: null,
  perpetual: null,
  machine: null,
};
