import { Controller, Get, Query } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';

/**
 * جست‌وجوی سراسری (پیشنهاد C1، دور ۴۰).
 *
 * ── چرا یک مسیر تازه، به‌جای اینکه فرانت از فهرست‌ها استفاده کند ────────
 * کاربری که اسم مشتری را نیمه‌کاره در ذهن دارد باید بتواند **از هر صفحه‌ای**
 * پیدا کند، نه اینکه اول به فهرست مشتریان برود و آن‌جا جست‌وجو کند. و برای
 * پیدا کردن «رسید ۱۰۴۲» یا «بل ۲۱۹» لازم است همه‌ی اسناد با هم دیده شوند.
 *
 * ── قاعده‌ها ──────────────────────────────────────────────────────────────
 *   • حداکثر ۸ نتیجه **از هر نوع**؛ بیشتر از این در یک منوی بازشو خوانده
 *     نمی‌شود و فقط کوئری را کند می‌کند.
 *   • اسناد حذف‌نرم‌شده هرگز برنمی‌گردند (وگرنه کاربر چیزی می‌بیند که
 *     در فهرست نیست و فکر می‌کند برنامه خراب است).
 *   • همه‌ی مقادیر پارامتر bind می‌شوند؛ هیچ رشته‌ای در SQL نمی‌چسبد.
 *   • `%` و `_` در ورودی کاربر هویتِ خودشان را از دست می‌دهند، وگرنه یک
 *     `%` تنها همه‌ی ردیف‌ها را برمی‌گرداند.
 *   • جست‌وجوی خالی یا یک‌حرفی → نتیجه‌ی خالی (نه ۲۰۰٬۰۰۰ ردیف).
 */

const LIVE = `COALESCE("deletedAt",'')=''`;
const LIMIT = 8;

/**
 * آماده‌سازی ورودی برای `LIKE`.
 *
 * ESCAPE '\' صریح تعیین می‌شود: SQLite پیش‌فرض escape ندارد، ولی با ESCAPE
 * می‌توانیم `%` و `_` را به‌عنوان **متن** جست‌وجو کنیم. بدون این، تایپ «50%»
 * همه‌چیز را برمی‌گرداند.
 */
function likePattern(q: string): string {
  const escaped = q.replace(/[\\%_]/g, (c) => '\\' + c);
  return `%${escaped}%`;
}

export interface SearchHit {
  kind: 'customer' | 'sale' | 'receipt' | 'expense' | 'employee';
  id: number;
  title: string;
  subtitle: string;
  /** مسیری که فرانت باید برود */
  path: string;
  /** مبلغ یا مبلغ بدهی، اگر مربوط باشد (تومان) */
  amount?: number;
}

