import { Body, Controller, Req, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly, userOf } from '../common/auth';
import { logActivity } from '../common/activity';
import { softDelete } from '../common/soft-delete';
import {
  allocationForSource, canonicalReceiptSource, receiptDebtSql, reducesCustomerDebt,
  realCustomerSql, isWalkInCustomer,
} from '../common/domain';
import { idParam } from '../common/params';

/**
 * ردیفی که در «سطل بازیافت» است نباید ویرایش شود — با پیام روشن (۴۰۹)،
 * نه ۲۰۰ بی‌اثر. (توضیح کامل در `sales.controller.ts`.)
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

/** عدد نامعتبر (متن/NaN) صفر حساب می‌شود؛ `Infinity` هم صفر است. */
function numOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

@UseGuards(AuthGuard)
@Controller('customers')
export class CustomersController {
  /**
   * Debt = opening + credit sales − receipts that reduce debt.
   *
   * `light=1` فقط کد/نام/موجودی را می‌دهد — برای فهرست‌های کشویی (فورم
   * رسید/فروش/مصرف) که تمام مشتریان را یک‌جا می‌خواهند. قبلاً همه‌ی ستون‌ها
   * (آدرس، تلفن، یادداشت و …) هم فرستاده می‌شد؛ با ۵۰۰ مشتری این پاسخ چند
   * صد کیلوبایت بود و باز شدن فورم کند می‌شد.
   */
  @Get()
  async list(@Query('q') q?: string, @Query('light') light?: string, @Query('walkIn') walkIn?: string) {
    await ensureSchemaAsync();
    const args: any[] = [];
    /* حذف‌نرم: مشتری حذف‌شده در فهرست نیاید (پرانتز لازم است، وگرنه OR
       بقیه‌ی شرط‌ها را بی‌اثر می‌کند — باگ کلاسیک SQL). */
    /*
     * «مشتری گذری» در فهرست مشتریان نمایش داده نمی‌شود — نه به‌خاطر پنهان‌کاری،
     * بلکه چون حساب واقعی نیست و کاربر نباید آن را با مشتری واقعی اشتباه
     * بگیرد. بل‌های آن در فهرست فروشات و در گزارش‌ها کامل دیده می‌شوند.
     * با `walkIn=1` می‌توان فقط همان را دید (برای مرور فروش گذری).
     */
    const walkInOnly = walkIn === '1' || walkIn === 'true';
    let where = walkInOnly
      ? `WHERE COALESCE(c."deletedAt",'')='' AND COALESCE(c."isWalkIn",0)=1`
      : `WHERE COALESCE(c."deletedAt",'')='' AND ${realCustomerSql('c')}`;
    if (q) {
      where += ` AND (c."name" LIKE ? OR c."code" LIKE ? OR c."phone" LIKE ? OR c."contactPerson" LIKE ?)`;
      args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const lightMode = light === '1' || light === 'true';
    const rows: any[] = await db().$queryRawUnsafe(
      lightMode
        ? `SELECT c."id", c."code", c."name", c."phone", c."openingBalance",
        (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE s."customerId"=c."id" AND COALESCE(s."deletedAt",'')='' AND s."paymentType"='credit') AS creditSales,
        (SELECT COALESCE(SUM(r."amount"),0) FROM "Receipt" r WHERE r."customerId"=c."id" AND COALESCE(r."deletedAt",'')='' AND ${receiptDebtSql('r."sourceName"')}) AS receipts
       FROM "Customer" c ${where} ORDER BY c."name"`
        : `SELECT c.*,
        (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE s."customerId"=c."id" AND COALESCE(s."deletedAt",'')='' AND s."paymentType"='credit') AS creditSales,
        (SELECT COALESCE(SUM(s."total"),0) FROM "Sale" s WHERE s."customerId"=c."id" AND COALESCE(s."deletedAt",'')='') AS allSales,
        (SELECT COALESCE(SUM(r."amount"),0) FROM "Receipt" r WHERE r."customerId"=c."id" AND COALESCE(r."deletedAt",'')='' AND ${receiptDebtSql('r."sourceName"')}) AS receipts
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
    const cid = idParam(id, 'شناسه‌ی مشتری');
    await ensureSchemaAsync();
    const c: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Customer" WHERE "id"=?`, cid);
    if (!c?.length) throw new HttpException('مشتری پیدا نشد.', 404);
    /*
     * کارت حساب فقط اسناد «زنده» را نشان می‌دهد. باگ: اسناد حذف‌نرم‌شده هم
     * می‌آمدند و مانده‌ی پایانی کارت حساب با مانده‌ی فهرست مشتریان نمی‌خواند.
     */
    const sales: any[] = await db().$queryRawUnsafe(
      `SELECT "id","no","date","materialName","volume","total","paymentType","note" FROM "Sale"
       WHERE "customerId"=? AND COALESCE("deletedAt",'')=''`,
      cid,
    );
    const receipts: any[] = await db().$queryRawUnsafe(
      `SELECT "id","no","date","amount","relatedBillNo","sourceName","note" FROM "Receipt"
       WHERE "customerId"=? AND COALESCE("deletedAt",'')=''`,
      cid,
    );
    const rows = [
      ...sales.map((s) => ({
        date: s.date, type: s.paymentType === 'credit' ? 'فروش (باقی)' : 'فروش (نقده)',
        doc: s.no, detail: `${s.materialName} — ${s.volume} متر مکعب`,
        // a cash sale is settled on the spot: it appears on both sides so the
        // running balance only moves with credit sales and receipts
        debit: Number(s.total) || 0,
        credit: s.paymentType === 'credit' ? 0 : Number(s.total) || 0,
        id: `s${s.id}`,
      })),
      ...receipts.map((r) => ({
        date: r.date,
        type: `رسید (${canonicalReceiptSource(r.sourceName) || 'باقی داری'})`,
        doc: r.no,
        detail: r.relatedBillNo ? `بل مربوط: ${r.relatedBillNo}` : '',
        /*
         * «امانت» پولی است که نزد شرکت امانت است و از بدهی کم نمی‌شود.
         * تصمیم با `reducesCustomerDebt` گرفته می‌شود تا اگر روزی منبع
         * تازه‌ای اضافه شد، کارت حساب و فهرست مشتریان یک حرف بزنند.
         */
        allocation: allocationForSource(r.sourceName),
        debit: 0,
        credit: reducesCustomerDebt(null, r.sourceName) ? Number(r.amount) || 0 : 0,
        amount: Number(r.amount) || 0,
        id: `r${r.id}`,
      })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
    let bal = Number(c[0].openingBalance) || 0;
    const opening = bal;
    const out = rows.map((r) => {
      bal += r.debit - r.credit;
      return { ...r, balance: bal };
    });
    const totals = out.reduce((a, r) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit }), { debit: 0, credit: 0 });
    return {
      customer: c[0], opening, rows: out, totals, closing: bal,
      walkIn: isWalkInCustomer(c[0]),
    };
  }

  @Post()
  async create(@Body() body: any) {
    await ensureSchemaAsync();
    /*
     * ── باگ (شکار باگ دور ۲۵) ───────────────────────────────────────────
     * `if (!body?.name)` رشته‌ی «   » را قبول می‌کرد؛ مشتریِ بی‌نام در
     * فهرست و روی بل فروش ظاهر می‌شد و در راپورها زیر «—» می‌رفت.
     */
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpException('نام مشتری لازم است.', 400);
    if (name.length > 120) throw new HttpException('نام مشتری حداکثر ۱۲۰ حرف باشد.', 400);
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Customer"`);
    const nums = rows.map((r) => Number(String(r.code).replace(/\D/g, '')) || 0);
    const code = String(body.code || '').trim() || String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
    /* کد ۰۰۰ مالِ «مشتری گذری» است — دو حساب نباید همان کد را بگیرند */
    if (code === '000') throw new HttpException('کد «۰۰۰» برای «مشتری گذری» رزرو است؛ کد دیگری بدهید.', 400);
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "Customer" ("code","name","contactPerson","phone","truckPlate","openingBalance","note") VALUES (?,?,?,?,?,?,?)`,
        code, name, String(body.contactPerson ?? '').slice(0, 80), String(body.phone ?? '').slice(0, 60),
        String(body.truckPlate ?? '').slice(0, 40),
        numOrZero(body.openingBalance), String(body.note ?? '').slice(0, 300),
      );
    } catch {
      throw new HttpException('این کد مشتری قبلاً ثبت شده است.', 400);
    }
    await logActivity({ action: 'create', entity: 'Customer', detail: `${code} — ${name}` });
    return { ok: true, code };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const cid = idParam(id, 'شناسه‌ی مشتری');
    await assertLive('Customer', cid, 'مشتری');
    await ensureSchemaAsync();
    const row: any[] = await db().$queryRawUnsafe(`SELECT "isWalkIn" FROM "Customer" WHERE "id"=?`, cid);
    if (Number(row?.[0]?.isWalkIn) === 1) {
      throw new HttpException('«مشتری گذری» یک ردیف سیستمی است و ویرایش نمی‌شود.', 400);
    }
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpException('نام مشتری لازم است.', 400);
    /*
     * ── باگ (شکار باگ دور ۲۵) ───────────────────────────────────────────
     * ویرایش، کد را **بدون هیچ بررسی** می‌نوشت: می‌شد کد یک مشتری را به
     * «۰۰۰» (کد رزروشده‌ی مشتری گذری) تغییر داد — بعد از آن دو حساب با یک
     * کد در فهرست بودند و جست‌وجو/چاپ بل گیج‌کننده می‌شد. کد خالی هم
     * اجازه داشت (پیام «کد تکراری است» می‌داد که ربطی به خطا نداشت).
     */
    const wantedCode = String(body?.code ?? '').trim();
    const curRow: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Customer" WHERE "id"=?`, cid);
    const code = wantedCode || String(curRow?.[0]?.code ?? '');
    if (!code) throw new HttpException('کد مشتری لازم است.', 400);
    if (code === '000') throw new HttpException('کد «۰۰۰» برای «مشتری گذری» رزرو است؛ کد دیگری بدهید.', 400);
    try {
      await db().$executeRawUnsafe(
        `UPDATE "Customer" SET "code"=?, "name"=?, "contactPerson"=?, "phone"=?, "truckPlate"=?, "openingBalance"=?, "note"=? WHERE "id"=?`,
        code, name, String(body.contactPerson ?? '').slice(0, 80), String(body.phone ?? '').slice(0, 60),
        String(body.truckPlate ?? '').slice(0, 40), numOrZero(body.openingBalance),
        String(body.note ?? '').slice(0, 300), cid,
      );
    } catch {
      throw new HttpException('کد مشتری تکراری است یا معلومات ناقص است.', 400);
    }
    await logActivity({ action: 'update', entity: 'Customer', entityId: cid, detail: name });
    return { ok: true };
  }

