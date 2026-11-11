import { Body, Controller, Get, Param, Post, Query, UseGuards, HttpException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { logActivity } from '../common/activity';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { settingsService } from '../common/settings';
import { formatDate, CalendarMode } from '../common/calendar';
import { toCsv, parseCsv, normalizeNumber } from '../common/csv';
import { canonicalReceiptSource, receiptDebtSql } from '../common/domain';

/**
 * خروجی و **ورودی** اکسل (CSV).
 *
 * ## باگ‌هایی که در بازبینی پیدا شد
 *   ۱) دکمه‌ی «اکسل» در پنج صفحه کار نمی‌کرد: آدرس `/export` صدا زده می‌شد
 *      ولی سرور پیشوند `/api` دارد → همه‌ی آن دکمه‌ها ۴۰۴ می‌گرفتند.
 *   ۲) فایل با کاما و بدون BOM ساخته می‌شد؛ اکسل فارسی همه‌ی ستون‌ها را در
 *      یک ستون می‌ریخت و متن فارسی به‌هم‌ریخته نمایش داده می‌شد.
 *   ۳) ورودی از اکسل **وجود نداشت** (نه مسیر، نه نمونه).
 *
 * حالا هر دو نوع فایل داده می‌شود:
 *   • `csv`  — سبک، با BOM و `sep=,` (اکسل قطعاً درست باز می‌کند)
 *   • `xls`  — فایل HTML با پسوند `.xls`؛ اکسل آن را به‌عنوان **کارپوشه‌ی
 *              واقعی** باز می‌کند و ستون‌ها/اعداد را جدا نگه می‌دارد. هیچ
 *              کتابخانه‌ی بیرونی لازم نیست، پس ساخت آفلاین نمی‌شکند.
 */

type ExportDef = {
  title: string;
  /** نام شیت در فایل اکسل */
  sheet: string;
  sql: string;
  headers: string[];
  /** ستون‌هایی که عددند (برای فایل اکسل تا به‌صورت عدد ذخیره شوند) */
  numeric?: number[];
  /** ستون تاریخ — برای خروجی «محدوده‌ی تاریخ» (راپور تفصیلی) */
  dateCol?: string;
  map: (r: any, mode: CalendarMode) => any[];
};

/**
 * فیلتر بازه‌ی تاریخ روی کوئری خروجی.
 *
 * باگ کاربر: در «راپور تفصیلی» دکمه‌ی «خروجی» فایل **همه‌ی سال‌ها** را
 * می‌داد، نه بازه‌ای که روی صفحه انتخاب شده بود؛ جمع ستون‌ها با جدول
 * نمی‌خواند. حالا اگر بازه داده شود، همان بازه اعمال می‌شود.
 *
 * ستون تاریخ هر نوع فرق دارد (`date` / `payDate`)، پس صریح اعلام می‌شود؛
 * نوعی که تاریخ ندارد (ماشینری) بازه را نادیده می‌گیرد و همان قبلی می‌ماند.
 */
function withDateRange(sql: string, dateCol: string | undefined, from?: string, to?: string): { sql: string; args: any[] } {
  if (!dateCol || (!from && !to)) return { sql, args: [] };
  /*
   * `dateCol` می‌تواند `a."date"` باشد (کوئری JOIN‌دار)، پس فقط ستون‌های
   * ساده را خودمان نقل‌قول می‌گذاریم. نام ستون از کد می‌آید، نه از ورودی
   * کاربر — پس تزریق ممکن نیست.
   */
  const col = /[."]/.test(dateCol) ? dateCol : `"${dateCol}"`;
  const cond: string[] = [];
  const args: any[] = [];
  if (from) { cond.push(`${col} >= ?`); args.push(from); }
  if (to) { cond.push(`${col} <= ?`); args.push(to); }
  /*
   * شرط را «داخل» کوئری می‌گذاریم، نه دور آن: `ORDER BY` باید بیرون بماند
   * وگرنه ترتیب فهرست به‌هم می‌ریزد.
   */
  const idx = sql.lastIndexOf(' ORDER BY ');
  const head = idx === -1 ? sql : sql.slice(0, idx);
  const tail = idx === -1 ? '' : sql.slice(idx);
  const glue = /\bWHERE\b/i.test(head) ? ' AND ' : ' WHERE ';
  return { sql: `${head}${glue}${cond.join(' AND ')}${tail}`, args };
}

const EXPORTS: Record<string, ExportDef> = {
  employees: {
    title: 'کارمندان',
    sheet: 'Employees',
    sql: `SELECT * FROM "Employee" WHERE COALESCE("deletedAt",'')='' ORDER BY "code"`,
    headers: ['کد', 'نام', 'نام پدر', 'وظیفه', 'تاریخ استخدام', 'معاش ثابت', 'شماره تماس', 'شماره تذکره', 'آدرس', 'مدت قرارداد', 'وضعیت', 'توضیحات'],
    numeric: [5],
    map: (r, mode) => [
      r.code, r.name, r.fatherName, r.position, formatDate(r.hireDate, mode),
      r.baseSalary, r.phone, r.nationalId, r.address, r.contractPeriod,
      r.status === 'active' ? 'فعال' : 'غیر فعال', r.note,
    ],
  },
  customers: {
    title: 'مشتریان',
    sheet: 'Customers',
    sql: `SELECT c.*,
      (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE s."customerId"=c."id" AND s."paymentType"='credit') AS credit,
      (SELECT COALESCE(SUM(r."amount"),0) FROM "Receipt" r WHERE r."customerId"=c."id" AND ${receiptDebtSql('r."sourceName"')}) AS paid
      FROM "Customer" c WHERE COALESCE(c."deletedAt",'')='' AND COALESCE(c."isWalkIn",0)=0 ORDER BY c."code"`,
    headers: ['کد مشتری', 'نام مشتری/شرکت', 'شخص رابط', 'شماره تماس', 'پلیت موتر', 'باقی مانده بدهی', 'توضیحات'],
    numeric: [5],
    map: (r) => [r.code, r.name, r.contactPerson, r.phone, r.truckPlate,
      Math.round(((Number(r.openingBalance) || 0) + (Number(r.credit) || 0) - (Number(r.paid) || 0)) * 100) / 100, r.note],
  },
  sales: {
    title: 'فروشات',
    sheet: 'Sales',
    sql: `SELECT * FROM "Sale" WHERE COALESCE("deletedAt",'')='' ORDER BY "date", "id"`,
    headers: ['شماره بل', 'تاریخ', 'نام مشتری', 'نام دریور', 'پلیت موتر', 'مقصد', 'نوع مواد', 'متراژ', 'قیمت فی متر', 'کرایه فی متر', 'مجموع کرایه', 'مجموع قیمت و کرایه', 'مربوط (شاخه مصرف)', 'نوع پرداخت', 'توضیحات'],
    numeric: [7, 8, 9, 10, 11],
    dateCol: 'date',
    map: (r, mode) => [
      r.no, formatDate(r.date, mode), r.customerName, r.driverName, r.truckPlate, r.destination,
      r.materialName, r.volume, r.unitPrice, r.freightPerUnit, r.freightTotal, r.total,
      r.contractorName, r.paymentType === 'cash' ? 'نقده' : 'باقی', r.note,
    ],
  },
  receipts: {
    title: 'رسیدات',
    sheet: 'Receipts',
    sql: `SELECT * FROM "Receipt" WHERE COALESCE("deletedAt",'')='' ORDER BY "date", "id"`,
    headers: ['شماره رسید', 'تاریخ', 'نام مشتری', 'مبلغ رسید', 'شماره بل مربوط', 'از درک', 'توسط', 'توضیحات'],
    numeric: [3],
    dateCol: 'date',
    map: (r, mode) => [r.no, formatDate(r.date, mode), r.customerName, r.amount, r.relatedBillNo,
      canonicalReceiptSource(r.sourceName), r.receivedBy, r.note],
  },
  expenses: {
    title: 'مصارف',
    sheet: 'Expenses',
    sql: `SELECT * FROM "Expense" WHERE COALESCE("deletedAt",'')='' ORDER BY "date", "id"`,
    headers: ['شماره', 'تاریخ', 'شرح', 'نوع مصرف', 'مربوط (شاخه مصرف)', 'نمبر بل خرید', 'نام فروشگاه', 'مبلغ افغانی', 'مبلغ دالری', 'پرداخت کننده', 'روش پرداخت', 'توضیحات'],
    numeric: [7, 8],
    dateCol: 'date',
    map: (r, mode) => [
      r.no, formatDate(r.date, mode), r.description, r.categoryName, r.contractorName,
      r.purchaseBillNo, r.shopName, r.amountAfn, r.amountUsd, r.payerName,
      r.paymentType === 'cash' ? 'نقده' : 'باقی', r.note,
    ],
  },
  salaries: {
    title: 'معاشات',
    sheet: 'Salaries',
    sql: `SELECT * FROM "Salary" WHERE COALESCE("deletedAt",'')='' ORDER BY "periodStart" DESC, "employeeName"`,
    headers: ['شماره', 'ماه/سال', 'نام کارمند', 'معاش ثابت', 'پاداش', 'جریمه', 'اضافه کاری', 'مجموع پرداخت', 'پرداخت کننده', 'نوع پرداخت', 'تاریخ پرداخت'],
    numeric: [3, 4, 5, 6, 7],
    dateCol: 'payDate',
    map: (r, mode) => [
      r.no, r.periodLabel, r.employeeName, r.baseSalary, r.bonus, r.penalty, r.overtimeAmount,
      r.total, r.payerName, r.paymentType === 'cash' ? 'نقد' : 'حواله', formatDate(r.payDate, mode),
    ],
  },
  attendance: {
    title: 'حضور و غیاب',
    sheet: 'Attendance',
    sql: `SELECT a.*, e."name" as empName, e."code" as empCode FROM "Attendance" a JOIN "Employee" e ON e."id"=a."employeeId" WHERE COALESCE(a."deletedAt",'')='' ORDER BY a."date" DESC`,
    headers: ['تاریخ', 'کد کارمند', 'نام', 'وضعیت', 'ساعت ورود', 'ساعت خروج', 'اضافه کاری', 'توضیحات'],
    numeric: [6],
    /* حضور و غیاب جدول JOIN دارد؛ نام ستون باید صریح باشد (a."date") */
    dateCol: 'a."date"',
    map: (r, mode) => [
      formatDate(r.date, mode), r.empCode, r.empName,
      { present: 'حاضر', absent: 'غایب', leave: 'رخصت', sick: 'مریض', official_holiday: 'رخصتی', friday: 'جمعه' }[r.status] || r.status,
      r.checkIn, r.checkOut, r.overtime, r.note,
    ],
  },
};

/** سازگاری با نسخه‌ی قبلی (تست‌ها/کدهای دیگر از این‌ها استفاده می‌کنند) */
export const EXPORT_HEADERS: Record<string, string[]> = Object.fromEntries(
  Object.entries(EXPORTS).map(([k, v]) => [k, v.headers]),
);

/* ------------------------------------------------------------------ */
/* فایل اکسل (HTML Workbook)                                          */
/* ------------------------------------------------------------------ */

/**
 * ساختن فایل `.xls` بدون هیچ کتابخانه‌ی بیرونی.
 *
 * چرا HTML و نه XLSX واقعی؟ XLSX یک ZIP از XML است؛ بدون `jszip`/`exceljs`
 * نمی‌شود ساخت. اکسل (و LibreOffice و WPS) فایل HTML با پسوند `.xls` و
 * `mso-application` را **کارپوشه‌ی کامل** باز می‌کند — با ستون‌ها، اعداد
 * راست‌چین و متن فارسی سالم. برای «خروجی گرفتن و باز کردن در اکسل» کافی و
 * مطمئن است، و صفر وابستگی دارد (شرط ساخت آفلاین).
 */
export function toExcelHtml(sheet: string, headers: string[], rows: unknown[][], numeric: number[] = []): string {
  const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const numCols = new Set(numeric);
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((r) => '<tr>' + r.map((c, i) => {
    /* کاربر ممکن است با «=» شروع شود → اکسل فرمول می‌بیند */
    const isNum = numCols.has(i) && c !== null && c !== undefined && c !== '' && Number.isFinite(Number(c));
    const style = isNum ? ' style="mso-number-format:\\@"' : ' style="mso-number-format:\\@"';
    return `<td${style}>${esc(c)}</td>`;
  }).join('') + '</tr>').join('');

  return `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${esc(sheet)}</x:Name>
<x:WorksheetOptions><x:DisplayRightToLeft/><x:Print><x:ValidPrinterInfo/></x:Print></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  table { border-collapse: collapse; font-family: Tahoma, 'Segoe UI', sans-serif; }
  th { background: #1f7a5c; color: #fff; font-weight: 700; padding: 6px 10px; border: 1px solid #14614a; }
  td { padding: 5px 10px; border: 1px solid #cfd8d4; }
  tr:nth-child(even) td { background: #f4f8f6; }
</style></head>
<body dir="rtl">
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* ورودی (import) — نمونه و ثبت                                        */
/* ------------------------------------------------------------------ */

type ImportDef = {
  title: string;
  headers: string[];
  /** راهنمای هر ستون — در فایل نمونه به‌عنوان سطر دوم نوشته می‌شود */
  hints?: string[];
  /** نمونه سطر */
  sample: string[];
  /**
   * آیا این نوع پیشنهاد می‌شود؟
   * فقط مشتری و کارمند ایمن‌اند (بدون اثر روی حساب‌ها). فروش/رسید/مصرف
   * عمداً وارد نمی‌شوند: یک «بل» با شماره و مبلغ دستی، مانده‌ی حساب مشتری
   * را بی‌سروصدا خراب می‌کند — برای این‌ها باید از فرم خودشان استفاده شود.
   */
  enabled: boolean;
  reasonIfDisabled?: string;
};

export const IMPORTS: Record<string, ImportDef> = {
  customers: {
    title: 'مشتریان',
    headers: ['نام مشتری/شرکت', 'شخص رابط', 'شماره تماس', 'پلیت موتر', 'باقی اولیه', 'توضیحات'],
    hints: ['اجباری', 'اختیاری', 'اختیاری', 'اختیاری', 'عدد', 'اختیاری'],
    sample: ['شرکت ساختمانی نور', 'احمد ولی', '0700123456', 'کابل ۱۲۳۴', '0', ''],
    enabled: true,
  },
  employees: {
    title: 'کارمندان',
    headers: ['نام', 'نام پدر', 'وظیفه', 'تاریخ استخدام', 'معاش ثابت', 'شماره تماس', 'شماره تذکره', 'آدرس', 'مدت قرارداد', 'توضیحات'],
    hints: ['اجباری', 'اختیاری', 'اختیاری', 'مثلاً ۱۴۰۴/۰۱/۱۵', 'عدد', 'اختیاری', 'اختیاری', 'اختیاری', 'اختیاری', 'اختیاری'],
    sample: ['محمد کریم', 'عبدالله', 'دیور', '۱۴۰۴/۰۱/۱۵', '15000', '0700111222', '1401-1234', 'کابل', '۱ سال', ''],
    enabled: true,
  },
  sales: {
    title: 'فروشات',
    headers: [],
    sample: [],
    enabled: false,
    reasonIfDisabled:
      'بل فروش به مشتری، موجودی و شماره‌ی سند گره خورده است؛ وارد کردن گروهی می‌تواند مانده‌ی حساب‌ها را بی‌سروصدا خراب کند. لطفاً از فرم «بل فروش» استفاده کنید (یا فایل اکسل را برای پشتیبانی بفرستید تا با بررسی وارد شود).',
  },
  receipts: { title: 'رسیدات', headers: [], sample: [], enabled: false, reasonIfDisabled: 'رسید، مانده‌ی حساب مشتری را تغییر می‌دهد؛ ورود گروهی باید با تأیید مالی انجام شود.' },
  expenses: { title: 'مصارف', headers: [], sample: [], enabled: false, reasonIfDisabled: 'مصارف روی صندوق و گزارش‌ها اثر می‌گذارد؛ از فرم «مصرف نو» استفاده کنید.' },
};

@UseGuards(AuthGuard)
@Controller('export')
export class ExportController {
  /**
   * خروجی — `format=csv` (پیش‌فرض) یا `format=xls`.
   *
   * ⚠ ترتیب: این مسیر (`@Get()`) **باید** قبل از `@Get('types')` بماند —
   * `routes.test.mjs` این را بررسی می‌کند. برعکسش باعث می‌شود `/export/types`
   * هرگز اجرا نشود، یا `types` به‌عنوان نوع خروجی تفسیر شود.
   */
  @Get()
  async download(
    @Query('type') type: string, @Query('format') format: string, @Query('delimiter') delimiter: string,
    /*
     * محدوده‌ی تاریخ — باگ کاربر: در «راپور تفصیلی» دکمه‌ی «خروجی» فایل
     * **همه‌ی سال‌ها** را می‌داد، نه بازه‌ای که روی صفحه انتخاب شده بود؛
     * جمع ستون‌ها با جدول نمی‌خواند و کاربر فکر می‌کرد راپور غلط است.
     * وقتی بازه داده شود، فقط اسناد همان بازه می‌آیند.
     */
    @Query('from') from: string, @Query('to') to: string,
    @Res() res: Response,
  ) {
    await ensureSchemaAsync();
    const cfg = EXPORTS[type];
    if (!cfg) throw new HttpException('نوع خروجی ناشناخته است.', 400);
    const mode = await settingsService.calendar();
    const ranged = withDateRange(cfg.sql, cfg.dateCol, from, to);
    const rows: any[] = (await db().$queryRawUnsafe(ranged.sql, ...ranged.args)) as any[];
    const data = rows.map((r) => cfg.map(r, mode));
    const stamp = new Date().toISOString().slice(0, 10);

    await logActivity({ action: 'export', entity: type, detail: `${data.length} ردیف (${format || 'csv'})` });

    if (format === 'xls' || format === 'excel') {
      const html = toExcelHtml(cfg.sheet, cfg.headers, data, cfg.numeric);
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-${stamp}.xls"; filename*=UTF-8''${encodeURIComponent(cfg.title)}-${stamp}.xls`);
      return res.send(html);
    }

    /*
     * CSV: `sep=,` در خط اول تا اکسل جداکننده را قطعی بفهمد. بدون آن، اکسل
     * در منطقه‌های فارسی «,» را جداکننده‌ی اعشار می‌بیند و همه‌چیز یک ستون
     * می‌شود. کاربر می‌تواند با `delimiter=;` جداکننده‌ی دیگر بخواهد.
     */
    const d = (delimiter === ';' || delimiter === 'tab' || delimiter === '\t') ? (delimiter === 'tab' || delimiter === '\t' ? '\t' : ';') : ',';
    const csv = toCsv(cfg.headers, data, { delimiter: d as any, sepLine: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(cfg.title)}-${stamp}.csv`);
    return res.send(csv);
  }

  /** فهرست انواع خروجی و قالب‌ها — برای منوی «خروجی» در UI */
  @Get('types')
  async types() {
    return {
      items: Object.entries(EXPORTS).map(([key, v]) => ({ key, title: v.title, headers: v.headers })),
      formats: [
        { key: 'csv', title: 'CSV (اکسل و برنامه‌های دیگر)' },
        { key: 'xls', title: 'Excel (.xls — کارپوشه)' },
      ],
    };
  }
}

/**
 * ورودی از اکسل.
 *
 * چرا کنترلر جدا: `POST /api/import/:type` و `GET /api/import/:type/template`
 * منطق متفاوتی از خروجی دارند و مخلوط کردنشان خواندن کد را سخت می‌کرد.
 */
@UseGuards(AuthGuard)
@Controller('import')
export class ImportController {
  /**
   * فهرست انواع ورودی + توضیح چرا بعضی‌ها پشتیبانی نمی‌شوند.
   *
   * ⚠ ترتیب: `@Get('types')` قبل از هیچ مسیر پارامتری نیامده چون این
   * کنترلر مسیر GET پارامتری ندارد؛ تنها مسیر پارامتری `POST :type` است
   * که متدش با GET فرق دارد، پس تعارضی نیست.
   */
  @Get('types')
  async types() {
    return {
      items: Object.entries(IMPORTS).map(([key, v]) => ({
        key, title: v.title, enabled: v.enabled, headers: v.headers,
        sample: v.sample, hints: v.hints, reason: v.reasonIfDisabled || '',
      })),
    };
  }

  /**
   * فایل نمونه — همان قالب خالی با یک سطر نمونه و یک سطر راهنما.
   * کاربر این را باز می‌کند، سطرها را پر می‌کند و برمی‌گرداند.
   */
  @Get('template')
  async template(@Query('type') type: string, @Query('format') format: string, @Res() res: Response) {
    const cfg = IMPORTS[type];
    if (!cfg || !cfg.enabled) throw new HttpException('برای این نوع، فایل نمونه وجود ندارد.', 400);
    const rows: string[][] = [];
    if (cfg.hints) rows.push(cfg.hints);
    rows.push(cfg.sample);

    if (format === 'xls' || format === 'excel') {
      const html = toExcelHtml(`Template-${type}`, cfg.headers, rows);
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="template-${type}.xls"`);
      return res.send(html);
    }
    const csv = toCsv(cfg.headers, rows, { sepLine: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="template-${type}.csv"`);
    return res.send(csv);
  }

  /**
   * انجام ورود.
   *
   * `dryRun` (پیش‌فرض `true`): فقط بررسی می‌کند و گزارش می‌دهد — هیچ چیزی
   * ذخیره نمی‌شود. این مهم است: کاربر باید **قبل از** ثبت ببیند چه چیزی
   * وارد می‌شود، چند سطر خطا دارد و چرا. ثبت واقعی فقط با `dryRun=false`.
   */
  @Post(':type')
  @ManagerOnly()
  async run(
    /*
     * ⚠ باگ واقعی (که تست دور ۱۶ گرفت): اینجا `@Query('type')` نوشته شده بود
     * در حالی که نوع از **مسیر** می‌آید (`POST /api/import/customers`). نتیجه:
     * `type` همیشه `undefined` بود و هر ورودی با «نوع ورودی ناشناخته است»
     * رد می‌شد — یعنی کل قابلیت ورود از اکسل مرده بود.
     */
    @Param('type') type: string,
    @Body() body: { csv?: string; dryRun?: boolean },
  ) {
    await ensureSchemaAsync();
    const cfg = IMPORTS[type];
    if (!cfg) throw new HttpException('نوع ورودی ناشناخته است.', 400);
    if (!cfg.enabled) throw new HttpException(cfg.reasonIfDisabled || 'این نوع ورودی پشتیبانی نمی‌شود.', 400);

    const text = String(body?.csv || '');
    if (!text.trim()) throw new HttpException('فایل خالی است.', 400);
    if (text.length > 4_000_000) throw new HttpException('فایل بیش از حد بزرگ است (بیشتر از ۴ مگابایت).', 400);

    const parsed = parseCsv(text);
    if (!parsed.rows.length) throw new HttpException('هیچ سطری در فایل نبود.', 400);

    /* آیا سطر اول سرستون است یا داده؟ با نام ستون‌ها تشخیص می‌دهیم */
    const first = parsed.rows[0].map((c) => c.replace(/\s+/g, ' ').trim());
    const isHeader = cfg.headers.every((h, i) => !first[i] || first[i] === h || h.includes(first[i]) || first[i].includes(h));
    const dataRows = isHeader ? parsed.rows.slice(1) : parsed.rows;

    /* سطر راهنما (فایل نمونه) را رد کن: اگر همه‌ی خانه‌ها یکی از واژه‌های راهنما باشند */
    const hintWords = new Set(['اجباری', 'اختیاری', 'عدد', 'مثلاً', 'تاریخ']);
    const cleaned = dataRows.filter((r) => !(r.length && r.every((c) => !c || hintWords.has(c))));

    const errors: string[] = [];
    const warnings: string[] = [...parsed.warnings];
    const prepared: any[] = [];

    const dryRun = body?.dryRun !== false;

    for (let i = 0; i < cleaned.length; i++) {
      const r = cleaned[i];
      const line = i + (isHeader ? 2 : 1);
      const cell = (idx: number) => (r[idx] || '').trim();

      if (type === 'customers') {
        const name = cell(0);
        if (!name) { errors.push(`سطر ${line}: نام مشتری خالی است.`); continue; }
        if (name.length > 160) { errors.push(`سطر ${line}: نام مشتری بیش از ۱۶۰ نویسه است.`); continue; }
        const balRaw = cell(4);
        const opening = balRaw ? normalizeNumber(balRaw) : 0;
        if (opening === null) { errors.push(`سطر ${line}: «باقی اولیه» عدد نیست («${balRaw}»).`); continue; }
        prepared.push({ name, contactPerson: cell(1), phone: cell(2), truckPlate: cell(3), openingBalance: opening, note: cell(5) });
      } else if (type === 'employees') {
        const name = cell(0);
        if (!name) { errors.push(`سطر ${line}: نام کارمند خالی است.`); continue; }
        const salRaw = cell(4);
        const baseSalary = salRaw ? normalizeNumber(salRaw) : 0;
        if (baseSalary === null) { errors.push(`سطر ${line}: «معاش ثابت» عدد نیست («${salRaw}»).`); continue; }
        if (baseSalary < 0) { errors.push(`سطر ${line}: معاش نمی‌تواند منفی باشد.`); continue; }
        prepared.push({
          name, fatherName: cell(1), position: cell(2), hireDate: cell(3),
          baseSalary, phone: cell(5), nationalId: cell(6), address: cell(7),
          contractPeriod: cell(8), note: cell(9),
        });
      }
    }

    /* تکراری‌ها را گزارش کن (هم داخل فایل، هم با دیتابیس) */
    const dupes: string[] = [];
    if (type === 'customers') {
      const existing: any[] = await db().$queryRawUnsafe(`SELECT "name" FROM "Customer" WHERE COALESCE("deletedAt",'')='' AND COALESCE("isWalkIn",0)=0`);
      const names = new Set(existing.map((e) => String(e.name).trim()));
      const seen = new Set<string>();
      for (const p of prepared) {
        const k = String(p.name).trim();
        if (seen.has(k)) dupes.push(`«${k}» در همین فایل تکرار شده — فقط اولی ثبت می‌شود.`);
        else if (names.has(k)) dupes.push(`«${k}» از قبل وجود دارد — رد می‌شود.`);
        seen.add(k);
      }
    } else if (type === 'employees') {
      const existing: any[] = await db().$queryRawUnsafe(`SELECT "name" FROM "Employee" WHERE COALESCE("deletedAt",'')=''`);
      const names = new Set(existing.map((e) => String(e.name).trim()));
      const seen = new Set<string>();
      for (const p of prepared) {
        const k = String(p.name).trim();
        if (seen.has(k)) dupes.push(`«${k}» در همین فایل تکرار شده — فقط اولی ثبت می‌شود.`);
        else if (names.has(k)) dupes.push(`«${k}» از قبل وجود دارد — رد می‌شود.`);
        seen.add(k);
      }
    }

    const unique = prepared.filter((p, idx) => {
      const k = String(p.name).trim();
      return prepared.findIndex((x) => String(x.name).trim() === k) === idx;
    });

    if (dryRun) {
      return {
        dryRun: true,
        total: cleaned.length,
        valid: unique.length,
        errors,
        warnings,
        duplicates: dupes,
        preview: unique.slice(0, 20),
        message: `${unique.length} سطر آماده‌ی ثبت است${errors.length ? `، ${errors.length} سطر خطا دارد` : ''}. هنوز چیزی ذخیره نشده.`,
      };
    }

    if (errors.length) {
      throw new HttpException(`فایل خطا دارد — ابتدا آن‌ها را درست کنید:\n${errors.slice(0, 8).join('\n')}`, 400);
    }

    let inserted = 0;
    const skipped: string[] = [];
    if (type === 'customers') {
      const existing: any[] = await db().$queryRawUnsafe(`SELECT "name","code" FROM "Customer" WHERE COALESCE("isWalkIn",0)=0`);
      const names = new Set(existing.map((e) => String(e.name).trim()));
      let nextNum = Math.max(0, ...existing.map((e) => Number(String(e.code).replace(/\D/g, '')) || 0)) + 1;
      for (const p of unique) {
        if (names.has(String(p.name).trim())) { skipped.push(p.name); continue; }
        const code = String(nextNum++).padStart(3, '0');
        await db().$executeRawUnsafe(
          `INSERT INTO "Customer" ("code","name","contactPerson","phone","truckPlate","openingBalance","note","createdAt") VALUES (?,?,?,?,?,?,?,datetime('now'))`,
          code, p.name, p.contactPerson, p.phone, p.truckPlate, p.openingBalance, p.note,
        );
        names.add(String(p.name).trim());
        inserted++;
      }
    } else if (type === 'employees') {
      const existing: any[] = await db().$queryRawUnsafe(`SELECT "name","code" FROM "Employee"`);
      const names = new Set(existing.map((e) => String(e.name).trim()));
      let nextNum = Math.max(0, ...existing.map((e) => Number(String(e.code).replace(/\D/g, '')) || 0)) + 1;
      for (const p of unique) {
        if (names.has(String(p.name).trim())) { skipped.push(p.name); continue; }
        const code = String(nextNum++).padStart(3, '0');
        await db().$executeRawUnsafe(
          `INSERT INTO "Employee" ("code","name","fatherName","position","hireDate","baseSalary","phone","nationalId","address","contractPeriod","note","status","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',datetime('now'))`,
          code, p.name, p.fatherName, p.position, p.hireDate, p.baseSalary, p.phone, p.nationalId, p.address, p.contractPeriod, p.note,
        );
        names.add(String(p.name).trim());
        inserted++;
      }
    }

    await logActivity({
      action: 'import', entity: type,
      detail: `${inserted} ردیف ثبت شد${skipped.length ? `، ${skipped.length} تکراری رد شد` : ''}`,
    });

    return {
      dryRun: false,
      inserted,
      skipped,
      duplicates: dupes,
      warnings,
      message: `${inserted} ردیف ثبت شد${skipped.length ? `، ${skipped.length} ردیف تکراری رد شد` : ''}.`,
    };
  }
}
