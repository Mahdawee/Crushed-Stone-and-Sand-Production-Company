import { Controller, Get, Param, Query } from '@nestjs/common';
import { db } from '../db';
import { idParam } from '../common/params';
import { ensureSchemaAsync } from '../schema';
import { settingsService } from '../common/settings';
/*
 * ⚠ این دو تابع **منبع حقیقت** هستند، نه یک قاعده‌ی دست‌ساز.
 * نسخه‌ی اولم `NOT IN ('امانت')` نوشته بود — یک حدس. واقعیت این است که
 * «بیانیه/پیش‌پرداخت» هم بدهی را کم می‌کند و نام‌های قدیمی (بیانه، پیش پرداخت)
 * هم باید پوشش داده شوند. با حدس، مانده‌ی مشتری با راپور تفصیلی نمی‌خواند —
 * همان باگ «سه صفحه، سه عدد» (دور ۳۲) دوباره ساخته می‌شد.
 */
import { receiptDebtSql, realCustomerSql } from '../common/domain';
import { oldestOpenBill } from '../common/debt-aging';

/**
 * بدهی‌ها و یادآوری — پیشنهاد C5، دور ۴۰.
 *
 * ── چه چیزی کم بود ───────────────────────────────────────────────────────
 * مانده‌ی هر مشتری از قبل حساب می‌شد و داشبورد ۶ بدهکار بزرگ را نشان می‌داد.
 * ولی برای «یادآوری» دو چیز لازم است که نبود:
 *
 *   ۱) **عمرِ بدهی**: «۵۰٬۰۰۰ بدهکار است» با «۵۰٬۰۰۰ از چهار ماه پیش»
 *      یکی نیست. مشتری‌ای که هفته‌ی پیش خریده را نباید زنگ زد.
 *   ۲) **متن آماده‌ی پیام**: مغازه‌دار باید بتواند عدد را در واتساپ/پیامک
 *      بفرستد بدون اینکه دوباره حساب کند — و همان‌جاست که عدد اشتباه
 *      می‌شود.
 *
 * ── قاعده‌ها (همه از باگ‌های قبلی) ────────────────────────────────────────
 *   • «مجموع بدهی» = جمع مانده‌های **مثبت** فقط. مشتری بستانکار بدهی
 *     دیگران را کم نمی‌کند (باگ دور ۳۲: سه صفحه سه عدد مختلف می‌گفتند).
 *   • اسناد حذف‌نرم‌شده هرگز شمرده نمی‌شوند.
 *   • مشتری گذری از فهرست بیرون است (بدهی‌اش قابل پیگیری نیست).
 *   • مبلغ گرد شده به ۲ رقم — همان قاعده‌ی بقیه‌ی گزارش‌ها.
 */

const LIVE = `COALESCE("deletedAt",'')=''`;
/** همان قاعده‌ی منبع رسید که در بقیه‌ی گزارش‌ها استفاده می‌شود (نه یک نسخه‌ی محلی) */
const RECEIPT_DEBT = receiptDebtSql('"sourceName"');
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface DebtorRow {
  id: number;
  code: string;
  name: string;
  phone: string;
  balance: number;
  /** تاریخ قدیمی‌ترین بل باقیِ تسویه‌نشده */
  oldestDate: string;
  /** چند روز از آن تاریخ گذشته (۰ = امروز یا تازه‌تر) */
  days: number;
  bucket: '0-30' | '31-60' | '61-90' | '90+';
  /** دسته‌ی «قدیمی» — برای برجسته‌کردن در رابط */
  overdue: boolean;
  /** بدهی از «مانده‌ی قبلی» است، نه از یک فروش — تاریخ ندارد */
  fromOpening: boolean;
}

