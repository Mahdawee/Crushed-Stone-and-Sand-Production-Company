import { Body, Controller, Get, Post, Put, UseGuards, Param, Delete, Req, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly, userOf } from '../common/auth';
import { logActivity } from '../common/activity';
import { softDelete } from '../common/soft-delete';
import { settingsService, SettingsService, isSettingError } from '../common/settings';
import { idParam } from '../common/params';

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
 * خواندن و اعتبارسنجی بل ماشینری.
 *
 * باگ: تعداد هر عددی پذیرفته می‌شد (منفی/اعشاری) و وضعیت هر رشته‌ای؛
 * فیلترهای UI فقط سه وضعیت را می‌شناسند، پس «وضعیت ناشناخته» ماشین را از
 * همه‌ی فیلترها بیرون می‌انداخت.
 */
const MACHINERY_STATUS = ['active', 'repair', 'idle'];

function readMachinery(body: any) {
  const rawCount = body?.count === '' || body?.count === undefined || body?.count === null ? 1 : Number(body?.count);
  if (!Number.isFinite(rawCount) || !Number.isInteger(rawCount)) {
    throw new HttpException('«تعداد» باید عدد صحیح باشد.', 400);
  }
  if (rawCount < 1) throw new HttpException('«تعداد» باید ۱ یا بیشتر باشد.', 400);
  const status = String(body?.status ?? 'active');
  if (!MACHINERY_STATUS.includes(status)) throw new HttpException('وضعیت ماشین معتبر نیست.', 400);
  return {
    model: String(body?.model ?? '').slice(0, 80),
    plateNo: String(body?.plateNo ?? '').slice(0, 40),
    count: rawCount,
    status,
    note: String(body?.note ?? '').slice(0, 300),
  };
}

@UseGuards(AuthGuard)
@Controller()
export class CompanyController {
  @Get('company')
  async get() {
    await ensureSchemaAsync();
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Company" WHERE "id" = 1`);
    if (!rows?.length) {
      await db().$executeRawUnsafe(`INSERT INTO "Company" ("id") VALUES (1) ON CONFLICT("id") DO NOTHING`);
      const again: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Company" WHERE "id" = 1`);
      return again[0];
    }
    return rows[0];
  }

  @Put('company')
  async update(@Body() body: any) {
    await ensureSchemaAsync();
    /*
     * ── باگ (شکار باگ دور ۲۵) ───────────────────────────────────────────
     * نام شرکت هرچه بود ذخیره می‌شد — حتی رشته‌ی خالی یا فقط فاصله. نام
     * شرکت سرصفحه‌ی **همه‌ی اسناد چاپی** (بل فروش، رسید معاش، راپورها) است؛
     * با نام خالی، فاکتورِ تحویلی به مشتری بی‌نام چاپ می‌شد و کسی هم خطا
     * نمی‌دید. حالا نام الزامی است و طول‌ها محدود شده‌اند.
     */
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpException('نام شرکت لازم است — روی سرصفحه‌ی همه‌ی اسناد چاپی می‌آید.', 400);
    if (name.length > 120) throw new HttpException('نام شرکت حداکثر ۱۲۰ حرف باشد.', 400);
    const p = db();
    await p.$executeRawUnsafe(`INSERT INTO "Company" ("id") VALUES (1) ON CONFLICT("id") DO NOTHING`);
    await p.$executeRawUnsafe(
      `UPDATE "Company" SET "name"=?, "activityType"=?, "address"=?, "fiscalYear"=?, "financeManager"=?, "supervisor"=?, "phone"=?, "email"=?, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=1`,
      name,
      String(body.activityType ?? '').slice(0, 120),
      String(body.address ?? '').slice(0, 200),
      String(body.fiscalYear ?? '').slice(0, 40),
      String(body.financeManager ?? '').slice(0, 80),
      String(body.supervisor ?? '').slice(0, 80),
      String(body.phone ?? '').slice(0, 60),
      String(body.email ?? '').slice(0, 120),
    );
    await logActivity({ action: 'update', entity: 'Company', entityId: 1, detail: 'ویرایش مشخصات شرکت' });
    return this.get();
  }

