import { Body, Controller, Req, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly, userOf } from '../common/auth';
import { logActivity } from '../common/activity';
import { softDelete } from '../common/soft-delete';
import { settingsService } from '../common/settings';
import { nextDocNo } from '../common/sequence';
import { parseUserDate, formatDate, todayISO } from '../common/calendar';
import { allocationForSource, canonicalReceiptSource, receiptSourceVariants, reducesCustomerDebt } from '../common/domain';
import { idParam } from '../common/params';
import { ensureWalkInCustomer } from '../schema';

/**
 * نام منبع رسید را از شناسه/نام بگیر و به نام رسمی تبدیل کن.
 *
 * باگ: اگر کلاینت فقط `sourceId` می‌فرستاد (یا برعکس، فقط نام)، رسید با
 * منبع خالی ذخیره می‌شد و در گزارش‌ها زیر «—» می‌رفت؛ اثرش روی مانده هم
 * تصادفی می‌شد. حالا شناسه به نام تبدیل می‌شود و نام همیشه رسمی است.
 */
async function resolveSourceName(sourceId: unknown, sourceName: unknown): Promise<string> {
  const raw = String(sourceName ?? '').trim();
  if (raw) return canonicalReceiptSource(raw);
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) return '';
  const rows: any[] = await db().$queryRawUnsafe(
    `SELECT "name" FROM "LookupItem" WHERE "type"='receipt_source' AND "id"=?`,
    id,
  );
  return canonicalReceiptSource(rows?.[0]?.name);
}

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

/**
 * مشتری رسید — و اگر انتخاب نشده باشد، «مشتری گذری (بدون حساب)».
 *
 * رسید گذری یعنی پولی که از یک مشتریِ ناشناس/گذری گرفته شده (مثلاً فروش
 * نقدی همان روز). سند کامل ثبت می‌شود و روی حساب هیچ مشتریِ ثبت‌شده اثر
 * ندارد، چون به گذری نسبت داده شده است.
 */
