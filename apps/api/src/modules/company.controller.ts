import { Body, Controller, Get, Post, Put, UseGuards, Param, Delete, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
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
  async update(@Body() body: any, req?: any) {
    await ensureSchemaAsync();
    const p = db();
    await p.$executeRawUnsafe(`INSERT INTO "Company" ("id") VALUES (1) ON CONFLICT("id") DO NOTHING`);
    await p.$executeRawUnsafe(
      `UPDATE "Company" SET "name"=?, "activityType"=?, "address"=?, "fiscalYear"=?, "financeManager"=?, "supervisor"=?, "phone"=?, "email"=?, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=1`,
      body.name ?? 'فردای روشن',
      body.activityType ?? '',
      body.address ?? '',
      body.fiscalYear ?? '',
      body.financeManager ?? '',
      body.supervisor ?? '',
      body.phone ?? '',
      body.email ?? '',
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
    if (!body?.name) throw new HttpException('نام ماشین لازم است.', 400);
    await db().$executeRawUnsafe(
      `INSERT INTO "Machinery" ("name","model","plateNo","count","status","note") VALUES (?,?,?,?,?,?)`,
      body.name, body.model || '', body.plateNo || '', Number(body.count) || 1, body.status || 'active', body.note || '',
    );
    await logActivity({ action: 'create', entity: 'Machinery', detail: body.name });
    return { ok: true };
  }

  @Put('machinery/:id')
  @ManagerOnly()
  async updateMachinery(@Param('id') id: string, @Body() body: any) {
    const mid = idParam(id, 'شناسه‌ی ماشین');
    await assertLive('Machinery', mid, 'ماشین');
    if (!String(body?.name ?? '').trim()) throw new HttpException('نام ماشین لازم است.', 400);
    await db().$executeRawUnsafe(
      `UPDATE "Machinery" SET "name"=?, "model"=?, "plateNo"=?, "count"=?, "status"=?, "note"=? WHERE "id"=?`,
      body.name, body.model || '', body.plateNo || '', Number(body.count) || 1, body.status || 'active', body.note || '', mid,
    );
    await logActivity({ action: 'update', entity: 'Machinery', entityId: mid, detail: body.name });
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
  async removeMachinery(@Param('id') id: string) {
    const del = await softDelete('Machinery', idParam(id, 'شناسه‌ی ماشین'));
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
