import { Body, Controller, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { idParam } from '../common/params';
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

/**
 * چند سند از این ردیف فهرست استفاده می‌کند؟
 *
 * از این عدد برای «حذف امن» استفاده می‌شود: اگر سندی به ردیف وصل است،
 * حذفش داده‌ی قدیمی را بی‌نام می‌کند.
 *
 * ⚠ اسناد «حذف نرم»‌شده شمرده **نمی‌شوند**: آن‌ها از دید کاربر وجود ندارند،
 * پس نباید جلوی حذف یک ردیف فهرست را بگیرند. اگر روزی بازیابی شدند، نام
 * ردیف در سند ذخیره شده (`materialName` و مانند آن) و نمایش درست می‌ماند —
 * دقیقاً به همین دلیل نام‌ها در کنار شناسه ذخیره می‌شوند.
 */
const LIVE = `COALESCE("deletedAt",'')=''`;

async function usageCount(type: string, id: number, name: string): Promise<number> {
  const p = db();
  const n = (r: any[]) => Number(r?.[0]?.c ?? 0);
  switch (type) {
    case 'material':
      return n(await p.$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM "Sale" WHERE ${LIVE} AND ("materialId"=? OR "materialName"=?)`, id, name));
    case 'expense_category':
      return n(await p.$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM "Expense" WHERE ${LIVE} AND ("categoryId"=? OR "categoryName"=?)`, id, name));
    case 'payer': {
      const a = n(await p.$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM "Expense" WHERE ${LIVE} AND ("payerId"=? OR "payerName"=?)`, id, name));
      const b = n(await p.$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM "Salary" WHERE ${LIVE} AND "payerName"=?`, name));
      return a + b;
    }
    case 'receipt_source':
      return n(await p.$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM "Receipt" WHERE ${LIVE} AND ("sourceId"=? OR "sourceName"=?)`, id, name));
    case 'contractor': {
      const a = n(await p.$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM "Sale" WHERE ${LIVE} AND ("contractorId"=? OR "contractorName"=?)`, id, name));
      const b = n(await p.$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM "Expense" WHERE ${LIVE} AND ("contractorId"=? OR "contractorName"=?)`, id, name));
      return a + b;
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
    /*
     * ── باگ (شکار باگ دور ۲۵) ───────────────────────────────────────────
     * نام فقط «وجود» بررسی می‌شد، نه محتوایش: نامی که فقط فاصله بود
     * (`"   "`) یا تکرار نام موجود، ذخیره می‌شد. نتیجه: دو قلم با یک نام در
     * فهرست مواد/باربری، و انتخاب‌های کاربر در گزارش‌ها روی هم می‌افتاد
     * (چون گزارش‌ها با **نام** گروه می‌کنند).
     */
    await ensureSchemaAsync();
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpException('نام لازم است.', 400);
    if (name.length > 80) throw new HttpException('نام حداکثر ۸۰ حرف باشد.', 400);
    const dup: any[] = await db().$queryRawUnsafe(
      `SELECT "id" FROM "LookupItem" WHERE "type"=? AND lower(trim("name"))=lower(?)`, body.type, name,
    );
    if (dup?.length) throw new HttpException('این نام قبلاً در همین فهرست ثبت شده است.', 409);
    const max: any[] = await db().$queryRawUnsafe(
      `SELECT COALESCE(MAX("sortOrder"),0) as m FROM "LookupItem" WHERE "type"=?`,
      body.type,
    );
    await db().$executeRawUnsafe(
      `INSERT INTO "LookupItem" ("type","name","extra","sortOrder","active") VALUES (?,?,?,?,?)`,
      body.type, name, body.extra || '', Number(body.sortOrder) || Number(max?.[0]?.m ?? 0) + 1, 1,
    );
    await logActivity({ action: 'create', entity: 'LookupItem', detail: `${body.type}: ${name}` });
    return { ok: true };
  }

  @Put(':id')
  @ManagerOnly()
  async update(@Param('id') id: string, @Body() body: any) {
    const lid = idParam(id, 'شناسه‌ی قلم');
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpException('نام قلم لازم است.', 400);
    /*
     * ── باگ (شکار باگ دور ۲۵) ───────────────────────────────────────────
     * ۱) ردیف ناموجود سکوت می‌کرد و **۲۰۰ «ذخیره شد»** برمی‌گرداند؛ کاربر
     *    فکر می‌کرد ویرایش شده (همان کلاس باگِ «ویرایش ردیف سطل بازیافت»).
     * ۲) نام تکراری پذیرفته می‌شد (دو قلم هم‌نام).
     */
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT "id","type" FROM "LookupItem" WHERE "id"=?`, lid,
    );
    if (!rows?.length) throw new HttpException('این قلم پیدا نشد (ممکن است حذف شده باشد).', 404);
    const dup: any[] = await db().$queryRawUnsafe(
      `SELECT "id" FROM "LookupItem" WHERE "type"=? AND lower(trim("name"))=lower(?) AND "id"<>?`,
      rows[0].type, name, lid,
    );
    if (dup?.length) throw new HttpException('نام تکراری است — قلم دیگری با همین نام در این فهرست هست.', 409);

    await db().$executeRawUnsafe(
      `UPDATE "LookupItem" SET "name"=?, "extra"=?, "sortOrder"=?, "active"=? WHERE "id"=?`,
      name, body.extra || '', Number(body.sortOrder) || 0, body.active ? 1 : 0, lid,
    );
    await logActivity({ action: 'update', entity: 'LookupItem', entityId: lid, detail: name });
    return { ok: true };
  }

  /** Safe delete: used rows are de-activated instead of being removed. */
  @Delete(':id')
  @ManagerOnly()
  async remove(@Param('id') id: string) {
    const lid = idParam(id, 'شناسه‌ی قلم');
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "LookupItem" WHERE "id"=?`, lid);
    if (!rows?.length) throw new HttpException('ردیف پیدا نشد.', 404);
    const used = await usageCount(rows[0].type, rows[0].id, rows[0].name);
    if (used > 0) {
      await db().$executeRawUnsafe(`UPDATE "LookupItem" SET "active"=0 WHERE "id"=?`, lid);
      await logActivity({ action: 'update', entity: 'LookupItem', entityId: lid, detail: `غیر فعال شد (${used} سند)` });
      return { ok: true, deactivated: true, usage: used };
    }
    await db().$executeRawUnsafe(`DELETE FROM "LookupItem" WHERE "id"=?`, lid);
    await logActivity({ action: 'delete', entity: 'LookupItem', entityId: lid });
    return { ok: true, deactivated: false, usage: 0 };
  }

  @Post('reorder')
  @ManagerOnly()
  async reorder(@Body() body: { type: string; ids: number[] }) {
    /*
     * ── باگ (شکار باگ دور ۲۵) ───────────────────────────────────────────
     * `reorder` هیچ بررسی‌ای نداشت: هر شناسه‌ای (حتی از نوع دیگر، یا عدد
     * نامعتبر) بی‌صدا `sortOrder` را عوض می‌کرد و ترتیب فهرست‌های دیگر
     * را هم به‌هم می‌ریخت. حالا: نوع معتبر + شناسه‌های عددی + فقط ردیف‌های
     * همان نوع.
     */
    if (!LOOKUP_TYPES[body?.type]) throw new HttpException('نوع فهرست ناشناخته است.', 400);
    const ids = (body.ids || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) throw new HttpException('فهرست خالی است.', 400);
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT "id" FROM "LookupItem" WHERE "type"=?`, body.type,
    );
    const allowed = new Set(rows.map((r) => Number(r.id)));
    const foreign = ids.filter((id) => !allowed.has(id));
    if (foreign.length) throw new HttpException('چند ردیف به این فهرست تعلق ندارند.', 400);

    let i = 1;
    for (const id of ids) {
      await db().$executeRawUnsafe(`UPDATE "LookupItem" SET "sortOrder"=? WHERE "id"=?`, i++, id);
    }
    await logActivity({ action: 'update', entity: 'LookupItem', detail: `ترتیب ${body.type} — ${ids.length} قلم` });
    return { ok: true, count: ids.length };
  }
}