  @Delete(':id')
  @ManagerOnly()
  async remove(@Req() req: any, @Param('id') id: string) {
    /*
     * باگ: حذف مشتری به‌خاطر سندهای «حذف‌نرم‌شده» هم رد می‌شد، در حالی که
     * آن سندها از دید کاربر وجود ندارند و از سطل بازیافت برمی‌گردند.
     */
    const cid = idParam(id, 'شناسه‌ی مشتری');
    const guard: any[] = await db().$queryRawUnsafe(`SELECT "isWalkIn" FROM "Customer" WHERE "id"=?`, cid);
    if (Number(guard?.[0]?.isWalkIn) === 1) {
      throw new HttpException('«مشتری گذری» حذف‌شدنی نیست — ستون فروشِ بدون حساب است.', 400);
    }
    const s: any[] = await db().$queryRawUnsafe(
      `SELECT COUNT(*) as c FROM "Sale" WHERE "customerId"=? AND COALESCE("deletedAt",'')=''`, cid);
    const r: any[] = await db().$queryRawUnsafe(
      `SELECT COUNT(*) as c FROM "Receipt" WHERE "customerId"=? AND COALESCE("deletedAt",'')=''`, cid);
    if (Number(s?.[0]?.c) + Number(r?.[0]?.c) > 0) {
      throw new HttpException('این مشتری دارای فروش یا رسید است و حذف نمی‌شود.', 400);
    }
    /*
     * حذف «نرم» — درخواست کاربر: «حذف‌ها نرم باشند... از سابقه فعالیت‌ها
     * قابل بازیابی بدون آسیب». ردیف می‌ماند، فقط از همه‌ی فهرست‌ها و
     * گزارش‌ها پنهان می‌شود و از «سطل بازیافت» برمی‌گردد.
     */
    const del = await softDelete("Customer", cid, { username: userOf(req) });
    if (!del.ok) throw new HttpException('ردیف پیدا نشد.', 404);
    /*
     * باگ: این ثبت سابقه **بعد از return** بود و هرگز اجرا نمی‌شد؛ یعنی
     * حذف در «سابقه فعالیت‌ها» نمی‌آمد و «قابل بازیابی بودن» فقط روی
     * کاغذ بود. حالا قبل از برگشت ثبت می‌شود.
     */
    await logActivity({ action: 'delete', entity: 'Customer', entityId: cid });
    return { ok: true, softDeleted: true, message: 'حذف شد — از «سطل بازیافت» قابل بازگرداندن است.' };
  }
}
