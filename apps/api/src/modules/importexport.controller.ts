import { Body, Controller, Get, Post, Query, UseGuards, HttpException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { logActivity } from '../common/activity';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard } from '../common/auth';
import { settingsService } from '../common/settings';
import { formatDate, CalendarMode } from '../common/calendar';

const EXPORTS: Record<string, { title: string; sql: string; map?: (r: any, mode: CalendarMode) => any[] }> = {
  employees: {
    title: 'کارمندان',
    sql: `SELECT * FROM "Employee" ORDER BY "code"`,
    map: (r, mode) => [
      r.code, r.name, r.fatherName, r.position, formatDate(r.hireDate, mode),
      r.baseSalary, r.phone, r.nationalId, r.address, r.contractPeriod,
      r.status === 'active' ? 'فعال' : 'غیر فعال', r.note,
    ],
  },
  customers: {
    title: 'مشتریان',
    sql: `SELECT c.*,
      (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE s."customerId"=c."id" AND s."paymentType"='credit') AS credit,
      (SELECT COALESCE(SUM(r."amount"),0) FROM "Receipt" r WHERE r."customerId"=c."id" AND COALESCE(r."sourceName",'')<>'امانت') AS paid
      FROM "Customer" c ORDER BY c."code"`,
    map: (r) => [r.code, r.name, r.contactPerson, r.phone, r.truckPlate,
      Math.round(((Number(r.openingBalance) || 0) + (Number(r.credit) || 0) - (Number(r.paid) || 0)) * 100) / 100, r.note],
  },
  sales: {
    title: 'فروشات',
    sql: `SELECT * FROM "Sale" ORDER BY "date", "id"`,
    map: (r, mode) => [
      r.no, formatDate(r.date, mode), r.customerName, r.driverName, r.truckPlate, r.destination,
      r.materialName, r.volume, r.unitPrice, r.freightPerUnit, r.freightTotal, r.total,
      r.contractorName, r.paymentType === 'cash' ? 'نقده' : 'باقی', r.note,
    ],
  },
  receipts: {
    title: 'رسیدات',
    sql: `SELECT * FROM "Receipt" ORDER BY "date", "id"`,
    map: (r, mode) => [r.no, formatDate(r.date, mode), r.customerName, r.amount, r.relatedBillNo, r.sourceName, r.receivedBy, r.note],
  },
  expenses: {
    title: 'مصارف',
    sql: `SELECT * FROM "Expense" ORDER BY "date", "id"`,
    map: (r, mode) => [
      r.no, formatDate(r.date, mode), r.description, r.categoryName, r.contractorName,
      r.purchaseBillNo, r.shopName, r.amountAfn, r.amountUsd, r.payerName,
      r.paymentType === 'cash' ? 'نقده' : 'باقی', r.note,
    ],
  },
  salaries: {
    title: 'معاشات',
    sql: `SELECT * FROM "Salary" ORDER BY "periodStart" DESC, "employeeName"`,
    map: (r, mode) => [
      r.no, r.periodLabel, r.employeeName, r.baseSalary, r.bonus, r.penalty, r.overtimeAmount,
      r.total, r.payerName, r.paymentType === 'cash' ? 'نقد' : 'حواله', formatDate(r.payDate, mode),
    ],
  },
  attendance: {
    title: 'حضور و غیاب',
    sql: `SELECT a.*, e."name" as empName, e."code" as empCode FROM "Attendance" a JOIN "Employee" e ON e."id"=a."employeeId" ORDER BY a."date" DESC`,
    map: (r, mode) => [
      formatDate(r.date, mode), r.empCode, r.empName,
      { present: 'حاضر', absent: 'غایب', leave: 'رخصت', sick: 'مریض', official_holiday: 'رخصتی', friday: 'جمعه' }[r.status] || r.status,
      r.checkIn, r.checkOut, r.overtime, r.note,
    ],
  },
};

export const EXPORT_HEADERS: Record<string, string[]> = {
  employees: ['کد', 'نام', 'نام پدر', 'وظیفه', 'تاریخ استخدام', 'معاش ثابت', 'شماره تماس', 'شماره تذکره', 'آدرس', 'مدت قرارداد', 'وضعیت', 'توضیحات'],
  customers: ['کد مشتری', 'نام مشتری/شرکت', 'شخص رابط', 'شماره تماس', 'پلیت موتر', 'باقی مانده بدهی', 'توضیحات'],
  sales: ['شماره بل', 'تاریخ', 'نام مشتری', 'نام دریور', 'پلیت موتر', 'مقصد', 'نوع مواد', 'متراژ', 'قیمت فی متر', 'کرایه فی متر', 'مجموع کرایه', 'مجموع قیمت و کرایه', 'مربوط', 'نوع پرداخت', 'توضیحات'],
  receipts: ['شماره رسید', 'تاریخ', 'نام مشتری', 'مبلغ رسید', 'شماره بل مربوط', 'از درک', 'توسط', 'توضیحات'],
  expenses: ['شماره', 'تاریخ', 'شرح', 'نوع مصرف', 'مربوط', 'نمبر بل خرید', 'نام فروشگاه', 'مبلغ افغانی', 'مبلغ دالری', 'پرداخت کننده', 'روش پرداخت', 'توضیحات'],
  salaries: ['شماره', 'ماه/سال', 'نام کارمند', 'معاش ثابت', 'پاداش', 'جریمه', 'اضافه کاری', 'مجموع پرداخت', 'پرداخت کننده', 'نوع پرداخت', 'تاریخ پرداخت'],
  attendance: ['تاریخ', 'کد کارمند', 'نام', 'وضعیت', 'ساعت ورود', 'ساعت خروج', 'اضافه کاری', 'توضیحات'],
};

/** Proper UTF-8 CSV with BOM so Excel opens Persian text correctly. */
export function toCsv(headers: string[], rows: any[][]): string {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  return '\uFEFF' + lines.join('\r\n');
}

@UseGuards(AuthGuard)
@Controller('export')
export class ExportController {
  @Get()
  async csv(@Query('type') type: string, @Res() res: Response) {
    await ensureSchemaAsync();
    const cfg = EXPORTS[type];
    if (!cfg) throw new HttpException('نوع خروجی ناشناخته است.', 400);
    const mode = await settingsService.calendar();
    const rows: any[] = await db().$queryRawUnsafe(cfg.sql);
    const data = rows.map((r) => (cfg.map ? cfg.map(r, mode) : Object.values(r)));
    const csv = toCsv(EXPORT_HEADERS[type], data);
    const filename = `${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    await logActivity({ action: 'export', entity: type, detail: `${data.length} ردیف` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
