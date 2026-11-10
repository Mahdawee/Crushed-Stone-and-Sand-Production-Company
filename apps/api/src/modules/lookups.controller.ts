import { Body, Controller, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { logActivity } from '../common/activity';

export const LOOKUP_TYPES: Record<string, string> = {
  material: 'اقلام و مواد',
  expense_category: 'انواع مصرف',
  payer: 'پرداخت‌کنندگان',
  receipt_source: 'منابع رسیدات',
  contractor: 'باربری‌ها / دمترک‌ها',
};

/** How many documents already use a lookup row (used for safe delete logic). */
async function usageCount(type: string, id: number, name: string): Promise<number> {
  const p = db();
  switch (type) {
    case 'material': {
      const r: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Sale" WHERE "materialId"=? OR "materialName"=?`, id, name);
      return Number(r?.[0]?.c ?? 0);
    }
    case 'expense_category': {
      const r: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Expense" WHERE "categoryId"=? OR "categoryName"=?`, id, name);
      return Number(r?.[0]?.c ?? 0);
    }
    case 'payer': {
      const a: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Expense" WHERE "payerId"=? OR "payerName"=?`, id, name);
      const b: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Salary" WHERE "payerName"=?`, name);
      return Number(a?.[0]?.c ?? 0) + Number(b?.[0]?.c ?? 0);
    }
    case 'receipt_source': {
      const r: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Receipt" WHERE "sourceId"=? OR "sourceName"=?`, id, name);
      return Number(r?.[0]?.c ?? 0);
    }
    case 'contractor': {
      const a: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Sale" WHERE "contractorId"=? OR "contractorName"=?`, id, name);
      const b: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Expense" WHERE "contractorId"=? OR "contractorName"=?`, id, name);
      return Number(a?.[0]?.c ?? 0) + Number(b?.[0]?.c ?? 0);
    }
    default:
      return 0;
  }
}

@UseGuards(AuthGuard)
@Controller('lookups')
export class LookupsController {
  @Get()
  async all(@Query('includeInactive') includeInactive?: string) {
    await ensureSchemaAsync();
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "LookupItem" ORDER BY "type", "sortOrder", "id"`,
    );
    const grouped: Record<string, any[]> = {};
    for (const key of Object.keys(LOOKUP_TYPES)) grouped[key] = [];
    for (const r of rows) {
      if (!includeInactive && !r.active) continue;
      (grouped[r.type] = grouped[r.type] || []).push(r);
    }
    return { types: LOOKUP_TYPES, items: grouped };
  }

  @Get('manage')
  async manage(@Query('type') type: string) {
    await ensureSchemaAsync();
    if (!LOOKUP_TYPES[type]) throw new HttpException('نوع فهرست ناشناخته است.', 400);
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "LookupItem" WHERE "type"=? ORDER BY "sortOrder", "id"`,
      type,
    );
    const out = [];
    for (const r of rows) out.push({ ...r, active: !!r.active, usage: await usageCount(type, r.id, r.name) });
    return { type, title: LOOKUP_TYPES[type], rows: out };
  }

  @Post()
  @ManagerOnly()
  async create(@Body() body: any) {
    await ensureSchemaAsync();
    if (!LOOKUP_TYPES[body?.type]) throw new HttpException('نوع فهرست ناشناخته است.', 400);
    if (!body?.name) throw new HttpException('نام لازم است.', 400);
    const max: any[] = await db().$queryRawUnsafe(
      `SELECT COALESCE(MAX("sortOrder"),0) as m FROM "LookupItem" WHERE "type"=?`,
      body.type,
    );
    await db().$executeRawUnsafe(
      `INSERT INTO "LookupItem" ("type","name","extra","sortOrder","active") VALUES (?,?,?,?,?)`,
      body.type, body.name.trim(), body.extra || '', Number(body.sortOrder) || Number(max?.[0]?.m ?? 0) + 1, 1,
    );
    await logActivity({ action: 'create', entity: 'LookupItem', detail: `${body.type}: ${body.name}` });
    return { ok: true };
  }

  @Put(':id')
  @ManagerOnly()
  async update(@Param('id') id: string, @Body() body: any) {
    await db().$executeRawUnsafe(
      `UPDATE "LookupItem" SET "name"=?, "extra"=?, "sortOrder"=?, "active"=? WHERE "id"=?`,
      body.name, body.extra || '', Number(body.sortOrder) || 0, body.active ? 1 : 0, Number(id),
    );
    await logActivity({ action: 'update', entity: 'LookupItem', entityId: Number(id), detail: body.name });
    return { ok: true };
  }

  /** Safe delete: used rows are de-activated instead of being removed. */
  @Delete(':id')
  @ManagerOnly()
  async remove(@Param('id') id: string) {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "LookupItem" WHERE "id"=?`, Number(id));
    if (!rows?.length) throw new HttpException('ردیف پیدا نشد.', 404);
    const used = await usageCount(rows[0].type, rows[0].id, rows[0].name);
    if (used > 0) {
      await db().$executeRawUnsafe(`UPDATE "LookupItem" SET "active"=0 WHERE "id"=?`, Number(id));
      await logActivity({ action: 'update', entity: 'LookupItem', entityId: Number(id), detail: `غیر فعال شد (${used} سند)` });
      return { ok: true, deactivated: true, usage: used };
    }
    await db().$executeRawUnsafe(`DELETE FROM "LookupItem" WHERE "id"=?`, Number(id));
    await logActivity({ action: 'delete', entity: 'LookupItem', entityId: Number(id) });
    return { ok: true, deactivated: false, usage: 0 };
  }

  @Post('reorder')
  @ManagerOnly()
  async reorder(@Body() body: { type: string; ids: number[] }) {
    let i = 1;
    for (const id of body.ids || []) {
      await db().$executeRawUnsafe(`UPDATE "LookupItem" SET "sortOrder"=? WHERE "id"=?`, i++, Number(id));
    }
    return { ok: true };
  }
}
