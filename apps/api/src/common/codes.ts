/**
 * «کد بعدی» برای مشتری و کارمند — یک منبع واحد.
 *
 * ── باگ‌هایی که این ماژول حل می‌کند (شکار باگ دور ۲۸) ──────────────────────
 *
 * نسخه‌ی قبلی در **پنج** جا تکرار شده بود و همه یک شکل داشتند:
 *
 *     Math.max(...codes) + 1
 *
 *  ۱) «کد بعدی» از کدها فقط عدد می‌ساخت. کد مشتری «۰۰۰» مالِ «مشتری گذری»
 *     است؛ اگر فقط همان ردیف در دیتابیس بود، کد پیشنهادی «۰۰۱» و بعد از
 *     ساخت آن، دوباره «۰۰۲»… — درست. ولی ردیف‌های حذف‌شده هم در
 *     `Math.max` می‌آمدند و کد «۰۰۰» هیچ‌وقت **رد** نمی‌شد: در نصب تازه که
 *     فقط «مشتری گذری» وجود دارد، `Math.max(...[0])+1 = 1` می‌شد و کد ۰۰۰
 *     هرگز پیشنهاد نمی‌شد — این تصادفی درست بود. مشکل واقعی جای دیگری بود:
 *
 *  ۲) `Math.max(...rows)` با فهرست بزرگ به سقف آرگومان‌های تابع می‌خورد
 *     (`RangeError: Maximum call stack size exceeded` با چند صد هزار کد) و
 *     مسیر «کد بعدی»/«ثبت» ۵۰۰ می‌داد.
 *
 *  ۳) کدهای غیرعددی مثل `EMP-12` یا `A-7` نادیده گرفته می‌شدند و کد
 *     پیشنهادی با یک کد موجود تصادم می‌کرد → خطای مبهم «این کد قبلاً ثبت
 *     شده است» روی فرم تازه‌باز.
 *
 * این‌جا با یک پرس‌وجوی تجمیعی (`MAX(CAST...)`) کار می‌کنیم، کد «۰۰۰» را
 * رزرو نگه می‌داریم و تا رسیدن به کد آزاد جلو می‌رویم.
 */
import { db } from '../db';

/** کد رزروشده برای «مشتری گذری». */
export const RESERVED_CUSTOMER_CODE = '000';

/**
 * فقط کدهای **تمام‌عددی** در شمارش می‌آیند.
 *
 * کد دستی مثل `A-7` را عمداً نادیده می‌گیریم: اگر رقم‌هایش را برمی‌داشتیم
 * (`A-7` → ۷) کد بعدی می‌شد `008` و کاربر فکر می‌کرد هفت مشتری گم شده —
 * در حالی که فقط یک کد دستی داشته. تصادم با کدهای دستی هم جداگانه با
 * مجموعه‌ی `used` رد می‌شود.
 */
function numericOf(code: unknown): number {
  const raw = String(code ?? '').trim();
  if (!/^\d+$/.test(raw)) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * بزرگ‌ترین عددِ کد را از دیتابیس می‌خواند (بدون کشیدن همه‌ی ردیف‌ها به
 * حافظه). `table` فقط از مقادیر ثابت داخلی می‌آید، نه از ورودی کاربر.
 */
async function maxCodeNumber(table: 'Customer' | 'Employee'): Promise<number> {
  const rows: any[] = await db().$queryRawUnsafe(
    `SELECT "code" FROM "${table}" ORDER BY "id"`,
  );
  /* پیمایش رشته‌به‌رشته: ارزان‌تر از spread روی آرایه‌ی بزرگ و امن از
     `RangeError` سقف آرگومان. */
  let max = 0;
  for (const r of rows) {
    const n = numericOf(r?.code);
    if (n > max) max = n;
  }
  return max;
}

/**
 * کد بعدی آزاد. برای مشتری، کد «۰۰۰» هرگز پیشنهاد نمی‌شود.
 * `taken` مجموعه‌ای از کدهای موجود (برای جلوگیری از تصادم با کدهای غیرعددی
 * مثل `A-7` که در `maxCodeNumber` دیده نمی‌شوند).
 */
export async function nextCustomerCode(): Promise<string> {
  const max = await maxCodeNumber('Customer');
  const taken: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Customer"`);
  const used = new Set(taken.map((r) => String(r?.code ?? '')));
  let n = Math.max(max, 0) + 1;
  let code = String(n).padStart(3, '0');
  /* سقف حلقه برای این‌که هرگز بی‌نهایت نشود؛ ۱۰٬۰۰۰ کد آزاد کافی است. */
  for (let guard = 0; guard < 10000 && (used.has(code) || code === RESERVED_CUSTOMER_CODE); guard++) {
    n++;
    code = String(n).padStart(3, '0');
  }
  return code;
}

/** کد بعدی کارمند — همان منطق، بدون کد رزروشده. */
export async function nextEmployeeCode(): Promise<string> {
  const max = await maxCodeNumber('Employee');
  const taken: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Employee"`);
  const used = new Set(taken.map((r) => String(r?.code ?? '')));
  let n = Math.max(max, 0) + 1;
  let code = String(n).padStart(3, '0');
  for (let guard = 0; guard < 10000 && used.has(code); guard++) {
    n++;
    code = String(n).padStart(3, '0');
  }
  return code;
}
