import { Body, Controller, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { logActivity } from '../common/activity';
import { softDelete } from '../common/soft-delete';
import { settingsService } from '../common/settings';
import { nextDocNo } from '../common/sequence';
import { parseUserDate, formatDate, todayISO } from '../common/calendar';

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
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "Expense" ("no","date","description","categoryId","categoryName","contractorId","contractorName",
          "purchaseBillNo","shopName","amountAfn","amountUsd","payerId","payerName","paymentType","note")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        no, date, body.description || '', body.categoryId ? Number(body.categoryId) : null, body.categoryName || '',
        body.contractorId ? Number(body.contractorId) : null, body.contractorName || '',
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
    const mode = await settingsService.calendar();
    let date = '';
    try { date = parseUserDate(body.date, mode); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    /* همان اعتبارسنجیِ ثبت، برای ویرایش هم لازم است — وگرنه مصرف منفی ذخیره می‌شد */
    const amountAfn = Number(body.amountAfn) || 0;
    const amountUsd = Number(body.amountUsd) || 0;
    if (amountAfn < 0 || amountUsd < 0) throw new HttpException('مبلغ مصرف نمی‌تواند منفی باشد.', 400);
    if (amountAfn <= 0 && amountUsd <= 0) throw new HttpException('مبلغ مصرف را وارد کنید (افغانی یا دالری).', 400);
    await db().$executeRawUnsafe(
      `UPDATE "Expense" SET "date"=?, "description"=?, "categoryId"=?, "categoryName"=?, "contractorId"=?, "contractorName"=?,
       "purchaseBillNo"=?, "shopName"=?, "amountAfn"=?, "amountUsd"=?, "payerId"=?, "payerName"=?, "paymentType"=?, "note"=?
       WHERE "id"=?`,
      date, body.description || '', body.categoryId ? Number(body.categoryId) : null, body.categoryName || '',
      body.contractorId ? Number(body.contractorId) : null, body.contractorName || '',
      body.purchaseBillNo || '', body.shopName || '', amountAfn, amountUsd,
      body.payerId ? Number(body.payerId) : null, body.payerName || '',
      body.paymentType === 'credit' ? 'credit' : 'cash', body.note || '', Number(id),
    );
    await logActivity({ action: 'update', entity: 'Expense', entityId: Number(id) });
    return { ok: true };
  }

  @Delete(':id')
  @ManagerOnly()
  async remove(@Param('id') id: string) {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "no" FROM "Expense" WHERE "id"=?`, Number(id));
    /* باگ: حذف شناسه‌ی ناموجود ۲۰۰ و ردیف ساختگی در «فعالیت‌ها» */
    if (!rows?.length) throw new HttpException('سند مصرف پیدا نشد.', 404);
    /*
     * حذف «نرم» — درخواست کاربر: «حذف‌ها نرم باشند... از سابقه فعالیت‌ها
     * قابل بازیابی بدون آسیب». ردیف می‌ماند، فقط از همه‌ی فهرست‌ها و
     * گزارش‌ها پنهان می‌شود و از «سطل بازیافت» برمی‌گردد.
     */
    const del = await softDelete("Expense", Number(id));
    if (!del.ok) throw new HttpException('ردیف پیدا نشد.', 404);
    return { ok: true, softDeleted: true, message: 'حذف شد — از «سطل بازیافت» قابل بازگرداندن است.' };
    await logActivity({ action: 'delete', entity: 'Expense', entityId: Number(id), detail: rows?.[0]?.no || '' });
    return { ok: true };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Expense" WHERE "id"=?`, Number(id));
    if (!rows?.length) throw new HttpException('سند مصرف پیدا نشد.', 404);
    const mode = await settingsService.calendar();
    return { ...rows[0], dateDisplay: formatDate(rows[0].date, mode, true) };
  }
}
