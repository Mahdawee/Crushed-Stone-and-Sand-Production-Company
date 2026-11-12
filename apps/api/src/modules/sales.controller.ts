import { Body, Controller, Req, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly, userOf } from '../common/auth';
import { logActivity } from '../common/activity';
import { softDelete } from '../common/soft-delete';
import { resolveRelatedBranch } from '../common/related';
import { settingsService } from '../common/settings';
import { nextDocNo } from '../common/sequence';
import { parseUserDate, formatDate, CalendarMode } from '../common/calendar';
import { idParam, optionalIdQuery, MAX_MONEY, MAX_QUANTITY } from '../common/params';
import { ensureWalkInCustomer } from '../schema';
import { WALK_IN_SHORT } from '../common/domain';

/**
 * مقادیر عددی بل فروش.
 *
 * باگ: ثبت با متراژ یا قیمت منفی (یا خالی) پذیرفته می‌شد و «جمع» منفی در
 * گزارش‌ها و بدهی مشتری می‌نشست. حالا:
 *   • متراژ باید بزرگ‌تر از صفر باشد؛
 *   • قیمت واحد و کرایه منفی نباشند؛
 *   • عدد نامعتبر (متن/NaN) صفر حساب نشود بلکه خطا بدهد.
 */
function readNumbers(body: any) {
  const bad = (v: any) => v !== undefined && v !== null && v !== '' && !Number.isFinite(Number(v));
  if (bad(body?.volume) || bad(body?.unitPrice) || bad(body?.freightPerUnit)) {
    throw new HttpException('متراژ و قیمت باید عدد باشند.', 400);
  }
  const volume = Number(body?.volume) || 0;
  const unitPrice = Number(body?.unitPrice) || 0;
  const freightPerUnit = Number(body?.freightPerUnit) || 0;
  if (volume <= 0) throw new HttpException('متراژ باید بزرگ‌تر از صفر باشد.', 400);
  /*
   * سقف متراژ و قیمت — `1e308` عدد متناهی است ولی در SQLite به `Infinity`
   * گرد می‌شد؛ از آن لحظه جمع فروش و مانده‌ی مشتری برای همیشه `Infinity`
   * می‌ماند و هیچ ویرایشی درستش نمی‌کرد (شکار باگ دور ۲۸).
   */
  if (volume > MAX_QUANTITY) throw new HttpException('متراژ از حد مجاز بزرگ‌تر است.', 400);
  if (unitPrice > MAX_MONEY) throw new HttpException('قیمت واحد از حد مجاز بزرگ‌تر است.', 400);
  if (freightPerUnit > MAX_MONEY) throw new HttpException('کرایه فی متر از حد مجاز بزرگ‌تر است.', 400);
  if (unitPrice < 0) throw new HttpException('قیمت واحد نمی‌تواند منفی باشد.', 400);
  if (freightPerUnit < 0) throw new HttpException('کرایه فی واحد نمی‌تواند منفی باشد.', 400);
  const freightTotal = Math.round(volume * freightPerUnit * 100) / 100;
  /*
   * جمع کرایه همیشه «کرایه فی متر × متراژ» است — همان چیزی که کاربر در فورم
   * می‌بیند (کادر «مجموع کرایه» فقط‌خواندنی است). قبلاً اگر کلاینت عددی در
   * `freightTotal` می‌فرستاد، ذخیره می‌شد و می‌توانست با جمعِ نمایش‌داده‌شده
   * فرق کند (دو منبع حقیقت). حالا یک منبع: متراژ × کرایه فی متر.
   */
  const total = Math.round((volume * unitPrice + freightTotal) * 100) / 100;
  return { volume, unitPrice, freightPerUnit, freightTotal, total };
}

/**
 * ردیفی که در «سطل بازیافت» است نباید ویرایش شود.
 *
 * ## باگ واقعی
 * `PUT /sales/:id` وجود ردیف را بررسی نمی‌کرد. اگر بل حذف شده بود و کاربر
 * (یا یک تبِ بازِ قدیمی، یا دکمه‌ی «ذخیره»ی یک فورم که بعد از حذف باز مانده)
 * همان بل را ویرایش می‌کرد، پاسخ **۲۰۰ «ذخیره شد»** می‌گرفت؛ ردیف در
 * سطل بازیافت با عددهای تازه می‌ماند و بعد از «بازگرداندن» یک بل با
 * مبلغ/مشتریِ غلط به حساب‌ها برمی‌گشت. کاربر فکر می‌کرد ویرایش‌اش روی
 * سند زنده اثر کرده است.
 *
 * حالا ویرایش ردیفِ سطل بازیافت با پیام روشن رد می‌شود.
 */
