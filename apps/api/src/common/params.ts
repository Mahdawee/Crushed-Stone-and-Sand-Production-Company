import { HttpException } from '@nestjs/common';

/**
 * شناسه‌ی مسیر (`:id`) را به عدد سالم تبدیل می‌کند.
 *
 * ## باگی که این تابع می‌بندد
 * مسیر `GET /sales/abc` مقدار `abc` را به `Number()` می‌داد → `NaN` →
 * `WHERE "id" = NaN` → نتیجه‌ی خالی → پاسخ **۴۰۴ «بل فروش پیدا نشد»**.
 * کاربر آدرس یک بل موجود را با یک حرف اضافه باز می‌کرد و پیام «وجود ندارد»
 * می‌گرفت؛ و در آپدیت، `SET ... WHERE id=NaN` بی‌صدا هیچ ردیفی را عوض
 * نمی‌کرد ولی پاسخ «ذخیره شد» می‌داد.
 *
 * حالا هر شناسه‌ی نامعتبر **۴۰۰ با پیام فارسی** می‌دهد، یعنی مرزِ خطا
 * («آنچه فرستادی غلط است») از مرزِ نبودِ داده («چیزی با این شناسه نیست»)
 * جدا می‌شود.
 */
export function idParam(raw: unknown, label = 'شناسه'): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new HttpException(`${label} نامعتبر است.`, 400);
  }
  return n;
}

/**
 * عدد صحیح مثبتِ اختیاری (برای فیلدهای فرم مثل `customerId`).
 * خروجی عدد یا `null`؛ اگر مقدار داده شده ولی نامعتبر باشد ۴۰۰ می‌دهد.
 */
export function optionalId(raw: unknown, label = 'شناسه'): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new HttpException(`${label} نامعتبر است.`, 400);
  return Math.trunc(n);
}
