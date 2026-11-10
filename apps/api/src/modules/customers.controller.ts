import { Body, Controller, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { logActivity } from '../common/activity';

@UseGuards(AuthGuard)
@Controller('customers')
export class CustomersController {
  /** Debt = opening + credit sales − receipts that reduce debt. */
  @Get()
  async list(@Query('q') q?: string) {
    await ensureSchemaAsync();
    const args: any[] = [];
    let where = '';
    if (q) {
      where = `WHERE c."name" LIKE ? OR c."code" LIKE ? OR c."phone" LIKE ? OR c."contactPerson" LIKE ?`;
      args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT c.*,
        (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE s."customerId"=c."id" AND s."paymentType"='credit') AS creditSales,
        (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE s."customerId"=c."id") AS allSales,
        (SELECT COALESCE(SUM(r."amount"),0) FROM "Receipt" r WHERE r."customerId"=c."id" AND COALESCE(r."sourceName",'') <> 'امانت') AS receipts
       FROM "Customer" c ${where} ORDER BY c."name"`,
      ...args,
    );
    return rows.map((r) => ({
      ...r,
      creditSales: Number(r.creditSales) || 0,
      allSales: Number(r.allSales) || 0,
      receipts: Number(r.receipts) || 0,
      balance: (Number(r.openingBalance) || 0) + (Number(r.creditSales) || 0) - (Number(r.receipts) || 0),
    }));
  }

  @Get('next-code')
  async nextCode() {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Customer"`);
    const nums = rows.map((r) => Number(String(r.code).replace(/\D/g, '')) || 0);
    return { code: String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0') };
  }

  /** Customer statement (کارت حساب) with running balance. */
  @Get(':id/statement')
  async statement(@Param('id') id: string) {
    await ensureSchemaAsync();
    const c: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Customer" WHERE "id"=?`, Number(id));
    if (!c?.length) throw new HttpException('مشتری پیدا نشد.', 404);
    const sales: any[] = await db().$queryRawUnsafe(
      `SELECT "id","no","date","materialName","volume","total","paymentType","note" FROM "Sale" WHERE "customerId"=?`,
      Number(id),
    );
    const receipts: any[] = await db().$queryRawUnsafe(
      `SELECT "id","no","date","amount","relatedBillNo","sourceName","note" FROM "Receipt" WHERE "customerId"=?`,
      Number(id),
    );
    const rows = [
      ...sales.map((s) => ({
        date: s.date, type: s.paymentType === 'credit' ? 'فروش (باقی)' : 'فروش (نقده)',
        doc: s.no, detail: `${s.materialName} — ${s.volume} متر مکعب`,
        debit: Number(s.total) || 0, credit: 0, id: `s${s.id}`,
      })),
      ...receipts.map((r) => ({
        date: r.date, type: `رسید (${r.sourceName || 'باقی داری'})`, doc: r.no,
        detail: r.relatedBillNo ? `بل مربوط: ${r.relatedBillNo}` : '',
        debit: 0, credit: Number(r.amount) || 0, id: `r${r.id}`,
      })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
    let bal = Number(c[0].openingBalance) || 0;
    const opening = bal;
    const out = rows.map((r) => {
      bal += r.debit - r.credit;
      return { ...r, balance: bal };
    });
    const totals = out.reduce((a, r) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit }), { debit: 0, credit: 0 });
    return { customer: c[0], opening, rows: out, totals, closing: bal };
  }

  @Post()
  async create(@Body() body: any) {
    await ensureSchemaAsync();
    if (!body?.name) throw new HttpException('نام مشتری لازم است.', 400);
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Customer"`);
    const nums = rows.map((r) => Number(String(r.code).replace(/\D/g, '')) || 0);
    const code = String(body.code || '').trim() || String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "Customer" ("code","name","contactPerson","phone","truckPlate","openingBalance","note") VALUES (?,?,?,?,?,?,?)`,
        code, body.name, body.contactPerson || '', body.phone || '', body.truckPlate || '',
        Number(body.openingBalance) || 0, body.note || '',
      );
    } catch {
      throw new HttpException('این کد مشتری قبلاً ثبت شده است.', 400);
    }
    await logActivity({ action: 'create', entity: 'Customer', detail: `${code} — ${body.name}` });
    return { ok: true, code };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    try {
      await db().$executeRawUnsafe(
        `UPDATE "Customer" SET "code"=?, "name"=?, "contactPerson"=?, "phone"=?, "truckPlate"=?, "openingBalance"=?, "note"=? WHERE "id"=?`,
        String(body.code || '').trim(), body.name, body.contactPerson || '', body.phone || '',
        body.truckPlate || '', Number(body.openingBalance) || 0, body.note || '', Number(id),
      );
    } catch {
      throw new HttpException('کد مشتری تکراری است یا معلومات ناقص است.', 400);
    }
    await logActivity({ action: 'update', entity: 'Customer', entityId: Number(id), detail: body.name });
    return { ok: true };
  }

  @Delete(':id')
  @ManagerOnly()
  async remove(@Param('id') id: string) {
    const s: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Sale" WHERE "customerId"=?`, Number(id));
    const r: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Receipt" WHERE "customerId"=?`, Number(id));
    if (Number(s?.[0]?.c) + Number(r?.[0]?.c) > 0) {
      throw new HttpException('این مشتری دارای فروش یا رسید است و حذف نمی‌شود.', 400);
    }
    await db().$executeRawUnsafe(`DELETE FROM "Customer" WHERE "id"=?`, Number(id));
    await logActivity({ action: 'delete', entity: 'Customer', entityId: Number(id) });
    return { ok: true };
  }
}
