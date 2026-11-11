import { Body, Controller, Req, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly, userOf } from '../common/auth';
import { logActivity } from '../common/activity';
import { softDelete } from '../common/soft-delete';
import { resolveRelatedBranch } from '../common/related';
import { settingsService } from '../common/settings';
import { nextDocNo } from '../common/sequence';
import { parseUserDate, formatDate, todayISO } from '../common/calendar';
import { idParam } from '../common/params';

/**
 * ردیفی که در «سطل بازیافت» است نباید ویرایش شود.
 *
 * ## باگ واقعی
 * مسیرهای `PUT` وجود ردیف را بررسی نمی‌کردند. اگر سند حذف شده بود و کاربر
 * (یا یک تبِ بازِ قدیمی، یا فورمی که بعد از حذف باز مانده بود) دوباره
 * «ذخیره» می‌زد، پاسخ **۲۰۰ «ذخیره شد»** می‌گرفت؛ ردیف در سطل بازیافت با
 * عددهای تازه می‌ماند و با «بازگرداندن»، سندی با مبلغ/مشتریِ غلط به
 * حساب‌ها برمی‌گشت. حالا با پیام روشن (۴۰۹) رد می‌شود.
 */
async function assertLive(table: string, id: number, label: string) {
  const rows: any[] = await db().$queryRawUnsafe(
    `SELECT "id", "deletedAt" FROM "${table}" WHERE "id"=?`, id,
  );
  if (!rows?.length) throw new HttpException(`${label} پیدا نشد.`, 404);
  if (rows[0].deletedAt) {
    throw new HttpException(`این ${label} در «سطل بازیافت» است؛ اول آن را بازگردانید، بعد ویرایش کنید.`, 409);
  }
}

