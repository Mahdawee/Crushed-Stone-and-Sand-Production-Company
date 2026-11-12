/**
 * تخصیص FIFO بدهی — پیشنهاد C5، دور ۴۰.
 *
 * این فایل **هیچ import‌ای ندارد** و هیچ‌چیز از دیتابیس نمی‌داند. دلیلش
 * تست‌پذیری است: منطقِ خالص را می‌توان در `node` اجرا کرد (با esbuild
 * فقط نوع‌ها حذف می‌شوند)، در حالی که اگر داخل کنترلر می‌ماند، هر تست
 * باید کل NestJS و دیتابیس را بالا بیاورد.
 *
 * یادآوری از باگ‌های همین دور: هر دو نسخه‌ی غلط **کامپایل** شدند و
 * پاسخ ۲۰۰ دادند؛ خطا فقط در عدد بود. پس عدد باید تست شود.
 */

/** یک بل بدهی: تاریخ فروش و مبلغ آن. */
export interface Bill {
  date: string;
  total: number;
}

/** کمکی — همان قاعده‌ی بقیه‌ی گزارش‌ها: عدد نامعتبر = ۰. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * کدام بل واقعاً **باز** است؟ (تخصیص FIFO)
 *
 * ── دو باگ که همین تابع گرفت ─────────────────────────────────────────────
 * نسخه‌ی اولم `oldest` را در هر تکرار حلقه می‌نوشت، پس **تازه‌ترین** بل
 * می‌ماند. بعد «اصلاحش» کردم که بل اول را بردارد — و آن هم غلط بود:
 * مشتری ۱۰٠٠٠ از ۲۰۶ روز پیش و ۵٠٠٠ از ۴۵ روز پیش بدهکار بود؛ با پرداخت
 * ۱۰٠٠٠، بل قدیمی **تسویه** شده ولی سند هنوز «۲۰۶ روز» می‌گفت.
 *
 * قاعده‌ی درست: پرداخت‌ها روی **قدیمی‌ترین** بل می‌نشینند. پس باید
 * دنبال اولین بلی گشت که پرداخت‌ها آن را کامل نپوشانده‌اند.
 *
 * `openingBalance` (مانده‌ی قبلی) از همه قدیمی‌تر است و تاریخ ندارد؛
 * اگر باز بماند، `fromOpening` می‌شود تا رابط صادقانه «مانده‌ی قبلی»
 * بنویسد، نه یک تاریخ ساختگی.
 */
export function oldestOpenBill(
  opening: number,
  sales: readonly Bill[],
  paid: number,
): { date: string; fromOpening: boolean } {
  let pool = paid;
  /* مانده‌ی قبلی، قدیمی‌ترینِ همه — اول او */
  if (opening > 0.0001) {
    const applied = Math.min(pool, opening);
    pool -= applied;
    if (opening - applied > 0.0001) return { date: '', fromOpening: true };
  }
  for (const s of sales) {
    const amt = num(s.total);
    if (amt <= 0) continue;
    const applied = Math.min(pool, amt);
    pool -= applied;
    if (amt - applied > 0.0001) return { date: String(s.date || ''), fromOpening: false };
  }
  /* همه‌ی بل‌ها پوشش داده شده — مانده نباید مثبت باشد؛ محافظ */
  return { date: String(sales[sales.length - 1]?.date || ''), fromOpening: false };
}

