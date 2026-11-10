import { Body, Controller, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { logActivity } from '../common/activity';
import { settingsService } from '../common/settings';
import { nextDocNo } from '../common/sequence';
import { parseUserDate, formatDate, CalendarMode } from '../common/calendar';

@UseGuards(AuthGuard)
@Controller('sales')
export class SalesController {
  @Get()
  async list(
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('customerId') customerId?: string,
    @Query('material') material?: string,
    @Query('paymentType') paymentType?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
  ) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const where: string[] = [];
    const args: any[] = [];
    if (q) {
      where.push(`("no" LIKE ? OR "customerName" LIKE ? OR "driverName" LIKE ? OR "truckPlate" LIKE ? OR "destination" LIKE ? OR "materialName" LIKE ? OR "contractorName" LIKE ?)`);
      for (let i = 0; i < 7; i++) args.push(`%${q}%`);
    }
    try {
      if (from) { where.push(`"date" >= ?`); args.push(parseUserDate(from, mode)); }
      if (to) { where.push(`"date" <= ?`); args.push(parseUserDate(to, mode)); }
    } catch (e: any) { throw new HttpException(e.message, 400); }
    if (customerId) { where.push(`"customerId" = ?`); args.push(Number(customerId)); }
    if (material) { where.push(`"materialName" = ?`); args.push(material); }
    if (paymentType) { where.push(`"paymentType" = ?`); args.push(paymentType); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total: any[] = await db().$queryRawUnsafe(
      `SELECT COUNT(*) as c, COALESCE(SUM("total"),0) as sum, COALESCE(SUM("volume"),0) as volumeSum,
              COALESCE(SUM("freightTotal"),0) as freightSum FROM "Sale" ${w}`, ...args);
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(500, Math.max(5, Number(pageSize) || 25));
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Sale" ${w} ORDER BY "date" DESC, "id" DESC LIMIT ? OFFSET ?`,
      ...args, ps, (p - 1) * ps,
    );
    return {
      rows: rows.map((r) => ({ ...r, dateDisplay: formatDate(r.date, mode) })),
      total: Number(total?.[0]?.c ?? 0),
      sum: Number(total?.[0]?.sum ?? 0),
      volumeSum: Number(total?.[0]?.volumeSum ?? 0),
      freightSum: Number(total?.[0]?.freightSum ?? 0),
      page: p, pageSize: ps, calendar: mode,
    };
  }

  @Get('next-no')
  async nextNo(@Query('date') date?: string) {
    const mode = await settingsService.calendar();
    const d = date ? parseUserDate(date, mode) : undefined;
    const { todayISO } = await import('../common/calendar');
    const isoDate = d || todayISO();
    const { toCalendar } = await import('../common/calendar');
    const y = toCalendar(isoDate, mode).jy;
    const prefix = await settingsService.get('docPrefixSale');
    // preview only — the real number is issued on save
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "value" FROM "Sequence" WHERE "scope"=?`, `${prefix}-${y}`);
    const next = Number(rows?.[0]?.value ?? 0) + 1;
    return { no: `${prefix}-${y}-${String(next).padStart(4, '0')}` };
  }

  @Post()
  async create(@Body() body: any) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    if (!body?.customerId) throw new HttpException('مشتری را انتخاب کنید.', 400);
    let date = '';
    try { date = body.date ? parseUserDate(body.date, mode) : (await import('../common/calendar')).todayISO(); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    const volume = Number(body.volume) || 0;
    const unitPrice = Number(body.unitPrice) || 0;
    const freightPerUnit = Number(body.freightPerUnit) || 0;
    const freightTotal = Math.round(volume * freightPerUnit * 100) / 100;
    const total = Math.round((volume * unitPrice + freightTotal) * 100) / 100;
    const prefix = await settingsService.get('docPrefixSale');
    const no = String(body.no || '').trim() || (await nextDocNo(prefix, mode, date));
    const cust: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Customer" WHERE "id"=?`, Number(body.customerId));
    if (!cust?.length) throw new HttpException('مشتری پیدا نشد.', 400);
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "Sale" ("no","date","customerId","customerName","driverName","truckPlate","destination",
          "materialId","materialName","volume","unitPrice","freightPerUnit","freightTotal","total",
          "contractorId","contractorName","paymentType","note")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        no, date, Number(body.customerId), cust[0].name,
        body.driverName || '', body.truckPlate || '', body.destination || '',
        body.materialId ? Number(body.materialId) : null, body.materialName || '',
        volume, unitPrice, freightPerUnit, freightTotal, total,
        body.contractorId ? Number(body.contractorId) : null, body.contractorName || '',
        body.paymentType === 'credit' ? 'credit' : 'cash', body.note || '',
      );
    } catch (e: any) {
      throw new HttpException('ثبت فروش انجام نشد — شماره بل تکراری است یا معلومات ناقص است.', 400);
    }
    await logActivity({ action: 'create', entity: 'Sale', detail: `${no} — ${cust[0].name} — ${total} افغانی` });
    return { ok: true, no, total, freightTotal };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const mode = await settingsService.calendar();
    let date = '';
    try { date = body.date ? parseUserDate(body.date, mode) : ''; }
    catch (e: any) { throw new HttpException(e.message, 400); }
    if (!date) throw new HttpException('تاریخ بل را وارد کنید.', 400);
    const volume = Number(body.volume) || 0;
    const unitPrice = Number(body.unitPrice) || 0;
    const freightPerUnit = Number(body.freightPerUnit) || 0;
    const freightTotal = Math.round(volume * freightPerUnit * 100) / 100;
    const total = Math.round((volume * unitPrice + freightTotal) * 100) / 100;
    const cust: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Customer" WHERE "id"=?`, Number(body.customerId));
    try {
      await db().$executeRawUnsafe(
        `UPDATE "Sale" SET "date"=?, "customerId"=?, "customerName"=?, "driverName"=?, "truckPlate"=?, "destination"=?,
          "materialId"=?, "materialName"=?, "volume"=?, "unitPrice"=?, "freightPerUnit"=?, "freightTotal"=?, "total"=?,
          "contractorId"=?, "contractorName"=?, "paymentType"=?, "note"=? WHERE "id"=?`,
        date, Number(body.customerId), cust?.[0]?.name || body.customerName || '', body.driverName || '',
        body.truckPlate || '', body.destination || '', body.materialId ? Number(body.materialId) : null,
        body.materialName || '', volume, unitPrice, freightPerUnit, freightTotal, total,
        body.contractorId ? Number(body.contractorId) : null, body.contractorName || '',
        body.paymentType === 'credit' ? 'credit' : 'cash', body.note || '', Number(id),
      );
    } catch {
      throw new HttpException('ویرایش انجام نشد.', 400);
    }
    await logActivity({ action: 'update', entity: 'Sale', entityId: Number(id), detail: body.no || '' });
    return { ok: true, total };
  }

  @Delete(':id')
  @ManagerOnly()
  async remove(@Param('id') id: string) {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "no" FROM "Sale" WHERE "id"=?`, Number(id));
    await db().$executeRawUnsafe(`DELETE FROM "Sale" WHERE "id"=?`, Number(id));
    await logActivity({ action: 'delete', entity: 'Sale', entityId: Number(id), detail: rows?.[0]?.no || '' });
    return { ok: true };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Sale" WHERE "id"=?`, Number(id));
    if (!rows?.length) throw new HttpException('بل فروش پیدا نشد.', 404);
    const mode = await settingsService.calendar();
    return { ...rows[0], dateDisplay: formatDate(rows[0].date, mode, true) };
  }
}
