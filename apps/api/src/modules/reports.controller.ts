import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard } from '../common/auth';
import { settingsService } from '../common/settings';
import {
  CalendarMode, monthBucket, yearBucket, todayISO, formatDate, monthName, pad2,
  toCalendar, fromCalendar, startOfMonth, endOfMonth, startOfYear, endOfYear, daysBetween, addDays,
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
       FROM "Sale" WHERE "date"=?`, dateISO);
    const receipts: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("amount"),0) AS total,
        COALESCE(SUM(CASE WHEN COALESCE("sourceName",'')='امانت' THEN "amount" ELSE 0 END),0) AS trust
       FROM "Receipt" WHERE "date"=?`, dateISO);
    const expenses: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("amountAfn"),0) AS afn, COALESCE(SUM("amountUsd"),0) AS usd,
        COALESCE(SUM(CASE WHEN "paymentType"='cash' AND "payerName"='دخل' THEN "amountAfn" ELSE 0 END),0) AS cashFromBox,
        COALESCE(SUM(CASE WHEN "paymentType"='credit' THEN "amountAfn" ELSE 0 END),0) AS credit
       FROM "Expense" WHERE "date"=?`, dateISO);
    const salaries: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("total"),0) AS total,
        COALESCE(SUM(CASE WHEN "paymentType"='cash' AND "payerName"='دخل' THEN "total" ELSE 0 END),0) AS cashFromBox
       FROM "Salary" WHERE "payDate"=?`, dateISO);

    const cashSales = num(s[0]?.cashSales);
    const creditSales = num(s[0]?.creditSales);
    const receiptTotal = num(receipts[0]?.total);
    const receiptTrust = num(receipts[0]?.trust);
    const expenseAfn = num(expenses[0]?.afn);
    const salaryTotal = num(salaries[0]?.total);
    const totalOut = expenseAfn + salaryTotal;

    const cashIn = cashMode === 'accurate'
      ? cashSales + (receiptTotal - receiptTrust)
      : cashSales + receiptTotal;
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

  @Get('daily')
  async daily(@Query('from') from?: string, @Query('to') to?: string) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const today = todayISO();
    const start = from ? (from.match(/^\d{4}-\d{2}-\d{2}$/) ? from : startOfMonth(today, mode)) : startOfMonth(today, mode);
    const end = to ? (to.match(/^\d{4}-\d{2}-\d{2}$/) ? to : endOfMonth(today, mode)) : endOfMonth(today, mode);
    const days = daysBetween(start, end).reverse(); // newest first
    const rows = [];
    let running = 0;
    // running cash starts at the beginning of the range
    for (const d of [...days].reverse()) {
      const f = await this.dayFigures(d);
      running += f.cashBalance;
      rows.push({ ...f, runningCash: r2(running) });
    }
    rows.reverse();
    const totals = rows.reduce<Row>((a, r: any) => {
      a.creditSales += r.creditSales; a.cashSales += r.cashSales; a.receipts += r.receipts;
      a.expensesAfn += r.expensesAfn; a.salaries += r.salaries; a.totalExpenses += r.totalExpenses;
      a.cashBalance += r.cashBalance; return a;
    }, { creditSales: 0, cashSales: 0, receipts: 0, expensesAfn: 0, salaries: 0, totalExpenses: 0, cashBalance: 0 });
    return { from: start, to: end, calendar: mode, rows, totals, mode };
  }

  @Get('monthly')
  async monthly(@Query('year') year?: string) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const y = Number(year) || toCalendar(todayISO(), mode).jy;
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const start = fromCalendar(y, m, 1, mode);
      const end = mode === 'jalali'
        ? fromCalendar(y, m, m <= 6 ? 31 : m <= 11 ? 30 : (isLeapJalali(y) ? 30 : 29), mode)
        : fromCalendar(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate(), mode);
      const p = db();
      const s: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM(CASE WHEN "paymentType"='cash' THEN "total" ELSE 0 END),0) cash,
                COALESCE(SUM(CASE WHEN "paymentType"='credit' THEN "total" ELSE 0 END),0) credit,
                COALESCE(SUM("volume"),0) volume FROM "Sale" WHERE "date">=? AND "date"<=?`, start, end);
      const r: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amount"),0) t FROM "Receipt" WHERE "date">=? AND "date"<=?`, start, end);
      const e: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amountAfn"),0) afn, COALESCE(SUM("amountUsd"),0) usd FROM "Expense" WHERE "date">=? AND "date"<=?`, start, end);
      const sa: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("total"),0) t FROM "Salary" WHERE "payDate">=? AND "payDate"<=?`, start, end);
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
    const salYears: any[] = await p.$queryRawUnsafe(
      `SELECT DISTINCT "year" as y FROM "Salary" ORDER BY "year" DESC`,
    );
    const currentYear = toCalendar(todayISO(), mode).jy;
    const years = Array.from(new Set<number>([currentYear, ...salYears.map((s) => Number(s.y))])).sort((a, b) => b - a);
    const rows = [];
    for (const y of years) {
      const start = fromCalendar(y, 1, 1, mode);
      const end = fromCalendar(y, 12, mode === 'jalali' ? (isLeapJalali(y) ? 30 : 29) : 31, mode);
      const s: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("total"),0) t FROM "Sale" WHERE "date">=? AND "date"<=?`, start, end);
      const e: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amountAfn"),0) afn, COALESCE(SUM("amountUsd"),0) usd FROM "Expense" WHERE "date">=? AND "date"<=?`, start, end);
      const sa: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("total"),0) t FROM "Salary" WHERE "payDate">=? AND "payDate"<=?`, start, end);
      const r: any[] = await p.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amount"),0) t FROM "Receipt" WHERE "date">=? AND "date"<=?`, start, end);
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

  /** Cash-book movement (حرکت دخل) for a range. */
  @Get('cashbook')
  async cashbook(@Query('from') from?: string, @Query('to') to?: string) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const today = todayISO();
    const start = from || startOfMonth(today, mode);
    const end = to || endOfMonth(today, mode);
    const p = db();
    const entries: any[] = [];
    const sales: any[] = await p.$queryRawUnsafe(
      `SELECT "no","date","customerName","total" FROM "Sale" WHERE "date">=? AND "date"<=? AND "paymentType"='cash'`, start, end);
    const receipts: any[] = await p.$queryRawUnsafe(
      `SELECT "no","date","customerName","amount","sourceName" FROM "Receipt" WHERE "date">=? AND "date"<=?`, start, end);
    const expenses: any[] = await p.$queryRawUnsafe(
      `SELECT "no","date","description","amountAfn","payerName","paymentType" FROM "Expense" WHERE "date">=? AND "date"<=?`, start, end);
    const salaries: any[] = await p.$queryRawUnsafe(
      `SELECT "no","payDate" as date,"employeeName","total","payerName","paymentType" FROM "Salary" WHERE "payDate">=? AND "payDate"<=?`, start, end);
    for (const s of sales) entries.push({ date: s.date, type: 'فروش نقده', doc: s.no, party: s.customerName, in: num(s.total), out: 0 });
    for (const r of receipts) entries.push({ date: r.date, type: `رسید (${r.sourceName || 'باقی داری'})`, doc: r.no, party: r.customerName, in: num(r.amount), out: 0 });
    for (const e of expenses) entries.push({ date: e.date, type: `مصرف${e.paymentType === 'credit' ? ' (باقی)' : ''} — ${e.payerName || ''}`, doc: e.no, party: e.description, in: 0, out: num(e.amountAfn) });
    for (const s2 of salaries) entries.push({ date: s2.date, type: `معاش (${s2.paymentType === 'hawala' ? 'حواله' : 'نقد'})`, doc: s2.no, party: s2.employeeName, in: 0, out: num(s2.total) });
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.doc).localeCompare(String(b.doc))));
    let bal = 0;
    const rows = entries.map((e) => {
      bal += e.in - e.out;
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
    const p = db();
    const q = async (sql: string) => (await p.$queryRawUnsafe(sql, start, end)) as any[];
    const byMaterial = await q(
      `SELECT "materialName" as name, COUNT(*) as docs, COALESCE(SUM("volume"),0) as volume,
              COALESCE(SUM("total"),0) as total, COALESCE(SUM("freightTotal"),0) as freight
       FROM "Sale" WHERE "date">=? AND "date"<=? GROUP BY "materialName" ORDER BY total DESC`);
    const byCustomer = await q(
      `SELECT "customerName" as name, COUNT(*) as docs, COALESCE(SUM("volume"),0) as volume,
              COALESCE(SUM("total"),0) as total,
              COALESCE(SUM(CASE WHEN "paymentType"='credit' THEN "total" ELSE 0 END),0) as credit
       FROM "Sale" WHERE "date">=? AND "date"<=? GROUP BY "customerName" ORDER BY total DESC`);
    const byCategory = await q(
      `SELECT "categoryName" as name, COUNT(*) as docs, COALESCE(SUM("amountAfn"),0) as afn, COALESCE(SUM("amountUsd"),0) as usd
       FROM "Expense" WHERE "date">=? AND "date"<=? GROUP BY "categoryName" ORDER BY afn DESC`);
    const byPayer = await q(
      `SELECT "payerName" as name, COUNT(*) as docs, COALESCE(SUM("amountAfn"),0) as afn
       FROM "Expense" WHERE "date">=? AND "date"<=? GROUP BY "payerName" ORDER BY afn DESC`);
    const byContractor = await q(
      `SELECT "contractorName" as name, COUNT(*) as docs, COALESCE(SUM("freightTotal"),0) as freight
       FROM "Sale" WHERE "date">=? AND "date"<=? AND COALESCE("contractorName",'') <> '' GROUP BY "contractorName" ORDER BY freight DESC`);
    const salarySummary: any[] = await p.$queryRawUnsafe(
      `SELECT "periodLabel" as name, COUNT(*) as employees, COALESCE(SUM("total"),0) as total
       FROM "Salary" WHERE "payDate">=? AND "payDate"<=? GROUP BY "periodStart" ORDER BY "periodStart" DESC`, start, end);
    const debtors: any[] = await p.$queryRawUnsafe(
      `SELECT c."code", c."name", c."phone", c."openingBalance",
        (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE s."customerId"=c."id" AND s."paymentType"='credit') AS credit,
        (SELECT COALESCE(SUM(r."amount"),0) FROM "Receipt" r WHERE r."customerId"=c."id" AND COALESCE(r."sourceName",'')<>'امانت') AS paid
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
      `SELECT COALESCE(SUM("total"),0) t, COALESCE(SUM("volume"),0) v FROM "Sale" WHERE "date">=? AND "date"<=?`, mStart, mEnd);
    const monthExp: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("amountAfn"),0) t FROM "Expense" WHERE "date">=? AND "date"<=?`, mStart, mEnd);
    const monthSal: any[] = await p.$queryRawUnsafe(
      `SELECT COALESCE(SUM("total"),0) t FROM "Salary" WHERE "payDate">=? AND "payDate"<=?`, mStart, mEnd);
    const debts: any[] = await p.$queryRawUnsafe(
      `SELECT c."id", c."code", c."name",
        c."openingBalance" + (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE s."customerId"=c."id" AND s."paymentType"='credit')
        - (SELECT COALESCE(SUM(r."amount"),0) FROM "Receipt" r WHERE r."customerId"=c."id" AND COALESCE(r."sourceName",'')<>'امانت') AS balance
       FROM "Customer" c`);
    const debtList = debts.map((d) => ({ ...d, balance: r2(num(d.balance)) })).sort((a, b) => b.balance - a.balance);
    const emp: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "Employee" WHERE "status"='active'`);
    const cust: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "Customer"`);
    const salaryPending: any[] = await p.$queryRawUnsafe(
      `SELECT COUNT(*) c FROM "Salary" WHERE "periodStart"=?`, mStart);
    const recent: any[] = await p.$queryRawUnsafe(
      `SELECT "no","date","customerName","materialName","volume","total","paymentType" FROM "Sale" ORDER BY "id" DESC LIMIT 7`);
    const chart = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(today, -i);
      const f = await this.dayFigures(d);
      chart.push({ date: d, label: f.dateDisplay, cash: f.cashSales, credit: f.creditSales, expenses: f.totalExpenses });
    }
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

function isLeapJalali(y: number): boolean {
  // 33-year cycle approximation is accurate enough for display purposes
  const mod = y % 33;
  return [1, 5, 9, 13, 17, 22, 26, 30].includes(mod);
}