/** چند روز بین دو تاریخ ISO (YYYY-MM-DD). */
function daysBetween(fromISO: string, toISO: string): number {
  if (!fromISO || !toISO) return 0;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function bucketOf(days: number): DebtorRow['bucket'] {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

@Controller('debts')
export class DebtsController {
  /**
   * فهرست بدهکاران با عمر بدهی.
   *
   * `FIFO` (اول‌بی‌اول‌پرداخت): رسیدها روی **قدیمی‌ترین** بل‌ها می‌نشینند.
   * این تنها روشی است که «از چه زمانی بدهکار است» را معنادار می‌کند؛
   * بدون آن، هر رسید به همه‌ی بل‌ها یکسان نسبت داده می‌شد و عدد بی‌معنا
   * می‌شد.
   */
  @Get()
  async list(@Query('days') daysRaw?: string) {
    await ensureSchemaAsync();
    const p = db();
    const calendar = await settingsService.calendar();
    const today = new Date().toISOString().slice(0, 10);
    /* حداقل روز برای «قدیمی» — پیش‌فرض ۳۱ (یعنی بیش از یک ماه) */
    const overdueAfter = Math.max(0, Number(daysRaw) || 31);

    const customers: any[] = await p.$queryRawUnsafe(
      `SELECT "id","code","name","phone","openingBalance" FROM "Customer"
        WHERE ${LIVE} AND ${realCustomerSql()}`,
    );

    const rows: DebtorRow[] = [];
    for (const c of customers) {
      const cid = Number(c.id);
      /*
       * بل‌های باقی (credit) با تاریخ — به ترتیب قدیمی‌ترین.
       * فروش نقده از همان لحظه تسویه است، پس بدهی نمی‌سازد.
       */
      const sales: any[] = await p.$queryRawUnsafe(
        `SELECT "date", COALESCE("total",0) AS total FROM "Sale"
          WHERE "customerId"=? AND ${LIVE} AND "paymentType"='credit' ORDER BY "date", "id"`,
        cid,
      );
      const receipts: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amount"),0) AS paid FROM "Receipt"
          WHERE "customerId"=? AND ${LIVE} AND ${RECEIPT_DEBT}`,
        cid,
      );
      const paid = num(receipts?.[0]?.paid);
      const opening = num(c.openingBalance);

      /* مانده‌ی کل — همان فرمول بقیه‌ی گزارش‌ها */
      const creditTotal = sales.reduce((a, s) => a + num(s.total), 0);
      const balance = r2(opening + creditTotal - paid);
      if (Math.abs(balance) <= 0.001) continue;

      /* FIFO: پرداخت‌ها اول قدیمی‌ترین بل را می‌بندند */
      const openBill = oldestOpenBill(opening, sales, paid);
      const oldest = openBill.date;
      /*
       * مانده‌ی قبلی تاریخ ندارد. اگر «قدیمی» حساب شود، کاربر برای بدهی
       * سال‌گذشته یادآوری می‌فرستد — که هدف است؛ ولی عدد روز ساختگی
       * نمی‌سازیم: days=0 و fromOpening=true تا رابط «مانده‌ی قبلی» بنویسد.
       */
      const days = oldest ? daysBetween(oldest, today) : 0;
      rows.push({
        id: cid,
        code: String(c.code || ''),
        name: String(c.name || ''),
        phone: String(c.phone || ''),
        balance,
        oldestDate: oldest,
        days,
        bucket: bucketOf(days),
        overdue: days >= overdueAfter,
        fromOpening: openBill.fromOpening,
      });
    }

    /* فقط بدهکاران (مانده‌ی مثبت) — بستانکارها در راپور تفصیلی هستند */
    const debtors = rows.filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance);
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 } as Record<DebtorRow['bucket'], number>;
    for (const d of debtors) buckets[d.bucket] = r2(buckets[d.bucket] + d.balance);

    return {
      calendar,
      today,
      overdueAfter,
      total: r2(debtors.reduce((a, d) => a + d.balance, 0)),
      count: debtors.length,
      /** جمع هر دسته‌ی سنی — برای تصمیم‌گیری («چقدر از ۹۰+ روزه؟») */
      buckets,
      /** چند نفر از حد «قدیمی» گذشته‌اند */
      overdueCount: debtors.filter((d) => d.overdue).length,
      rows: debtors,
    };
  }

  /**
   * متن آماده‌ی یادآوری برای یک مشتری.
   *
   * چرا از سرور و نه از رابط: عدد باید **همان** عددی باشد که در فهرست و
   * کارت حساب دیده می‌شود. اگر رابط خودش جمع بزند، دیر یا زود با سرور
   * اختلاف پیدا می‌کند و کاربر دو عدد مختلف می‌بیند.
   */
  @Get(':id/reminder')
  async reminder(@Param('id') id: string) {
    await ensureSchemaAsync();
    const cid = idParam(id, 'شناسه‌ی مشتری');
    const p = db();
    const c: any[] = await p.$queryRawUnsafe(
      `SELECT * FROM "Customer" WHERE "id"=? AND ${LIVE}`, cid,
    );
    if (!c?.length) return { ok: false, message: 'مشتری پیدا نشد.' };
    const cust = c[0];

    const sales: any[] = await p.$queryRawUnsafe(
      `SELECT "no","date",COALESCE("total",0) AS total FROM "Sale"
        WHERE "customerId"=? AND ${LIVE} AND "paymentType"='credit' ORDER BY "date"`,
      cid,
    );
    const paidRows: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("amount"),0) AS paid FROM "Receipt"
        WHERE "customerId"=? AND ${LIVE} AND ${RECEIPT_DEBT}`,
      cid,
    );
    const paid = num(paidRows?.[0]?.paid);
    const credit = sales.reduce((a, s) => a + num(s.total), 0);
    const balance = r2(num(cust.openingBalance) + credit - paid);
    if (balance <= 0.001) {
      return {
        ok: false,
        message: balance < -0.001
          ? 'این مشتری بستانکار است (پیش‌پرداخت دارد)؛ یادآوری بدهی معنا ندارد.'
          : 'حساب این مشتری تسویه است؛ یادآوری لازم نیست.',
        balance,
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    /* همان FIFO فهرست — وگرنه متن پیام بل تسویه‌شده را «قدیمی‌ترین» می‌گفت */
    const openBill = oldestOpenBill(num(cust.openingBalance), sales, paid);
    const oldest = openBill.date;
    const days = oldest ? daysBetween(oldest, today) : 0;
    const company = await p.$queryRawUnsafe(`SELECT "name" FROM "Company" WHERE "id"=1`);
    const companyName = String((company as any[])?.[0]?.name || 'شرکت');

    /*
     * متن عمداً کوتاه و محترمانه است. پیام بلند خوانده نمی‌شود و پیام
     * طلبکارانه، مشتری را فراری می‌دهد — هدف یادآوری است، نه فشار.
     */
    const lines = [
      `${cust.name} عزیز، سلام.`,
      `مانده‌ی حساب شما در «${companyName}» مبلغ ${balance.toLocaleString('fa-IR')} افغانی است.`,
      openBill.fromOpening
        ? 'بخشی از این مانده از حساب قبلی شما باقی مانده است.'
        : (days > 0 ? `این مانده از ${days.toLocaleString('fa-IR')} روز پیش (قدیمی‌ترین بل باقی) باقی مانده است.` : ''),
      'خوشحال می‌شویم در فرصت مناسب تسویه کنید. اگر پرداختی انجام داده‌اید که در سیستم ثبت نشده، اطلاع دهید تا اصلاح شود.',
      'با تشکر',
    ].filter(Boolean);

    return {
      ok: true,
      customer: { id: Number(cust.id), name: cust.name, phone: cust.phone },
      balance, oldestDate: oldest, days, fromOpening: openBill.fromOpening,
      text: lines.join('\n'),
      /** شماره‌ی قابل استفاده در wa.me — فقط رقم‌ها */
      phoneDigits: String(cust.phone || '').replace(/[^\d]/g, ''),
    };
  }
}
