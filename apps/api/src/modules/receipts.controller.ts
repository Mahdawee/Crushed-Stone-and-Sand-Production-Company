import { Body, Controller, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { logActivity } from '../common/activity';
import { settingsService } from '../common/settings';
import { nextDocNo } from '../common/sequence';
import { parseUserDate, formatDate, todayISO } from '../common/calendar';

@UseGuards(AuthGuard)
@Controller('receipts')
export class ReceiptsController {
  @Get()
  async list(
    @Query('q') q?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('customerId') customerId?: string, @Query('source') source?: string,
    @Query('page') page = '1', @Query('pageSize') pageSize = '25',
  ) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const where: string[] = [];
    const args: any[] = [];
    if (q) {
      where.push(`("no" LIKE ? OR "customerName" LIKE ? OR "relatedBillNo" LIKE ? OR "receivedBy" LIKE ? OR "note" LIKE ?)`);
      for (let i = 0; i < 5; i++) args.push(`%${q}%`);
    }
    try {
      if (from) { where.push(`"date" >= ?`); args.push(parseUserDate(from, mode)); }
      if (to) { where.push(`"date" <= ?`); args.push(parseUserDate(to, mode)); }
    } catch (e: any) { throw new HttpException(e.message, 400); }
    if (customerId) { where.push(`"customerId"=?`); args.push(Number(customerId)); }
    if (source) { where.push(`"sourceName"=?`); args.push(source); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) as c, COALESCE(SUM("amount"),0) as sum FROM "Receipt" ${w}`, ...args);
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(500, Math.max(5, Number(pageSize) || 25));
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Receipt" ${w} ORDER BY "date" DESC, "id" DESC LIMIT ? OFFSET ?`,
      ...args, ps, (p - 1) * ps,
    );
    return {
      rows: rows.map((r) => ({ ...r, dateDisplay: formatDate(r.date, mode) })),
      total: Number(total?.[0]?.c ?? 0), sum: Number(total?.[0]?.sum ?? 0),
      page: p, pageSize: ps, calendar: mode,
    };
  }

  @Get('next-no')
  async nextNo() {
    const mode = await settingsService.calendar();
    const prefix = await settingsService.get('docPrefixReceipt');
    const { toCalendar } = await import('../common/calendar');
    const y = toCalendar(todayISO(), mode).jy;
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "value" FROM "Sequence" WHERE "scope"=?`, `${prefix}-${y}`);
    return { no: `${prefix}-${y}-${String(Number(rows?.[0]?.value ?? 0) + 1).padStart(4, '0')}` };
  }

  @Post()
  async create(@Body() body: any) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    if (!body?.customerId) throw new HttpException('مشتری را انتخاب کنید.', 400);
    const amount = Number(body.amount) || 0;
    if (amount <= 0) throw new HttpException('مبلغ رسید باید بزرگتر از صفر باشد.', 400);
    let date = '';
    try { date = body.date ? parseUserDate(body.date, mode) : todayISO(); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    const cust: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Customer" WHERE "id"=?`, Number(body.customerId));
    if (!cust?.length) throw new HttpException('مشتری پیدا نشد.', 400);
    const prefix = await settingsService.get('docPrefixReceipt');
    const no = String(body.no || '').trim() || (await nextDocNo(prefix, mode, date));
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "Receipt" ("no","date","customerId","customerName","amount","relatedBillNo","sourceId","sourceName","receivedBy","note")
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        no, date, Number(body.customerId), cust[0].name, amount, body.relatedBillNo || '',
        body.sourceId ? Number(body.sourceId) : null, body.sourceName || '',
        body.receivedBy || '', body.note || '',
      );
    } catch {
      throw new HttpException('ثبت رسید انجام نشد — شماره رسید تکراری است.', 400);
    }
    await logActivity({ action: 'create', entity: 'Receipt', detail: `${no} — ${cust[0].name} — ${amount}` });
    return { ok: true, no };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const mode = await settingsService.calendar();
    let date = '';
    try { date = parseUserDate(body.date, mode); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    /* ویرایش هم نباید مبلغ صفر/منفی بسازد (ثبت، چنین چیزی را رد می‌کند) */
    const amount = Number(body.amount) || 0;
    if (amount <= 0) throw new HttpException('مبلغ رسید باید بزرگتر از صفر باشد.', 400);
    const cust: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Customer" WHERE "id"=?`, Number(body.customerId));
    await db().$executeRawUnsafe(
      `UPDATE "Receipt" SET "date"=?, "customerId"=?, "customerName"=?, "amount"=?, "relatedBillNo"=?,
       "sourceId"=?, "sourceName"=?, "receivedBy"=?, "note"=? WHERE "id"=?`,
      date, Number(body.customerId), cust?.[0]?.name || body.customerName || '', amount,
      body.relatedBillNo || '', body.sourceId ? Number(body.sourceId) : null, body.sourceName || '',
      body.receivedBy || '', body.note || '', Number(id),
    );
    await logActivity({ action: 'update', entity: 'Receipt', entityId: Number(id) });
    return { ok: true };
  }

  @Delete(':id')
  @ManagerOnly()
  async remove(@Param('id') id: string) {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "no" FROM "Receipt" WHERE "id"=?`, Number(id));
    await db().$executeRawUnsafe(`DELETE FROM "Receipt" WHERE "id"=?`, Number(id));
    await logActivity({ action: 'delete', entity: 'Receipt', entityId: Number(id), detail: rows?.[0]?.no || '' });
    return { ok: true };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Receipt" WHERE "id"=?`, Number(id));
    if (!rows?.length) throw new HttpException('رسید پیدا نشد.', 404);
    const mode = await settingsService.calendar();
    return { ...rows[0], dateDisplay: formatDate(rows[0].date, mode, true) };
  }
}
