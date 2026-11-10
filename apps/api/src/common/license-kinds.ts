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
export const LICENSE_KINDS: { value: LicenseKind; label: string; hint: string }[] = [
  { value: 'monthly', label: 'ماهوار', hint: '۳۰ روز از تاریخ شروع' },
  { value: 'yearly', label: 'سالانه', hint: '۳۶۵ روز از تاریخ شروع' },
  { value: 'perpetual', label: 'ابد (همیشگی)', hint: 'بدون تاریخ پایان — قفل دستگاه همچنان فعال است' },
  { value: 'custom', label: 'دلخواه', hint: 'بازه‌ی تاریخ را خودتان می‌دهید' },
  { value: 'trial', label: 'آزمایشی', hint: '۷ روز — برای تحویل موقت' },
  { value: 'machine', label: 'فقط قفل دستگاه', hint: 'بدون محدودیت زمان؛ فقط به یک دستگاه بسته می‌شود' },
];


/** طول روزهای هر دوره — یک منبع حقیقت برای ابزار لایسنس و سرور. */
export const KIND_DAYS: Record<LicenseKind, number | null> = {
  trial: 7,
  monthly: 30,
  yearly: 365,
  custom: null,
  perpetual: null,
  machine: null,
};