async function assertLiveRow(table: string, id: number, label: string) {
  const rows: any[] = await db().$queryRawUnsafe(
    `SELECT "id", "deletedAt" FROM "${table}" WHERE "id"=?`, id,
  );
  if (!rows?.length) throw new HttpException(`${label} پیدا نشد.`, 404);
  if (rows[0].deletedAt) {
    throw new HttpException(
      `این ${label} در «سطل بازیافت» است؛ اول آن را بازگردانید، بعد ویرایش کنید.`, 409,
    );
  }
}

/**
 * مشتری سند را پیدا می‌کند و اگر انتخاب نشده باشد، «مشتری گذری» را می‌گذارد.
 *
 * درخواست کاربر: «اگر مشتری انتخاب نشود، معامله به مشتری بدون حساب (گذری)
 * صورت بگیرد». قبلاً سرور با «مشتری را انتخاب کنید» رد می‌کرد و فروشِ
 * مشتریِ ناشناس (کسی که فقط بار می‌گیرد و می‌رود) اصلاً ثبت نمی‌شد.
 *
 * ## محدودیت مهم
 * فروش «قرضه» (credit) بدون مشتری معنا ندارد: بدهی به کسی تعلق می‌گیرد که
 * بعداً پیدا شود. پس گذری فقط با پرداخت **نقده** ثبت می‌شود و اگر کاربر
 * قرضه را انتخاب کند، پیام روشن می‌گیرد — نه سندِ بدهیِ بی‌صاحب.
 */
