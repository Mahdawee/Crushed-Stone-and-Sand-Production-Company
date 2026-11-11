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

/**
 * سقف مبلغ/متراژ در یک فیلد.
 *
 * ## باگ (شکار باگ دور ۲۸)
 * `POST /customers` با `openingBalance: 1e308` **پذیرفته** می‌شد. عدد متناهی
 * است (`Number.isFinite` می‌گذرد) ولی SQLite آن را به `Infinity` گرد می‌کرد؛
 * از آن لحظه مانده‌ی آن مشتری `Infinity` می‌شد و **همه‌ی** جمع‌ها و راپورهایی
 * که آن مشتری در آن‌ها بود `Infinity`/`NaN` نشان می‌دادند — و با هیچ
 * ویرایشی هم درست نمی‌شد. همین کلاس خطا در مبلغ رسید/مصرف/معاش هم ممکن بود.
 *
 * سقف ۱٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰ (هزار میلیارد) از هر رقم واقعی این کسب‌وکار
 * بزرگ‌تر است ولی از محدودهٔ دقت امن SQLite/JS بیرون نمی‌رود.
 */
export const MAX_MONEY = 1_000_000_000_000;

/** سقف متراژ/تعداد (یک میلیون متر مکعب در یک سند). */
export const MAX_QUANTITY = 1_000_000;

/** عدد متناهی و در بازه‌ی مجاز؛ وگرنه ۴۰۰ با پیام فارسی. */
export function moneyOrZero(raw: unknown, label: string, max = MAX_MONEY): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new HttpException(`${label} باید عدد باشد.`, 400);
  if (Math.abs(n) > max) throw new HttpException(`${label} از حد مجاز بزرگ‌تر است.`, 400);
  return n;
}

/**
 * شناسه‌ی **اختیاری** از رشته‌ی کوئری (فیلتر فهرست).
 *
 * ## باگ (شکار باگ دور ۲۹)
 * `GET /sales?customerId=abc` مقدار را با `Number()` به `NaN` تبدیل می‌کرد و
 * در SQL `WHERE "customerId" = NaN` **همیشه تهی** بود. نتیجه: فهرست بل‌های
 * فروش خالی نشان داده می‌شد (بدون هیچ خطایی) در حالی که سندها وجود داشتند
 * — یعنی داده «پنهان» می‌شد، نه «فیلتر». همین کلاس در رسیدات هم بود.
 *
 * حالا مقدار نامعتبر **۴۰۰ با پیام فارسی** می‌دهد و مرز «فیلتر غلط» از
 * «نتیجه‌ی خالی» جدا می‌شود.
 */
export function optionalIdQuery(raw: unknown, label = 'شناسه'): number | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new HttpException(`${label} در آدرس معتبر نیست.`, 400);
  }
  return n;
}