  // ----------------------------- machinery --------------------------------
  @Get('machinery')
  async listMachinery() {
    /* حذف‌شده‌ها در فهرست نیایند (از «سطل بازیافت» برمی‌گردند) */
    return db().$queryRawUnsafe(
      `SELECT * FROM "Machinery" WHERE COALESCE("deletedAt",'')='' ORDER BY "id"`,
    );
  }

  @Post('machinery')
  @ManagerOnly()
  async addMachinery(@Body() body: any) {
    /*
     * ── باگ (شکار باگ دور ۲۵) ───────────────────────────────────────────
     * ۱) نام فقط «truthy» بررسی می‌شد: `"   "` پذیرفته می‌شد.
     * ۲) تعداد هر عددی بود (منفی/اعشاری/متن) — «۳- عراده» در فهرست ماشینری.
     * ۳) وضعیت هر رشته‌ای بود؛ فیلترهای UI فقط `active`/`repair`/`idle` را
     *    می‌شناسند، پس ماشین با وضعیت ناشناخته از همه‌ی فیلترها می‌افتاد.
     */
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpException('نام ماشین لازم است.', 400);
    const m = readMachinery(body);
    await db().$executeRawUnsafe(
      `INSERT INTO "Machinery" ("name","model","plateNo","count","status","note") VALUES (?,?,?,?,?,?)`,
      name, m.model, m.plateNo, m.count, m.status, m.note,
    );
    await logActivity({ action: 'create', entity: 'Machinery', detail: name });
    return { ok: true };
  }

  @Put('machinery/:id')
  @ManagerOnly()
  async updateMachinery(@Param('id') id: string, @Body() body: any) {
    const mid = idParam(id, 'شناسه‌ی ماشین');
    await assertLive('Machinery', mid, 'ماشین');
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpException('نام ماشین لازم است.', 400);
    const m = readMachinery(body);
    await db().$executeRawUnsafe(
      `UPDATE "Machinery" SET "name"=?, "model"=?, "plateNo"=?, "count"=?, "status"=?, "note"=? WHERE "id"=?`,
      name, m.model, m.plateNo, m.count, m.status, m.note, mid,
    );
    await logActivity({ action: 'update', entity: 'Machinery', entityId: mid, detail: name });
    return { ok: true };
  }

  /**
   * حذف ماشین — **نرم** (درخواست کاربر: حذف بدون از دست رفتن داده).
   *
   * قبلاً سخت حذف می‌شد؛ اگر ماشینی در بل‌ها/گزارش‌ها ارجاع داشت، سابقه
   * بی‌نام و غیرقابل بازگشت می‌شد.
   */
  @Delete('machinery/:id')
  @ManagerOnly()
  async removeMachinery(@Req() req: any, @Param('id') id: string) {
    const del = await softDelete('Machinery', idParam(id, 'شناسه‌ی ماشین'), { username: userOf(req) });
    if (!del.ok) throw new HttpException('ماشین پیدا نشد.', 404);
    return {
      ok: true,
      softDeleted: true,
      already: del.already,
      message: del.already ? 'این ماشین قبلاً حذف شده بود.' : 'حذف شد — از «سطل بازیافت» قابل بازگرداندن است.',
    };
  }

  // ------------------------------ settings --------------------------------
  @Get('settings')
  async getSettings() {
    await settingsService.ensureDefaults();
    return settingsService.all();
  }

  @Put('settings')
  @ManagerOnly()
  async saveSettings(@Body() body: Record<string, string>) {
    /*
     * باگ (فاز تست): مقدار نامعتبر مثل calendar:'martian' با ۲۰۰ ذخیره می‌شد.
     * حالا ۴۰۰ با پیام فارسی برمی‌گردد و هیچ‌چیز ذخیره نمی‌شود.
     */
    for (const [k, v] of Object.entries(body || {})) {
      const err = SettingsService.validate(k, v);
      if (isSettingError(err)) throw new HttpException(err, 400);
    }
    return settingsService.setMany(body);
  }
}
