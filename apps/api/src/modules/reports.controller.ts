import { Controller, Get, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard } from '../common/auth';
import { canonicalReceiptSource, receiptDebtSql, reducesCustomerDebt } from '../common/domain';
import { settingsService } from '../common/settings';
import {
  CalendarMode, monthBucket, yearBucket, todayISO, formatDate, monthName, pad2,
  toCalendar, fromCalendar, startOfMonth, endOfMonth, startOfYear, endOfYear, daysBetween, addDays,
  parseUserDate, assertRange, monthLength,
} from '../common/calendar';

type Row = Record<string, number>;

const num = (v: any) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

@UseGuards(AuthGuard)
@Controller('reports')
export class ReportsController {
  /** Daily figures for one Gregorian ISO date (sums in AFN). */
  async dayFigures(dateISO: string) {
    const p = db();
    const mode = await settingsService.calendar();
    const cashMode = await settingsService.get('cashMode');

    const s: any[] = await p.$queryRawUnsafe(
      `SELECT
         COALESCE(SUM(CASE WHEN "paymentType"='cash' THEN "total" ELSE 0 END),0) AS cashSales,
         COALESCE(SUM(CASE WHEN "paymentType"='credit' THEN "total" ELSE 0 END),0) AS creditSales,
         COALESCE(SUM("total"),0) AS allSales,
         COALESCE(SUM("volume"),0) AS volume
       FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date"=?`, dateISO);
    const receipts: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("amount"),0) AS total,
        COALESCE(SUM(CASE WHEN NOT (${receiptDebtSql('"sourceName"')}) THEN "amount" ELSE 0 END),0) AS trust,
        /* در حالت دقیق: فقط پولی که نزد دخل آمده (نه امانت، نه بانک) */
        COALESCE(SUM(CASE WHEN ${receiptDebtSql('"sourceName"')}
                          AND (COALESCE("receivedBy",'')='' OR "receivedBy"='دخل')
                     THEN "amount" ELSE 0 END),0) AS cashToBox
       FROM "Receipt" WHERE COALESCE("deletedAt",'')='' AND "date"=?`, dateISO);
    const expenses: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("amountAfn"),0) AS afn, COALESCE(SUM("amountUsd"),0) AS usd,
        COALESCE(SUM(CASE WHEN "paymentType"='cash' AND "payerName"='دخل' THEN "amountAfn" ELSE 0 END),0) AS cashFromBox,
        COALESCE(SUM(CASE WHEN "paymentType"='credit' THEN "amountAfn" ELSE 0 END),0) AS credit
       FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date"=?`, dateISO);
    const salaries: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("total"),0) AS total,
        COALESCE(SUM(CASE WHEN "paymentType"='cash' AND "payerName"='دخل' THEN "total" ELSE 0 END),0) AS cashFromBox
       FROM "Salary" WHERE COALESCE("deletedAt",'')='' AND "payDate"=?`, dateISO);

    const cashSales = num(s[0]?.cashSales);
    const creditSales = num(s[0]?.creditSales);
    const receiptTotal = num(receipts[0]?.total);
    const receiptTrust = num(receipts[0]?.trust);
    const expenseAfn = num(expenses[0]?.afn);
    const salaryTotal = num(salaries[0]?.total);
    const totalOut = expenseAfn + salaryTotal;

    /*
     * باگ: در حالت «دقیق» فقط «امانت» از دخل کنار می‌رفت، ولی رسیدهایی که
     * صراحتاً به بانک/کس دیگر رفته‌اند (receivedBy ≠ دخل) هم پول دخل نیستند.
     * حالا از همان جمع‌ای که SQL جدا حساب می‌کند (cashToBox) استفاده می‌شود تا
     * راپور روزانه، داشبورد و حرکت دخل یک عدد بدهند.
     */
    const receiptToBox = num(receipts[0]?.cashToBox);
    /*
     * «امانت» در هیچ حالتی پول دخل نیست (نه در بدهی مشتری، نه در موجودی).
     * در حالت «ساده» بقیه‌ی رسیدات وارد دخل می‌شوند، در «دقیق» تنها آنچه
     * واقعاً نزد دخل آمده (cashToBox).
     */
    const cashIn = cashMode === 'accurate'
      ? cashSales + receiptToBox
      : cashSales + (receiptTotal - receiptTrust);
    const cashOut = cashMode === 'accurate'
      ? num(expenses[0]?.cashFromBox) + num(salaries[0]?.cashFromBox)
      : expenseAfn + salaryTotal;

    return {
      date: dateISO,
      dateDisplay: formatDate(dateISO, mode),
      calendar: mode,
      cashMode,
      cashSales: r2(cashSales),
      creditSales: r2(creditSales),
      allSales: r2(num(s[0]?.allSales)),
      volume: r2(num(s[0]?.volume)),
      receipts: r2(receiptTotal),
      receiptsTrust: r2(receiptTrust),
      receiptsToBox: r2(receiptToBox),
      expensesAfn: r2(expenseAfn),
      expensesUsd: r2(num(expenses[0]?.usd)),
      salaries: r2(salaryTotal),
      totalExpenses: r2(totalOut),
      // موجودی دخل (closing cash for the day)
      cashBalance: r2(cashIn - cashOut),
      cashIn: r2(cashIn),
      cashOut: r2(cashOut),
    };
  }


  /**
   * همان اعداد `dayFigures` برای یک بازه — با ۶ کوئری گروهی به‌جای
   * ۶ کوئری برای هر روز.
   *
   * خروجی دقیقاً همان شکل `dayFigures` است (به‌علاوه‌ی runningCash)، چون
   * صفحه‌ی «راپور روزانه» ستون‌های آن را مستقیم نشان می‌دهد.
   */
  private async rangeRows(start: string, end: string, daysDesc: string[], mode: CalendarMode) {
    const p = db();
    const cashMode = await settingsService.get('cashMode');
    const accurate = cashMode === 'accurate';
    const q = (sql: string) => p.$queryRawUnsafe(sql, start, end) as Promise<any[]>;

    const [sales, receipts, expenses, salaries] = await Promise.all([
      q(
        `SELECT "date" d,
           COALESCE(SUM(CASE WHEN "paymentType"='cash' THEN "total" ELSE 0 END),0) cash,
           COALESCE(SUM(CASE WHEN "paymentType"='credit' THEN "total" ELSE 0 END),0) credit,
           COALESCE(SUM("total"),0) allS,
           COALESCE(SUM("volume"),0) volume
         FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "date"`,
      ),
      q(
        `SELECT "date" d,
           COALESCE(SUM("amount"),0) total,
           COALESCE(SUM(CASE WHEN NOT (${receiptDebtSql('"sourceName"')}) THEN "amount" ELSE 0 END),0) trust,
           COALESCE(SUM(CASE WHEN ${receiptDebtSql('"sourceName"')}
                             AND (COALESCE("receivedBy",'')='' OR "receivedBy"='دخل')
                        THEN "amount" ELSE 0 END),0) toBox
         FROM "Receipt" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "date"`,
      ),
      q(
        `SELECT "date" d, COALESCE(SUM("amountAfn"),0) afn, COALESCE(SUM("amountUsd"),0) usd,
           COALESCE(SUM(CASE WHEN "paymentType"='cash' AND "payerName"='دخل' THEN "amountAfn" ELSE 0 END),0) fromBox
         FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "date"`,
      ),
      q(
        `SELECT "payDate" d, COALESCE(SUM("total"),0) total,
           COALESCE(SUM(CASE WHEN "paymentType"='cash' AND "payerName"='دخل' THEN "total" ELSE 0 END),0) fromBox
         FROM "Salary" WHERE COALESCE("deletedAt",'')='' AND "payDate">=? AND "payDate"<=? GROUP BY "payDate"`,
      ),
    ]);

    const map = (rows: any[]) => {
      const m = new Map<string, any>();
      for (const r of rows || []) m.set(String(r.d), r);
      return m;
    };
    const sm = map(sales);
    const rm = map(receipts);
    const em = map(expenses);
    const sam = map(salaries);

    /* قدیمی‌ترین روز اول، تا موجودی دخل تجمعی درست باشد */
    const ascending = [...daysDesc].reverse();
    let running = 0;
    const out: any[] = [];
    for (const d of ascending) {
      const s0 = sm.get(d) || {};
      const r0 = rm.get(d) || {};
      const e0 = em.get(d) || {};
      const sa0 = sam.get(d) || {};

      const cashSales = num(s0.cash);
      const creditSales = num(s0.credit);
      const receiptTotal = num(r0.total);
      const receiptTrust = num(r0.trust);
      const expenseAfn = num(e0.afn);
      const salaryTotal = num(sa0.total);
      const cashIn = accurate ? cashSales + num(r0.toBox) : cashSales + (receiptTotal - receiptTrust);
      const cashOut = accurate ? num(e0.fromBox) + num(sa0.fromBox) : expenseAfn + salaryTotal;
      const cashBalance = r2(cashIn - cashOut);
      running += cashBalance;

      out.push({
        date: d,
        dateDisplay: formatDate(d, mode),
        calendar: mode,
        cashMode,
        cashSales: r2(cashSales),
        creditSales: r2(creditSales),
        allSales: r2(num(s0.allS)),
        volume: r2(num(s0.volume)),
        receipts: r2(receiptTotal),
        receiptsTrust: r2(receiptTrust),
        receiptsToBox: r2(num(r0.toBox)),
        expensesAfn: r2(expenseAfn),
        expensesUsd: r2(num(e0.usd)),
        salaries: r2(salaryTotal),
        totalExpenses: r2(expenseAfn + salaryTotal),
        cashBalance,
        cashIn: r2(cashIn),
        cashOut: r2(cashOut),
        runningCash: r2(running),
      });
    }
    /* نمایش: جدیدترین روز اول (همان ترتیب قبلی) */
    return out.reverse();
  }

  @Get('daily')
  async daily(@Query('from') from?: string, @Query('to') to?: string) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const today = todayISO();
    /*
     * باگ (با فاز تست پیدا شد): ورودی نامعتبر تاریخ در راپور روزانه **۵۰۰**
     * می‌داد، چون `parseUserDate` بیرون از try صدا زده می‌شد و استثنایش به
     * «Internal server error» تبدیل می‌شد — کاربر به‌جای پیام فارسی، خطای
     * مبهم می‌دید. حالا همان ۴۰۰ با پیام روشن برمی‌گردد.
     */
    let start: string;
    let end: string;
    try {
      start = from ? parseUserDate(from, mode) : startOfMonth(today, mode);
      end = to ? parseUserDate(to, mode) : endOfMonth(today, mode);
      assertRange(start, end);
    } catch (e: any) { throw new HttpException(e.message, 400); }
    const days = daysBetween(start, end).reverse(); // newest first
    /*
     * کارایی: نسخه‌ی قبلی برای **هر روز** `dayFigures` را صدا می‌زد؛ هر روز
     * ۴ کوئری + ۲ خواندن تنظیمات. یک بازه‌ی ۳۰۰ روزه یعنی ~۱۸۰۰ رفت‌وبرگشت
     * و ۱۰–۲۰ ثانیه معطلی روی کمپیوتر معمولی. حالا همان محاسبات با ۶ کوئری
     * گروهی (`GROUP BY date`) انجام می‌شود و نتیجه عدد‌به‌عدد یکسان است.
     */
    const rows = await this.rangeRows(start, end, days, mode);
    const totals = rows.reduce<Row>((a, r: any) => {
      a.creditSales += r.creditSales; a.cashSales += r.cashSales; a.receipts += r.receipts;
      a.expensesAfn += r.expensesAfn; a.salaries += r.salaries; a.totalExpenses += r.totalExpenses;
      a.cashIn += r.cashIn; a.cashOut += r.cashOut;
      a.cashBalance += r.cashBalance; return a;
    }, { creditSales: 0, cashSales: 0, receipts: 0, expensesAfn: 0, salaries: 0, totalExpenses: 0, cashBalance: 0, cashIn: 0, cashOut: 0 });
    return { from: start, to: end, calendar: mode, rows, totals, mode };
  }

  @Get('monthly')
  async monthly(@Query('year') year?: string) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const cy = toCalendar(todayISO(), mode).jy;
    let y = Number(year) || cy;
    /*
     * باگ (فاز تست): `monthly?year=-5` یا `year=999999` هم ۲۰۰ می‌داد و
     * راپور با برچسب بی‌معنی/تاریخ‌های خارج از محدوده ساخته می‌شد. حالا
     * فقط ±۱۰۰ سال حول سال جاری پذیرفته می‌شود.
     */
    if (!Number.isFinite(y) || y < cy - 100 || y > cy + 100) {
      throw new HttpException('سال انتخابی معتبر نیست.', 400);
    }
    y = Math.trunc(y);
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const start = fromCalendar(y, m, 1, mode);
      /* طول واقعی ماه (jalaali-js) — تقریب ۳۳ ساله در سال‌های خاص یک روز خطا داشت */
      const end = fromCalendar(y, m, monthLength(y, m, mode), mode);
      const p = db();
      const s: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM(CASE WHEN "paymentType"='cash' THEN "total" ELSE 0 END),0) cash,
                COALESCE(SUM(CASE WHEN "paymentType"='credit' THEN "total" ELSE 0 END),0) credit,
                COALESCE(SUM("volume"),0) volume FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, start, end);
      const r: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amount"),0) t FROM "Receipt" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, start, end);
      const e: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amountAfn"),0) afn, COALESCE(SUM("amountUsd"),0) usd FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, start, end);
      const sa: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("total"),0) t FROM "Salary" WHERE COALESCE("deletedAt",'')='' AND "payDate">=? AND "payDate"<=?`, start, end);
      const cash = num(s[0]?.cash); const credit = num(s[0]?.credit);
      const exp = num(e[0]?.afn); const sal = num(sa[0]?.t);
      const net = cash + credit - exp - sal;
      rows.push({
        year: y, month: m, label: `${monthName(m, mode)} ${y}`,
        start, end,
        cashSales: r2(cash), creditSales: r2(credit), totalSales: r2(cash + credit),
        receipts: r2(num(r[0]?.t)), expenses: r2(exp), salaries: r2(sal),
        totalExpenses: r2(exp + sal),
        profit: net >= 0 ? r2(net) : 0, loss: net < 0 ? r2(-net) : 0,
        volume: r2(num(s[0]?.volume)), expensesUsd: r2(num(e[0]?.usd)),
      });
    }
    const totals = rows.reduce((a: any, r: any) => {
      a.cashSales += r.cashSales; a.creditSales += r.creditSales; a.totalSales += r.totalSales;
      a.receipts += r.receipts; a.expenses += r.expenses; a.salaries += r.salaries;
      a.totalExpenses += r.totalExpenses; a.profit += r.profit; a.loss += r.loss; a.volume += r.volume;
      return a;
    }, { cashSales: 0, creditSales: 0, totalSales: 0, receipts: 0, expenses: 0, salaries: 0, totalExpenses: 0, profit: 0, loss: 0, volume: 0 });
    return { year: y, calendar: mode, rows, totals };
  }

  @Get('yearly')
  async yearly() {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const p = db();
    /*
     * باگ: فهرست سال‌ها فقط از سال جاری + سال‌های «معاش» ساخته می‌شد؛ پس سالی
     * که در آن فروش/مصرف/رسید ثبت شده ولی معاش نه، در راپور سالانه اصلاً
     * دیده نمی‌شد (و بل ۳۰ اسفند سال کبیسه گم می‌شد). حالا بازه‌ی سال‌ها از
     * روی داده‌ی واقعیِ هر چهار جدول حساب می‌شود.
     */
    const span: any[] = await p.$queryRawUnsafe(
      `SELECT MIN(d) AS lo, MAX(d) AS hi FROM (
         SELECT MIN("date") AS d FROM "Sale" WHERE COALESCE("deletedAt",'')=''
         UNION ALL SELECT MAX("date") FROM "Sale" WHERE COALESCE("deletedAt",'')=''
         UNION ALL SELECT MIN("date") FROM "Expense" WHERE COALESCE("deletedAt",'')=''
         UNION ALL SELECT MAX("date") FROM "Expense" WHERE COALESCE("deletedAt",'')=''
         UNION ALL SELECT MIN("date") FROM "Receipt" WHERE COALESCE("deletedAt",'')=''
         UNION ALL SELECT MAX("date") FROM "Receipt" WHERE COALESCE("deletedAt",'')=''
         UNION ALL SELECT MIN("payDate") FROM "Salary" WHERE COALESCE("deletedAt",'')=''
         UNION ALL SELECT MAX("payDate") FROM "Salary" WHERE COALESCE("deletedAt",'')=''
       ) WHERE d IS NOT NULL AND d <> ''`);
    const currentYear = toCalendar(todayISO(), mode).jy;
    const years = new Set<number>([currentYear]);
    const lo = span?.[0]?.lo ? toCalendar(String(span[0].lo), mode).jy : currentYear;
    const hi = span?.[0]?.hi ? toCalendar(String(span[0].hi), mode).jy : currentYear;
    for (let y = Math.min(lo, currentYear); y <= Math.max(hi, currentYear); y++) years.add(y);
    const list = Array.from(years).filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
    const rows = [];
    for (const y of list) {
      const start = fromCalendar(y, 1, 1, mode);
      /* سال کامل: اسفند ۳۰ در سال کبیسه، دسمبر ۳۱ — نه ۲۹/۳۱ ثابت */
      const end = fromCalendar(y, 12, monthLength(y, 12, mode), mode);
      const s: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("total"),0) t FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, start, end);
      const e: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amountAfn"),0) afn, COALESCE(SUM("amountUsd"),0) usd FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, start, end);
      const sa: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("total"),0) t FROM "Salary" WHERE COALESCE("deletedAt",'')='' AND "payDate">=? AND "payDate"<=?`, start, end);
      const r: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amount"),0) t FROM "Receipt" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, start, end);
      const sales = num(s[0]?.t); const exp = num(e[0]?.afn); const sal = num(sa[0]?.t);
      const net = sales - exp - sal;
      rows.push({
        year: y, start, end, sales: r2(sales), expenses: r2(exp), salaries: r2(sal),
        totalExpenses: r2(exp + sal), receipts: r2(num(r[0]?.t)), expensesUsd: r2(num(e[0]?.usd)),
        profit: net >= 0 ? r2(net) : 0, loss: net < 0 ? r2(-net) : 0,
      });
    }
    return { calendar: mode, rows };
  }

  @Get('cashbook')
  async cashbook(@Query('from') from?: string, @Query('to') to?: string) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const today = todayISO();
    const start = from || startOfMonth(today, mode);
    const end = to || endOfMonth(today, mode);
    try { assertRange(start, end); } catch (e: any) { throw new HttpException(e.message, 400); }
    const p = db();
    const entries: any[] = [];
    const sales: any[] = await p.$queryRawUnsafe(
      `SELECT "no","date","customerName","total" FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? AND "paymentType"='cash'`, start, end);
    const receipts: any[] = await p.$queryRawUnsafe(
      `SELECT "no","date","customerName","amount","sourceName","receivedBy" FROM "Receipt" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, start, end);
    const expenses: any[] = await p.$queryRawUnsafe(
      `SELECT "no","date","description","amountAfn","payerName","paymentType" FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, start, end);
    const salaries: any[] = await p.$queryRawUnsafe(
      `SELECT "no","payDate" as date,"employeeName","total","payerName","paymentType" FROM "Salary" WHERE COALESCE("deletedAt",'')='' AND "payDate">=? AND "payDate"<=?`, start, end);
    /*
     * حرکت دخل باید با راپور روزانه/داشبورد یکی باشد — قبلاً نبود:
     *  • رسید «امانت» (پول امانت) به عنوان ورودی دخل حساب می‌شد، در حالی که
     *    در بدهی مشتری و موجودی دخل حساب نمی‌شود.
     *  • در حالت «دقیق»، مصرف/معاش قرضه (باقی) که پولی از دخل نرفته، باز هم
     *    از دخل کم می‌شد.
     *  • رسیدهایی که به بانک رفته‌اند (receivedBy≠دخل) در حالت دقیق نباید
     *    ورودی دخل باشند.
     */
    /*
     * حالت «ساده» در راپور روزانه، همه‌ی رسیدات و همه‌ی مصارف را وارد دخل
     * می‌کند (بدهی مشتری هم بر همین اساس است: فقط «امانت» کم می‌شود).
     * برای اینکه حرکت دخل با آن گزارش یکی بماند، قرضه/حواله فقط در حالت
     * «دقیق» از دخل کنار گذاشته می‌شود.
     */
    const cashMode = await settingsService.get('cashMode');
    const accurate = cashMode === 'accurate';
    for (const s of sales) entries.push({ date: s.date, type: 'فروش نقده', doc: s.no, party: s.customerName, in: num(s.total), out: 0 });
    for (const r of receipts) {
      /* تصمیم «امانت بودن» از یک جا — نه رشته‌ی دستی */
      const trust = !reducesCustomerDebt(null, r.sourceName);
      const toBox = !r.receivedBy || r.receivedBy === 'دخل';
      entries.push({
        date: r.date,
        type: trust
          ? 'رسید (امانت — وارد دخل نشد)'
          : `رسید (${canonicalReceiptSource(r.sourceName) || 'باقی داری'})`,
        kind: trust || (accurate && !toBox) ? 'info' : '',
        doc: r.no, party: r.customerName,
        in: trust || (accurate && !toBox) ? 0 : num(r.amount), out: 0,
      });
    }
    for (const e of expenses) {
      const fromBox = !accurate || (e.paymentType === 'cash' && e.payerName === 'دخل');   /* ساده: همه */
      
      entries.push({
        date: e.date,
        type: `مصرف${e.paymentType === 'credit' ? ' (باقی)' : ''} — ${e.payerName || ''}`,
        kind: fromBox ? '' : 'info',
        doc: e.no, party: e.description,
        in: 0, out: fromBox ? num(e.amountAfn) : 0,
      });
    }
    for (const s2 of salaries) {
      const fromBox = !accurate || (s2.paymentType === 'cash' && s2.payerName === 'دخل');
      entries.push({
        date: s2.date,
        type: `معاش (${s2.paymentType === 'hawala' ? 'حواله' : 'نقد'})`,
        kind: fromBox ? '' : 'info',
        doc: s2.no, party: s2.employeeName,
        in: 0, out: fromBox ? num(s2.total) : 0,
      });
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.doc).localeCompare(String(b.doc))));
    let bal = 0;
    const rows = entries.map((e) => {
      if (e.kind !== 'info') bal += e.in - e.out;
      return { ...e, dateDisplay: formatDate(e.date, mode), balance: r2(bal) };
    });
    return {
      from: start, to: end, calendar: mode, rows,
      totals: { in: r2(rows.reduce((a, r) => a + r.in, 0)), out: r2(rows.reduce((a, r) => a + r.out, 0)), balance: r2(bal) },
    };
  }

  /** Detailed breakdowns: sales by material, by customer, expenses by category, etc. */
  @Get('breakdown')
  async breakdown(@Query('from') from?: string, @Query('to') to?: string) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const today = todayISO();
    const start = from || startOfYear(today, mode);
    const end = to || today;
    try { assertRange(start, end); } catch (e: any) { throw new HttpException(e.message, 400); }
    const p = db();
    /*
     * هر کوئری دو «؟» (بازه) دارد؛ کوئری «مربوط» سه بخش دارد و شش «؟».
     * پارامترها را از روی تعداد «؟» می‌سازیم تا هیچ کوئری‌ای با آرگومان
     * کم/زیاد اجرا نشود (خطای خاموش libSQL).
     */
    const q = async (sql: string) => {
      const n = (sql.match(/\?/g) || []).length;
      const args = Array.from({ length: Math.floor(n / 2) }, () => [start, end]).flat();
      return (await p.$queryRawUnsafe(sql, ...args)) as any[];
    };
    const byMaterial = await q(
      `SELECT "materialName" as name, COUNT(*) as docs, COALESCE(SUM("volume"),0) as volume,
              COALESCE(SUM("total"),0) as total, COALESCE(SUM("freightTotal"),0) as freight
       FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "materialName" ORDER BY total DESC`);
    const byCustomer = await q(
      `SELECT "customerName" as name, COUNT(*) as docs, COALESCE(SUM("volume"),0) as volume,
              COALESCE(SUM("total"),0) as total,
              COALESCE(SUM(CASE WHEN "paymentType"='credit' THEN "total" ELSE 0 END),0) as credit
       FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "customerName" ORDER BY total DESC`);
    const byCategory = await q(
      `SELECT "categoryName" as name, COUNT(*) as docs, COALESCE(SUM("amountAfn"),0) as afn, COALESCE(SUM("amountUsd"),0) as usd
       FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "categoryName" ORDER BY afn DESC`);
    const byPayer = await q(
      `SELECT "payerName" as name, COUNT(*) as docs, COALESCE(SUM("amountAfn"),0) as afn
       FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "payerName" ORDER BY afn DESC`);
    const byContractor = await q(
      `SELECT "contractorName" as name, COUNT(*) as docs, COALESCE(SUM("freightTotal"),0) as freight
       FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? AND COALESCE("contractorName",'') <> '' GROUP BY "contractorName" ORDER BY freight DESC`);
    /*
     * «مربوط» = شاخه‌ی مصرف.
     *
     * درخواست کاربر: «"مربوط" در حقیقت همان شاخه مصرف است این مفهوم جدید را
     * در تمامی سیستم و برنامه پیاده کن». شاخه در سه سند ظاهر می‌شود و تا
     * امروز هر سه جدا گزارش می‌شدند: کرایه‌ی فروش، مصرف، و رسیدی که از آن
     * شاخه آمده. این‌جا یک‌جا جمع می‌شوند تا «این شاخه چقدر خرج/درآمد
     * داشت؟» یک عدد داشته باشد.
     *
     * محاسبه با `UNION ALL` و گروه‌بندی روی نام شاخه است؛ هیچ جدولی عوض
     * نمی‌شود و اسناد قدیمی که شاخه نداشتند در ردیف «بدون شاخه» می‌آیند تا
     * جمع کل با جمع اسناد بخواند.
     */
    const byRelated = await q(
      `SELECT "branch" as name,
              SUM("saleDocs") as saleDocs, SUM("freight") as freight,
              SUM("expenseDocs") as expenseDocs, SUM("expenseAfn") as expenseAfn,
              SUM("receiptDocs") as receiptDocs, SUM("receiptAmount") as receiptAmount
       FROM (
         SELECT COALESCE(NULLIF("contractorName",''),'بدون شاخه') as "branch",
                COUNT(*) as "saleDocs", COALESCE(SUM("freightTotal"),0) as freight,
                0 as "expenseDocs", 0 as "expenseAfn", 0 as "receiptDocs", 0 as "receiptAmount"
         FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?
         GROUP BY COALESCE(NULLIF("contractorName",''),'بدون شاخه')
         UNION ALL
         SELECT COALESCE(NULLIF("contractorName",''),'بدون شاخه'),
                0, 0, COUNT(*), COALESCE(SUM("amountAfn"),0), 0, 0
         FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?
         GROUP BY COALESCE(NULLIF("contractorName",''),'بدون شاخه')
         UNION ALL
         SELECT COALESCE(NULLIF("sourceName",''),'بدون شاخه'),
                0, 0, 0, 0, COUNT(*), COALESCE(SUM("amount"),0)
         FROM "Receipt" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?
               AND ${receiptDebtSql('"sourceName"')}
         GROUP BY COALESCE(NULLIF("sourceName",''),'بدون شاخه')
       ) GROUP BY "branch" ORDER BY expenseAfn DESC, freight DESC`);
    const relatedTotals = {
      freight: num(byRelated.reduce((a: number, r: any) => a + num(r.freight), 0)),
      expenseAfn: num(byRelated.reduce((a: number, r: any) => a + num(r.expenseAfn), 0)),
      receiptAmount: num(byRelated.reduce((a: number, r: any) => a + num(r.receiptAmount), 0)),
    };
    const salarySummary: any[] = await p.$queryRawUnsafe(
      `SELECT "periodLabel" as name, COUNT(*) as employees, COALESCE(SUM("total"),0) as total
       FROM "Salary" WHERE COALESCE("deletedAt",'')='' AND "payDate">=? AND "payDate"<=? GROUP BY "periodStart" ORDER BY "periodStart" DESC`, start, end);
    const debtors: any[] = await p.$queryRawUnsafe(
      `SELECT c."code", c."name", c."phone", c."openingBalance",
        (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE COALESCE(s."deletedAt",'')='' AND s."customerId"=c."id" AND s."paymentType"='credit') AS credit,
        (SELECT COALESCE(SUM(r."amount"),0) FROM "Receipt" r WHERE COALESCE(r."deletedAt",'')='' AND r."customerId"=c."id" AND ${receiptDebtSql('r."sourceName"')}) AS paid
       FROM "Customer" c ORDER BY c."name"`);
    const debts = debtors
      .map((d) => ({
        code: d.code, name: d.name, phone: d.phone,
        balance: r2(num(d.openingBalance) + num(d.credit) - num(d.paid)),
      }))
      .filter((d) => Math.abs(d.balance) > 0.001)
      .sort((a, b) => b.balance - a.balance);
    return {
      from: start, to: end, calendar: mode,
      byMaterial, byCustomer, byCategory, byPayer, byContractor, salarySummary,
      byRelated, relatedTotals,
      debtors: debts, debtTotal: r2(debts.reduce((a, d) => a + d.balance, 0)),
    };
  }

  /** Dashboard cards. */
  @Get('dashboard')
  async dashboard() {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const today = todayISO();
    const t = await this.dayFigures(today);
    const mStart = startOfMonth(today, mode);
    const mEnd = endOfMonth(today, mode);
    const p = db();
    const monthSales: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("total"),0) t, COALESCE(SUM("volume"),0) v FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, mStart, mEnd);
    const monthExp: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("amountAfn"),0) t FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=?`, mStart, mEnd);
    const monthSal: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("total"),0) t FROM "Salary" WHERE COALESCE("deletedAt",'')='' AND "payDate">=? AND "payDate"<=?`, mStart, mEnd);
    const debts: any[] = await p.$queryRawUnsafe(
      `SELECT c."id", c."code", c."name",
        c."openingBalance" + (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE COALESCE(s."deletedAt",'')='' AND s."customerId"=c."id" AND s."paymentType"='credit')
        - (SELECT COALESCE(SUM(r."amount"),0) FROM "Receipt" r WHERE COALESCE(r."deletedAt",'')='' AND r."customerId"=c."id" AND ${receiptDebtSql('r."sourceName"')}) AS balance
       FROM "Customer" c`);
    const debtList = debts.map((d) => ({ ...d, balance: r2(num(d.balance)) })).sort((a, b) => b.balance - a.balance);
    const emp: any[] = await p.$queryRawUnsafe(
      `SELECT COUNT(*) c FROM "Employee" WHERE COALESCE("deletedAt",'')='' AND "status"='active'`);
    const cust: any[] = await p.$queryRawUnsafe(
      `SELECT COUNT(*) c FROM "Customer" WHERE COALESCE("deletedAt",'')=''`);
    const salaryPending: any[] = await p.$queryRawUnsafe(
      `SELECT COUNT(*) c FROM "Salary" WHERE COALESCE("deletedAt",'')='' AND "periodStart"=?`, mStart);
    /*
     * ⚠ باگ واقعی (که تست «سناریو» گرفت): ترتیب `ORDER BY … LIMIT … WHERE …`
     * در SQLite خطای نحوی است، پس این کوئری همیشه می‌شکست → `dashboard`
     * استثنا می‌داد → داشبورد «undefined» برمی‌گرداند و برگه‌ی داشبورد خالی
     * می‌ماند. ترتیب درست: WHERE → ORDER BY → LIMIT.
     */
    const recent: any[] = await p.$queryRawUnsafe(
      `SELECT "no","date","customerName","materialName","volume","total","paymentType"
         FROM "Sale" WHERE COALESCE("deletedAt",'')=''
        ORDER BY "id" DESC LIMIT 7`);
    /*
     * کارایی: قبلاً برای هر یک از ۱۴ روز، `dayFigures` صدا زده می‌شد و هر
     * بار **۴ کوئری + ۲ کوئری تنظیمات** اجرا می‌شد — یعنی ۸۴ رفت‌وبرگشت به
     * دیتابیس برای یک نمودار. حالا همان ۱۴ روز با ۴ کوئری گروهی خوانده
     * می‌شوند (روی ماشین کند/دیسک قدیمی تفاوت کاملاً محسوس است).
     */
    const chartDays: string[] = [];
    for (let i = 13; i >= 0; i--) chartDays.push(addDays(today, -i));
    const chartStart = chartDays[0];
    const q = (sql: string, ...args: any[]) => p.$queryRawUnsafe(sql, ...args);
    const [sellRows, rcptRows, expRows, salRows] = await Promise.all([
      q(
        `SELECT "date" d,
           COALESCE(SUM(CASE WHEN "paymentType"='cash' THEN "total" ELSE 0 END),0) cash,
           COALESCE(SUM(CASE WHEN "paymentType"='credit' THEN "total" ELSE 0 END),0) credit
         FROM "Sale" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "date"`,
        chartStart, today,
      ) as Promise<any[]>,
      q(
        `SELECT "date" d, COALESCE(SUM(CASE WHEN NOT (${receiptDebtSql('"sourceName"')}) THEN 0 ELSE "amount" END),0) t
         FROM "Receipt" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "date"`,
        chartStart, today,
      ) as Promise<any[]>,
      q(
        `SELECT "date" d, COALESCE(SUM("amountAfn"),0) t
         FROM "Expense" WHERE COALESCE("deletedAt",'')='' AND "date">=? AND "date"<=? GROUP BY "date"`,
        chartStart, today,
      ) as Promise<any[]>,
      q(
        `SELECT "payDate" d, COALESCE(SUM("total"),0) t
         FROM "Salary" WHERE COALESCE("deletedAt",'')='' AND "payDate">=? AND "payDate"<=? GROUP BY "payDate"`,
        chartStart, today,
      ) as Promise<any[]>,
    ]);
    const byDate = (rows: any[]) => {
      const m = new Map<string, number>();
      for (const r of rows || []) m.set(String(r.d), num(r.t));
      return m;
    };
    const sellMap = new Map<string, any>();
    for (const r of sellRows || []) sellMap.set(String(r.d), r);
    /* رسیدات در نمودار ۱۴ روزه نمایش داده نمی‌شود (ستون‌های cash/credit/expenses) */
    void rcptRows;
    const expMap = byDate(expRows);
    const salMap = byDate(salRows);

    const chart = chartDays.map((d) => {
      const s1 = sellMap.get(d);
      return {
        date: d,
        label: formatDate(d, mode, true),
        cash: r2(num(s1?.cash)),
        credit: r2(num(s1?.credit)),
        /* همان تعریف «مصارف روز» در dayFigures: مصرف + معاش (بدون امانت) */
        expenses: r2((expMap.get(d) ?? 0) + (salMap.get(d) ?? 0)),
      };
    });
    return {
      calendar: mode,
      today: { ...t, label: formatDate(today, mode, true) },
      month: {
        label: `${monthBucket(today, mode).label}`,
        sales: r2(num(monthSales[0]?.t)),
        volume: r2(num(monthSales[0]?.v)),
        expenses: r2(num(monthExp[0]?.t)),
        salaries: r2(num(monthSal[0]?.t)),
        profit: r2(num(monthSales[0]?.t) - num(monthExp[0]?.t) - num(monthSal[0]?.t)),
      },
      debtTotal: r2(debtList.reduce((a, d) => a + Math.max(0, d.balance), 0)),
      debtors: debtList.filter((d) => d.balance > 0).slice(0, 6),
      counts: {
        employees: num(emp[0]?.c), customers: num(cust[0]?.c),
        salaryDoneThisMonth: num(salaryPending[0]?.c),
      },
      recentSales: recent.map((r) => ({ ...r, dateDisplay: formatDate(r.date, mode) })),
      chart,
    };
  }
}