async function resolveSaleCustomer(body: any): Promise<{ id: number; name: string; walkIn: boolean }> {
  const id = body?.customerId === '' || body?.customerId === null || body?.customerId === undefined
    ? null
    : Number(body.customerId);
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
    /* حذف‌شده‌ها هرگز در فهرست/جمع نباشند */
    where.push(`COALESCE("deletedAt",'')=''`);
    if (q) {
      where.push(`("no" LIKE ? OR "customerName" LIKE ? OR "driverName" LIKE ? OR "truckPlate" LIKE ? OR "destination" LIKE ? OR "materialName" LIKE ? OR "contractorName" LIKE ?)`);
      for (let i = 0; i < 7; i++) args.push(`%${q}%`);
    }
    try {
      if (from) { where.push(`"date" >= ?`); args.push(parseUserDate(from, mode)); }
      if (to) { where.push(`"date" <= ?`); args.push(parseUserDate(to, mode)); }
    } catch (e: any) { throw new HttpException(e.message, 400); }
    /*
     * باگ (شکار باگ دور ۲۹): `Number('abc')` = NaN ⇒ `WHERE customerId = NaN`
     * ⇒ فهرست **خالی** بدون هیچ خطایی، در حالی که سندها وجود داشتند. حالا
     * مقدار نامعتبر ۴۰۰ می‌دهد.
     */
    const custFilter = optionalIdQuery(customerId, 'شناسه‌ی مشتری');
    if (custFilter !== undefined) { where.push(`"customerId" = ?`); args.push(custFilter); }
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
    /* باگ: تاریخ نامعتبر در «شماره بعدی» ۵۰۰ می‌داد (parseUserDate بیرون از try) */
    let d: string | undefined;
    try { d = date ? parseUserDate(date, mode) : undefined; }
    catch (e: any) { throw new HttpException(e.message, 400); }
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
    let date = '';
    try { date = body.date ? parseUserDate(body.date, mode) : (await import('../common/calendar')).todayISO(); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    const { volume, unitPrice, freightPerUnit, freightTotal, total } = readNumbers(body);
    const prefix = await settingsService.get('docPrefixSale');
    const no = String(body.no || '').trim() || (await nextDocNo(prefix, mode, date));
    const cust = await resolveSaleCustomer(body);
    /* فروش گذری فقط نقده: بدهی بدون صاحب معنا ندارد */
    if (cust.walkIn && body.paymentType === 'credit') {
      throw new HttpException(
        'فروش «قرضه» به مشتری گذری ثبت نمی‌شود — برای قرضه، مشتری را انتخاب کنید. یا پرداخت را «نقده» بگذارید.', 400,
      );
    }
    /* «مربوط» (شاخه‌ی مصرف): نام از شناسه خوانده می‌شود، نه از کلاینت */
    const branch = await resolveRelatedBranch(body.contractorId, body.contractorName);
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "Sale" ("no","date","customerId","customerName","driverName","truckPlate","destination",
          "materialId","materialName","volume","unitPrice","freightPerUnit","freightTotal","total",
          "contractorId","contractorName","paymentType","note")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        no, date, cust.id, cust.name,
        body.driverName || '', body.truckPlate || '', body.destination || '',
        body.materialId ? Number(body.materialId) : null, body.materialName || '',
        volume, unitPrice, freightPerUnit, freightTotal, total,
        branch.contractorId, branch.contractorName,
        body.paymentType === 'credit' ? 'credit' : 'cash', body.note || '',
      );
    } catch (e: any) {
      /* خطای اعتبارسنجی خودمان (۴۰۰) نباید به ۵۰۰ تبدیل شود */
      if (e instanceof HttpException) throw e;
      /*
       * فقط تکراری‌بودن شماره بل پیام «تکراری» می‌گیرد؛ هر خطای دیگری
       * (دیسک پر، قید کلید خارجی، خطای داخلی) با متن واقعی برمی‌گردد —
       * پیش‌تر همه‌ی خطاها «شماره تکراری» گزارش می‌شد و کاربر بی‌دلیل
       * شماره را عوض می‌کرد (شکار باگ دور ۲۸).
       */
      if (/UNIQUE|constraint failed/i.test(String(e?.message || ''))) {
        throw new HttpException('این شماره بل قبلاً ثبت شده است.', 400);
      }
      throw new HttpException(`ثبت فروش انجام نشد: ${e?.message || e}`, 500);
    }
    await logActivity({
      action: 'create', entity: 'Sale',
      detail: `${no} — ${cust.walkIn ? WALK_IN_SHORT : cust.name} — ${total} افغانی`,
    });
    return { ok: true, no, total, freightTotal, walkIn: cust.walkIn, customerName: cust.name };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const sid = idParam(id, 'شناسه‌ی بل');
    await assertLiveRow('Sale', sid, 'بل فروش');
    const mode = await settingsService.calendar();
    /*
     * ── باگ (شکار باگ دور ۳۴): ویرایش ناقص، بل را به «مشتری گذری» می‌برد ─────
     * بدنه «کامل» فرض می‌شد. اگر فراخواننده `customerId` را نمی‌فرستاد،
     * `resolveSaleCustomer` **مشتری گذری** را برمی‌گرداند و بل بی‌صدا از حساب
     * مشتری واقعی جدا می‌شد (بدهی‌اش گم). راننده، پلاک موتر، مقصد، مواد و
     * یادداشت هم خالی می‌شدند. تاریخ هم اجباری بود، بنابراین «فقط یادداشت را
     * عوض کن» با خطای «تاریخ بل را وارد کنید» رد می‌شد.
     * حالا با ردیف موجود ادغام می‌شود.
     */
    const curRows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Sale" WHERE "id"=?`, sid);
    const existing: any = curRows?.[0] || {};
    let date = '';
    try { date = body.date ? parseUserDate(body.date, mode) : String(existing.date ?? ''); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    if (!date) throw new HttpException('تاریخ بل را وارد کنید.', 400);
    const merged: any = { ...existing };
    for (const k of ['customerId', 'customerName', 'driverName', 'truckPlate', 'destination',
      'materialId', 'materialName', 'paymentType', 'note']) {
      if (body?.[k] !== undefined) merged[k] = body[k];
    }
    /*
     * اعداد هم اگر فرستاده نشوند از ردیف موجود می‌آیند؛ وگرنه ویرایشِ فقط
     * «راننده» با `volume` صفر به خطای «متراژ باید بزرگ‌تر از صفر باشد»
     * می‌خورد (یعنی ویرایش ناقص عملاً غیرممکن بود).
     */
    const numsFrom: any = { ...merged };
    for (const k of ['volume', 'unitPrice', 'freightPerUnit']) {
      if (body?.[k] !== undefined) numsFrom[k] = body[k];
    }
    const { volume, unitPrice, freightPerUnit, freightTotal, total } = readNumbers(numsFrom);
    /*
     * باگ: در ویرایش، مشتری ناموجود فقط باعث می‌شد نام قدیمی حفظ شود و
     * `customerId` به عددی اشاره کند که چنین مشتری‌ای وجود ندارد (بل یتیم،
     * بدهی گم‌شده). همان بررسیِ «ثبت» اینجا هم لازم است (و گذری هم پشتیبانی
     * می‌شود).
     */
    const cust = await resolveSaleCustomer(merged);
    if (cust.walkIn && merged.paymentType === 'credit') {
      throw new HttpException(
        'فروش «قرضه» به مشتری گذری ثبت نمی‌شود — برای قرضه، مشتری را انتخاب کنید. یا پرداخت را «نقده» بگذارید.', 400,
      );
    }
    /* «مربوط» (شاخه‌ی مصرف): نام از شناسه خوانده می‌شود، نه از کلاینت */
    const branch = await resolveRelatedBranch(merged.contractorId, merged.contractorName);

    /*
     * ── باگ: شماره بل در ویرایش گم می‌شد ────────────────────────────────
     *
     * `PUT` شماره را در `SET` نداشت. فورم ویرایش هم شماره نمی‌فرستاد، پس
     * سرور با «شماره فعلی» کاری نداشت و شماره‌ی روی سند همان قبلی می‌ماند —
     * ولی *فورم* شماره‌ی بعدی (`next-no`) را نشان می‌داد، و کاربر فکر
     * می‌کرد شماره عوض شده. بدتر: اگر شماره واقعاً عوض می‌شد (API/CLI)
     * یکتایی بررسی نمی‌شد و پیام «ویرایش انجام نشد» بی‌ربط می‌داد.
     *
     * حالا: اگر `no` فرستاده نشود، شماره‌ی فعلی **حفظ** می‌شود؛ اگر
     * فرستاده شود، معتبر و یکتا بودنش روشن گزارش می‌شود.
     */
    const currentNo = String(existing.no ?? '');
    const wantedNo = String(body.no ?? '').trim();
    const finalNo = wantedNo || currentNo;
    if (wantedNo && wantedNo !== currentNo) {
      const clash: any[] = await db().$queryRawUnsafe(
        `SELECT "id" FROM "Sale" WHERE "no"=? AND "id"<>?`, wantedNo, sid,
      );
      if (clash?.length) {
        throw new HttpException(`شماره بل «${wantedNo}» قبلاً برای سند دیگری ثبت شده است.`, 409);
      }
    }

    try {
      await db().$executeRawUnsafe(
        `UPDATE "Sale" SET "no"=?, "date"=?, "customerId"=?, "customerName"=?, "driverName"=?, "truckPlate"=?, "destination"=?,
          "materialId"=?, "materialName"=?, "volume"=?, "unitPrice"=?, "freightPerUnit"=?, "freightTotal"=?, "total"=?,
          "contractorId"=?, "contractorName"=?, "paymentType"=?, "note"=? WHERE "id"=?`,
        finalNo, date, cust.id, cust.name || merged.customerName || '', merged.driverName || '',
        merged.truckPlate || '', merged.destination || '', merged.materialId ? Number(merged.materialId) : null,
        merged.materialName || '', volume, unitPrice, freightPerUnit, freightTotal, total,
        branch.contractorId, branch.contractorName,
        merged.paymentType === 'credit' ? 'credit' : 'cash', merged.note || '', sid,
      );
    } catch (e: any) {
      /* خطای اعتبارسنجی خودمان (۴۰۰) نباید به ۵۰۰ تبدیل شود */
      if (e instanceof HttpException) throw e;
      if (/UNIQUE|constraint failed/i.test(String(e?.message || ''))) {
        throw new HttpException('این شماره بل برای سند دیگری ثبت شده است.', 400);
      }
      /* پیام «ویرایش انجام نشد» بی‌علت بود: کاربر نمی‌دانست چه چیزی را
         درست کند (شکار باگ دور ۲۸). */
      throw new HttpException(`ویرایش بل انجام نشد: ${e?.message || e}`, 500);
    }
    await logActivity({ action: 'update', entity: 'Sale', entityId: sid, detail: finalNo });
    return { ok: true, total, no: finalNo };
  }

  @Delete(':id')
  @ManagerOnly()
  async remove(@Req() req: any, @Param('id') id: string) {
    const sid = idParam(id, 'شناسه‌ی بل');
    /*
     * باگ (که تست دور ۱۶ گرفت): اینجا ردیف با `deletedAt` هم شمرده می‌شد، پس
     * حذف یک بل قبلاً حذف‌شده پیام «پیدا نشد» می‌داد (گمراه‌کننده) — و از
     * طرفی اگر ردیف واقعاً نبود، `softDelete` خودش ۴۰۴ می‌دهد.
     * حالا فقط وجود ردیف را می‌سنجیم، بدون شرط حذف.
     */
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "id", "deletedAt" FROM "Sale" WHERE "id"=?`, sid);
    if (!rows?.length) throw new HttpException('بل فروش پیدا نشد.', 404);
    /*
     * حذف «نرم» — درخواست کاربر: «حذف‌ها نرم باشند... از سابقه فعالیت‌ها
     * قابل بازیابی بدون آسیب». ردیف می‌ماند، فقط از همه‌ی فهرست‌ها و
     * گزارش‌ها پنهان می‌شود و از «سطل بازیافت» برمی‌گردد.
     */
    const del = await softDelete("Sale", sid, { username: userOf(req) });
    if (!del.ok) throw new HttpException('ردیف پیدا نشد.', 404);
    return {
      ok: true,
      softDeleted: true,
      already: del.already,
      message: del.already
        ? 'این بل قبلاً حذف شده بود.'
        : 'حذف شد — از «سطل بازیافت» قابل بازگرداندن است.',
    };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const sid = idParam(id, 'شناسه‌ی بل');
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Sale" WHERE "id"=?`, sid);
    if (!rows?.length) throw new HttpException('بل فروش پیدا نشد.', 404);
    const mode = await settingsService.calendar();
    return { ...rows[0], dateDisplay: formatDate(rows[0].date, mode, true) };
  }
}