@UseGuards(AuthGuard)
@Controller('expenses')
export class ExpensesController {
  @Get()
  async list(
    @Query('q') q?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('category') category?: string, @Query('payer') payer?: string,
    @Query('paymentType') paymentType?: string,
    @Query('page') page = '1', @Query('pageSize') pageSize = '25',
  ) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const where: string[] = [];
    const args: any[] = [];
    /* حذف‌شده‌ها هرگز در فهرست/جمع نباشند */
    where.push(`COALESCE("deletedAt",'')=''`);
    if (q) {
      where.push(`("no" LIKE ? OR "description" LIKE ? OR "shopName" LIKE ? OR "categoryName" LIKE ? OR "payerName" LIKE ? OR "contractorName" LIKE ?)`);
      for (let i = 0; i < 6; i++) args.push(`%${q}%`);
    }
    try {
      if (from) { where.push(`"date" >= ?`); args.push(parseUserDate(from, mode)); }
      if (to) { where.push(`"date" <= ?`); args.push(parseUserDate(to, mode)); }
    } catch (e: any) { throw new HttpException(e.message, 400); }
    if (category) { where.push(`"categoryName"=?`); args.push(category); }
    if (payer) { where.push(`"payerName"=?`); args.push(payer); }
    if (paymentType) { where.push(`"paymentType"=?`); args.push(paymentType); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total: any[] = await db().$queryRawUnsafe(
      `SELECT COUNT(*) as c, COALESCE(SUM("amountAfn"),0) as afn, COALESCE(SUM("amountUsd"),0) as usd FROM "Expense" ${w}`, ...args,
    );
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(500, Math.max(5, Number(pageSize) || 25));
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Expense" ${w} ORDER BY "date" DESC, "id" DESC LIMIT ? OFFSET ?`,
      ...args, ps, (p - 1) * ps,
    );
    return {
      rows: rows.map((r) => ({ ...r, dateDisplay: formatDate(r.date, mode) })),
      total: Number(total?.[0]?.c ?? 0), sumAfn: Number(total?.[0]?.afn ?? 0), sumUsd: Number(total?.[0]?.usd ?? 0),
      page: p, pageSize: ps, calendar: mode,
    };
  }

  @Get('next-no')
  async nextNo() {
    const mode = await settingsService.calendar();
    const prefix = await settingsService.get('docPrefixExpense');
    const { toCalendar } = await import('../common/calendar');
    const y = toCalendar(todayISO(), mode).jy;
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "value" FROM "Sequence" WHERE "scope"=?`, `${prefix}-${y}`);
    return { no: `${prefix}-${y}-${String(Number(rows?.[0]?.value ?? 0) + 1).padStart(4, '0')}` };
  }

  @Post()
  async create(@Body() body: any) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const amountAfn = Number(body.amountAfn) || 0;
    const amountUsd = Number(body.amountUsd) || 0;
    if (!Number.isFinite(amountAfn) || !Number.isFinite(amountUsd)) {
      throw new HttpException('مبلغ مصرف باید عدد باشد.', 400);
    }
    if (amountAfn < 0 || amountUsd < 0) throw new HttpException('مبلغ مصرف نمی‌تواند منفی باشد.', 400);
    if (amountAfn <= 0 && amountUsd <= 0) throw new HttpException('مبلغ مصرف را وارد کنید (افغانی یا دالری).', 400);
    let date = '';
    try { date = body.date ? parseUserDate(body.date, mode) : todayISO(); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    const prefix = await settingsService.get('docPrefixExpense');
    const no = String(body.no || '').trim() || (await nextDocNo(prefix, mode, date));
    /* «مربوط» (شاخه‌ی مصرف): نام از شناسه خوانده می‌شود، نه از کلاینت */
    const branch = await resolveRelatedBranch(body.contractorId, body.contractorName);
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "Expense" ("no","date","description","categoryId","categoryName","contractorId","contractorName",
          "purchaseBillNo","shopName","amountAfn","amountUsd","payerId","payerName","paymentType","note")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        no, date, body.description || '', body.categoryId ? Number(body.categoryId) : null, body.categoryName || '',
        branch.contractorId, branch.contractorName,
        body.purchaseBillNo || '', body.shopName || '', amountAfn, amountUsd,
        body.payerId ? Number(body.payerId) : null, body.payerName || '',
        body.paymentType === 'credit' ? 'credit' : 'cash', body.note || '',
      );
    } catch {
      throw new HttpException('ثبت مصرف انجام نشد — شماره سند تکراری است.', 400);
    }
    await logActivity({ action: 'create', entity: 'Expense', detail: `${no} — ${amountAfn} افغانی` });
    return { ok: true, no };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const eid = idParam(id, 'شناسه‌ی سند مصرف');
    await assertLive('Expense', eid, 'سند مصرف');
    const mode = await settingsService.calendar();
    let date = '';
    try { date = parseUserDate(body.date, mode); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    /* همان اعتبارسنجیِ ثبت، برای ویرایش هم لازم است — وگرنه مصرف منفی ذخیره می‌شد */
    const amountAfn = Number(body.amountAfn) || 0;
    const amountUsd = Number(body.amountUsd) || 0;
    if (amountAfn < 0 || amountUsd < 0) throw new HttpException('مبلغ مصرف نمی‌تواند منفی باشد.', 400);
    if (amountAfn <= 0 && amountUsd <= 0) throw new HttpException('مبلغ مصرف را وارد کنید (افغانی یا دالری).', 400);
    const branch = await resolveRelatedBranch(body.contractorId, body.contractorName);
    await db().$executeRawUnsafe(
      `UPDATE "Expense" SET "date"=?, "description"=?, "categoryId"=?, "categoryName"=?, "contractorId"=?, "contractorName"=?,
       "purchaseBillNo"=?, "shopName"=?, "amountAfn"=?, "amountUsd"=?, "payerId"=?, "payerName"=?, "paymentType"=?, "note"=?
       WHERE "id"=?`,
      date, body.description || '', body.categoryId ? Number(body.categoryId) : null, body.categoryName || '',
      branch.contractorId, branch.contractorName,
      body.purchaseBillNo || '', body.shopName || '', amountAfn, amountUsd,
      body.payerId ? Number(body.payerId) : null, body.payerName || '',
      body.paymentType === 'credit' ? 'credit' : 'cash', body.note || '', eid,
    );
    await logActivity({ action: 'update', entity: 'Expense', entityId: eid });
    return { ok: true };
  }

  @Delete(':id')
  @ManagerOnly()
  async remove(@Req() req: any, @Param('id') id: string) {
    const eid = idParam(id, 'شناسه‌ی سند مصرف');
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "no" FROM "Expense" WHERE "id"=?`, eid);
    /* باگ: حذف شناسه‌ی ناموجود ۲۰۰ و ردیف ساختگی در «فعالیت‌ها» */
    if (!rows?.length) throw new HttpException('سند مصرف پیدا نشد.', 404);
    /*
     * حذف «نرم» — درخواست کاربر: «حذف‌ها نرم باشند... از سابقه فعالیت‌ها
     * قابل بازیابی بدون آسیب». ردیف می‌ماند، فقط از همه‌ی فهرست‌ها و
     * گزارش‌ها پنهان می‌شود و از «سطل بازیافت» برمی‌گردد.
     */
    const del = await softDelete("Expense", eid, { username: userOf(req) });
    if (!del.ok) throw new HttpException('ردیف پیدا نشد.', 404);
    /*
     * باگ: این ثبت سابقه **بعد از return** بود و هرگز اجرا نمی‌شد؛ یعنی
     * حذف در «سابقه فعالیت‌ها» نمی‌آمد و «قابل بازیابی بودن» فقط روی
     * کاغذ بود. حالا قبل از برگشت ثبت می‌شود.
     */
    await logActivity({ action: 'delete', entity: 'Expense', entityId: eid, detail: rows?.[0]?.no || '' });
    return { ok: true, softDeleted: true, message: 'حذف شد — از «سطل بازیافت» قابل بازگرداندن است.' };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const eid = idParam(id, 'شناسه‌ی سند مصرف');
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Expense" WHERE "id"=?`, eid);
    if (!rows?.length) throw new HttpException('سند مصرف پیدا نشد.', 404);
    const mode = await settingsService.calendar();
    return { ...rows[0], dateDisplay: formatDate(rows[0].date, mode, true) };
  }
}