@Controller('search')
export class SearchController {
  @Get()
  async search(@Query('q') qRaw: string, @Query('limit') limitRaw?: string) {
    await ensureSchemaAsync();
    const q = String(qRaw ?? '').trim();
    /*
     * کمتر از ۲ حرف: نتیجه‌ی خالی. با یک حرف، «ا» تقریباً همه‌ی اسم‌ها را
     * می‌گیرد و منو بی‌فایده می‌شود.
     */
    if (q.length < 2) return { q, hits: [] as SearchHit[] };

    const limit = Math.min(20, Math.max(1, Number(limitRaw) || LIMIT));
    const p = db();
    const pat = likePattern(q);
    const hits: SearchHit[] = [];

    /*
     * هر بخش در try/catch جدا: اگر جدولی در دیتابیس قدیمی ستونی نداشته باشد،
     * جست‌وجو به‌کل نمی‌شکند — فقط آن نوع نتیجه نمی‌دهد. (همان قاعده‌ای که در
     * سایر بخش‌ها هم رعایت شده.)
     */
    const section = async (fn: () => Promise<void>) => {
      try { await fn(); } catch (e: any) { console.warn('جست‌وجو بخشی را رد کرد:', e?.message || e); }
    };

    /* ── مشتریان: کد، نام، شماره تماس ─────────────────────────────────── */
    await section(async () => {
      const rows: any[] = await p.$queryRawUnsafe(
        `SELECT "id","code","name","phone" FROM "Customer"
          WHERE ${LIVE} AND ("isWalkIn" IS NULL OR "isWalkIn"=0)
            AND ("code" LIKE ? ESCAPE '\\' OR "name" LIKE ? ESCAPE '\\' OR "phone" LIKE ? ESCAPE '\\')
          ORDER BY "name" LIMIT ?`,
        pat, pat, pat, limit,
      );
      for (const r of rows) {
        hits.push({
          kind: 'customer', id: Number(r.id),
          title: String(r.name || ''),
          subtitle: [r.code && `کد ${r.code}`, r.phone].filter(Boolean).join(' · ') || 'مشتری',
          path: `/customers/${r.id}`,
        });
      }
    });

    /*
     * ── اسناد: بل، رسید، مصرف ──────────────────────────────────────────
     * جست‌وجو روی **شماره سند** و نام‌های ذخیره‌شده در سند. مبلغ هم اگر عدد
     * باشد پیدا می‌شود — کاربر معمولاً «۴۵۰۰۰» را به یاد دارد.
     */
    /*
     * ⚠ باگ واقعی که همین‌جا گرفته شد: نسخه‌ی اول این تابع فقط «شماره سند» و
     * «مبلغ» را می‌گشت، نه شرح سند. نتیجه: جست‌وجوی «دیزل» — شرح یک مصرف
     * واقعی که در فهرست دیده می‌شد — صفر نتیجه می‌داد. کاربر چیزی را که
     * جلوی چشمش است پیدا نمی‌کند و فکر می‌کند جست‌وجو خراب است.
     *
     * حالا «ستون‌های متنی سند» صریح داده می‌شوند؛ هیچ شناسه‌ای داخل رشته‌ی
     * SQL از ورودی کاربر نمی‌آید (این‌ها ثابت‌های خود کد هستند).
     */
    const docSection = async (opts: {
      kind: SearchHit['kind']; table: string; pathBase: string;
      amountCol: string; titleCol: string; /** ستونی که در عنوان نتیجه می‌آید */
      searchCols: string[]; /** ستون‌های متنی که جست‌وجو می‌شوند */
    }) => {
      const { kind, table, pathBase, amountCol, titleCol, searchCols } = opts;
      const conds = [
        `"no" LIKE ? ESCAPE '\\'`,
        `CAST(${amountCol} AS TEXT) LIKE ? ESCAPE '\\'`,
        ...searchCols.map((c) => `${c} LIKE ? ESCAPE '\\'`),
      ].join(' OR ');
      const args = [pat, pat, ...searchCols.map(() => pat), limit];
      const rows: any[] = await p.$queryRawUnsafe(
        `SELECT "id","no","date",${amountCol} AS amt,${titleCol} AS title FROM "${table}"
          WHERE ${LIVE} AND (${conds})
          ORDER BY "date" DESC, "id" DESC LIMIT ?`,
        ...args,
      );
      for (const r of rows) {
        hits.push({
          kind, id: Number(r.id),
          title: `${r.no || ''}${r.title ? ' — ' + r.title : ''}`,
          subtitle: String(r.date || ''),
          path: pathBase,
          amount: Number(r.amt) || 0,
        });
      }
    };

    await section(() => docSection({
      kind: 'sale', table: 'Sale', pathBase: '/sales', amountCol: '"total"',
      titleCol: '"customerName"', searchCols: ['"customerName"', '"materialName"', '"driverName"', '"truckPlate"'],
    }));
    await section(() => docSection({
      kind: 'receipt', table: 'Receipt', pathBase: '/receipts', amountCol: '"amount"',
      titleCol: '"customerName"', searchCols: ['"customerName"', '"sourceName"', '"receivedBy"'],
    }));
    await section(() => docSection({
      kind: 'expense', table: 'Expense', pathBase: '/expenses', amountCol: '"amountAfn"',
      titleCol: '"description"', searchCols: ['"description"', '"shopName"', '"categoryName"', '"payerName"'],
    }));

    /* ── کارمندان: کد، نام، وظیفه ─────────────────────────────────────── */
    await section(async () => {
      const rows: any[] = await p.$queryRawUnsafe(
        `SELECT "id","code","name","position" FROM "Employee"
          WHERE ${LIVE} AND ("code" LIKE ? ESCAPE '\\' OR "name" LIKE ? ESCAPE '\\' OR "position" LIKE ? ESCAPE '\\')
          ORDER BY "name" LIMIT ?`,
        pat, pat, pat, limit,
      );
      for (const r of rows) {
        hits.push({
          kind: 'employee', id: Number(r.id),
          title: String(r.name || ''),
          subtitle: [r.code && `کد ${r.code}`, r.position].filter(Boolean).join(' · ') || 'کارمند',
          path: `/employees/${r.id}`,
        });
      }
    });

    return { q, hits: hits.slice(0, limit * 5) };
  }
}