async function resolveReceiptCustomer(body: any): Promise<{ id: number; name: string; walkIn: boolean }> {
  const raw = body?.customerId;
  const id = raw === '' || raw === null || raw === undefined ? null : Number(raw);
  if (id !== null && (!Number.isFinite(id) || id <= 0)) {
    throw new HttpException('مشتری انتخاب‌شده معتبر نیست.', 400);
  }
  if (id) {
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT "id","name","deletedAt","isWalkIn" FROM "Customer" WHERE "id"=?`, id,
    );
    if (!rows?.length) throw new HttpException('مشتری پیدا نشد.', 400);
    if (rows[0].deletedAt) {
      throw new HttpException('این مشتری در «سطل بازیافت» است؛ اول آن را بازگردانید.', 409);
    }
    return { id: Number(rows[0].id), name: String(rows[0].name), walkIn: Number(rows[0].isWalkIn) === 1 };
  }
  const walkId = await ensureWalkInCustomer();
  const rows: any[] = await db().$queryRawUnsafe(`SELECT "name" FROM "Customer" WHERE "id"=?`, walkId);
  return { id: walkId, name: String(rows?.[0]?.name ?? ''), walkIn: true };
}

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
    /* حذف‌شده‌ها هرگز در فهرست/جمع نباشند */
    where.push(`COALESCE("deletedAt",'')=''`);
    if (q) {
      where.push(`("no" LIKE ? OR "customerName" LIKE ? OR "relatedBillNo" LIKE ? OR "receivedBy" LIKE ? OR "note" LIKE ?)`);
      for (let i = 0; i < 5; i++) args.push(`%${q}%`);
    }
    try {
      if (from) { where.push(`"date" >= ?`); args.push(parseUserDate(from, mode)); }
      if (to) { where.push(`"date" <= ?`); args.push(parseUserDate(to, mode)); }
    } catch (e: any) { throw new HttpException(e.message, 400); }
    if (customerId) { where.push(`"customerId"=?`); args.push(Number(customerId)); }
    /*
     * فیلتر «منبع» باید نام‌های قدیمی را هم بگیرد: اگر همه‌ی رسیدهای
     * «بیانیه» را بخواهیم و کسی سال گذشته با «پیش پرداخت» ثبت کرده باشد،
     * فیلتر ساده او را جا می‌گذاشت.
     */
    if (source) {
      const variants = receiptSourceVariants(source);
      where.push(`"sourceName" IN (${variants.map(() => '?').join(',')})`);
      variants.forEach((v) => args.push(v));
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) as c, COALESCE(SUM("amount"),0) as sum FROM "Receipt" ${w}`, ...args);
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(500, Math.max(5, Number(pageSize) || 25));
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Receipt" ${w} ORDER BY "date" DESC, "id" DESC LIMIT ? OFFSET ?`,
      ...args, ps, (p - 1) * ps,
    );
    return {
      rows: rows.map((r) => {
        const sourceName = canonicalReceiptSource(r.sourceName);
        return {
          ...r,
          sourceName,
          allocation: allocationForSource(sourceName),
          reducesDebt: reducesCustomerDebt(null, sourceName),
          dateDisplay: formatDate(r.date, mode),
        };
      }),
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
    const amount = Number(body.amount) || 0;
    if (amount <= 0) throw new HttpException('مبلغ رسید باید بزرگتر از صفر باشد.', 400);
    let date = '';
    try { date = body.date ? parseUserDate(body.date, mode) : todayISO(); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    const cust = await resolveReceiptCustomer(body);
    const prefix = await settingsService.get('docPrefixReceipt');
    const no = String(body.no || '').trim() || (await nextDocNo(prefix, mode, date));
    /*
     * نام منبع همیشه با نام رسمی ذخیره می‌شود.
     * «بیانه» و «پیش‌پرداخت» یک مفهوم‌اند؛ اگر همان‌طور که کاربر تایپ
     * کرده ذخیره شوند، گزارش «بیانیه» نصف رسیدها را جا می‌گذارد.
     */
    const sourceName = await resolveSourceName(body.sourceId, body.sourceName);
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "Receipt" ("no","date","customerId","customerName","amount","relatedBillNo","sourceId","sourceName","receivedBy","note")
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        no, date, cust.id, cust.name, amount, body.relatedBillNo || '',
        body.sourceId ? Number(body.sourceId) : null, sourceName,
        body.receivedBy || '', body.note || '',
      );
    } catch {
      throw new HttpException('ثبت رسید انجام نشد — شماره رسید تکراری است.', 400);
    }
    await logActivity({
      action: 'create', entity: 'Receipt',
      detail: `${no} — ${cust.walkIn ? 'مشتری گذری' : cust.name} — ${amount}`,
    });
    return { ok: true, no };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const rid = idParam(id, 'شناسه‌ی رسید');
    await assertLive('Receipt', rid, 'رسید');
    const mode = await settingsService.calendar();
    let date = '';
    try { date = parseUserDate(body.date, mode); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    /* ویرایش هم نباید مبلغ صفر/منفی بسازد (ثبت، چنین چیزی را رد می‌کند) */
    const amount = Number(body.amount) || 0;
    if (amount <= 0) throw new HttpException('مبلغ رسید باید بزرگتر از صفر باشد.', 400);
    /*
     * باگ: در ویرایش، مشتری ناموجود بررسی نمی‌شد؛ `customerId` به ردیفی اشاره
     * می‌کرد که وجود ندارد و نامِ قدیمی روی رسید می‌ماند (کارت حساب خراب).
     */
    const cust = await resolveReceiptCustomer(body);
    const sourceName = await resolveSourceName(body.sourceId, body.sourceName);
    await db().$executeRawUnsafe(
      `UPDATE "Receipt" SET "date"=?, "customerId"=?, "customerName"=?, "amount"=?, "relatedBillNo"=?,
       "sourceId"=?, "sourceName"=?, "receivedBy"=?, "note"=? WHERE "id"=?`,
      date, cust.id, cust.name || body.customerName || '', amount,
      body.relatedBillNo || '', body.sourceId ? Number(body.sourceId) : null, sourceName,
      body.receivedBy || '', body.note || '', rid,
    );
    await logActivity({ action: 'update', entity: 'Receipt', entityId: rid });
    return { ok: true };
  }

  @Delete(':id')
  @ManagerOnly()
  async remove(@Req() req: any, @Param('id') id: string) {
    const rid = idParam(id, 'شناسه‌ی رسید');
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "no" FROM "Receipt" WHERE "id"=?`, rid);
    /* باگ: حذف شناسه‌ی ناموجود ۲۰۰ و یک ردیف ساختگی در «فعالیت‌ها» */
    if (!rows?.length) throw new HttpException('رسید پیدا نشد.', 404);
    /*
     * حذف «نرم» — درخواست کاربر: «حذف‌ها نرم باشند... از سابقه فعالیت‌ها
     * قابل بازیابی بدون آسیب». ردیف می‌ماند، فقط از همه‌ی فهرست‌ها و
     * گزارش‌ها پنهان می‌شود و از «سطل بازیافت» برمی‌گردد.
     */
    const del = await softDelete("Receipt", rid, { username: userOf(req) });
    if (!del.ok) throw new HttpException('ردیف پیدا نشد.', 404);
    /*
     * باگ: این لاگ بعد از `return` بود و هرگز اجرا نمی‌شد — یعنی حذف رسید
     * در «سابقه فعالیت‌ها» ثبت نمی‌شد و قابل بازیابی نبود.
     */
    await logActivity({ action: 'delete', entity: 'Receipt', entityId: rid, detail: rows?.[0]?.no || '' });
    return { ok: true, softDeleted: true, message: 'حذف شد — از «سطل بازیافت» قابل بازگرداندن است.' };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const rid = idParam(id, 'شناسه‌ی رسید');
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Receipt" WHERE "id"=?`, rid);
    if (!rows?.length) throw new HttpException('رسید پیدا نشد.', 404);
    const mode = await settingsService.calendar();
    return { ...rows[0], dateDisplay: formatDate(rows[0].date, mode, true) };
  }
}
