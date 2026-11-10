import { Body, Controller, Get, Post, Put, UseGuards, Param, Delete, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { logActivity } from '../common/activity';
import { settingsService } from '../common/settings';

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
    return db().$queryRawUnsafe(`SELECT * FROM "Machinery" ORDER BY "id"`);
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
    await db().$executeRawUnsafe(
      `UPDATE "Machinery" SET "name"=?, "model"=?, "plateNo"=?, "count"=?, "status"=?, "note"=? WHERE "id"=?`,
      body.name, body.model || '', body.plateNo || '', Number(body.count) || 1, body.status || 'active', body.note || '', Number(id),
    );
    return { ok: true };
  }

  @Delete('machinery/:id')
  @ManagerOnly()
  async removeMachinery(@Param('id') id: string) {
    await db().$executeRawUnsafe(`DELETE FROM "Machinery" WHERE "id"=?`, Number(id));
    await logActivity({ action: 'delete', entity: 'Machinery', entityId: Number(id) });
    return { ok: true };
  }

  // ------------------------------ settings --------------------------------
  @Get('settings')
  async getSettings() {
    await settingsService.ensureDefaults();
    return settingsService.all();
  }

  @Put('settings')
  async saveSettings(@Body() body: Record<string, string>) {
    return settingsService.setMany(body);
  }
}
