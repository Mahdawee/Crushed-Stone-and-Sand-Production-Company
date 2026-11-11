import { Body, Controller, Req, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly, userOf } from '../common/auth';
import { logActivity } from '../common/activity';
import { softDelete } from '../common/soft-delete';
import { settingsService } from '../common/settings';
import { parseUserDate, monthBucket, todayISO, CalendarMode, daysBetween } from '../common/calendar';
import { idParam } from '../common/params';

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

/** عدد نامعتبر (متن/NaN/Infinity) صفر حساب می‌شود. */
function numOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

@UseGuards(AuthGuard)
@Controller()
export class EmployeesController {
  private async cal(): Promise<CalendarMode> {
    return settingsService.calendar();
  }

  // ------------------------------- employees -------------------------------
  @Get('employees')
  async list(@Query('q') q?: string, @Query('status') status?: string) {
    await ensureSchemaAsync();
    const where: string[] = [`COALESCE("deletedAt",'')=''`];
    const args: any[] = [];
    if (q) {
      where.push(`("name" LIKE ? OR "code" LIKE ? OR "position" LIKE ? OR "phone" LIKE ?)`);
      args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) {
      where.push(`"status" = ?`);
      args.push(status);
    }
    const sql = `SELECT * FROM "Employee" ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY "code"`;
    const rows: any[] = await db().$queryRawUnsafe(sql, ...args);
    const mode = await this.cal();
    /*
     * ── باگ کارایی (شکار باگ دور ۲۴) ─────────────────────────────────────
     * نسخه‌ی قبلی برای **هر کارمند** یک کوئری جدا می‌زد (N+1). با ۳۰۰ کارمند
     * یعنی ۳۰۰ رفت‌وبرگشت به دیتابیس و چند ثانیه معطلی در فهرست کارمندان.
     * حالا یک کوئری گروهی؛ نتیجه عددبه‌عدد یکسان.
     */
    const counts: any[] = await db().$queryRawUnsafe(
      `SELECT "employeeId", COUNT(*) AS c FROM "Salary"
        WHERE COALESCE("deletedAt",'')='' GROUP BY "employeeId"`,
    );
    const byEmp = new Map<number, number>(counts.map((c) => [Number(c.employeeId), Number(c.c) || 0]));
    const enriched = rows.map((r) => ({
      ...r,
      salaryCount: byEmp.get(Number(r.id)) ?? 0,
      hireDateDisplay: r.hireDate,
    }));
    return { rows: enriched, calendar: mode };
  }

  /*
   * مسیرهای حضور و غیاب آگاهانه قبل از مسیرهای پارامتری (`employees/:id`)
   * ثبت می‌شوند. الان تعارضی وجود ندارد (چون این مسیرها با «employees/» شروع
   * نمی‌شوند)، ولی این ترتیب از این پس هر ویرایشی را ایمن می‌کند: در NestJS
   * اولین مسیر منطبق برنده است و یک مسیر پارامتری که زودتر ثبت شود می‌تواند
   * مسیرهای ثابت خواهر را بی‌صدا ببلعد (۴۰۴ گمراه‌کننده).
   * نگهبان خودکار: `npm run test:routes`.
   */
  @Get('attendance')
  async attendance(@Query('month') month: string, @Query('date') date: string) {
    await ensureSchemaAsync();
    const mode = await this.cal();
    const employees: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Employee" WHERE "status"='active' AND COALESCE("deletedAt",'')='' ORDER BY "code"`,
    );
    if (date) {
      let iso = '';
      try { iso = parseUserDate(date, mode); }
      catch (e: any) { throw new HttpException(e.message, 400); }
      const rows: any[] = await db().$queryRawUnsafe(
        `SELECT * FROM "Attendance" WHERE "date"=? AND COALESCE("deletedAt",'')=''`, iso);
      return { mode, date: iso, employees, rows };
    }
    // month = "1404-08" in the active calendar
    const m = String(month || '').match(/^(\d{4})[\/\-](\d{1,2})$/);
    const today = todayISO();
    let ref = today;
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const { fromCalendar } = await import('../common/calendar');
      ref = fromCalendar(y, mo, 1, mode);
    }
    const bucket = monthBucket(ref, mode);
    let days: string[] = [];
    try { days = daysBetween(bucket.start, bucket.end); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Attendance" WHERE "date" >= ? AND "date" <= ? AND COALESCE("deletedAt",'')='' ORDER BY "date"`,
      bucket.start,
      bucket.end,
    );
    const salaries: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Salary" WHERE "periodStart" = ? AND COALESCE("deletedAt",'')=''`,
      bucket.start,
    );
    return {
      mode,
      month: `${bucket.year}-${String(bucket.month).padStart(2, '0')}`,
      label: bucket.label,
      start: bucket.start,
      end: bucket.end,
      days,
      employees,
      rows,
      salariesThen: salaries.length,
    };
  }

  /** Bulk save of a day sheet / month cell. */
  @Post('attendance/bulk')
  async saveAttendance(@Body() body: { items: any[] }) {
    await ensureSchemaAsync();
    const mode = await this.cal();
    const p = db();
    let saved = 0;
    for (const it of body?.items || []) {
      let iso = '';
      try { iso = parseUserDate(it.date, mode); }
      catch (e: any) { throw new HttpException(e.message, 400); }
      /*
       * پاک کردن یک روز (آخرین کلیک در چرخه‌ی وضعیت): ردیف حذف می‌شود، نه اینکه
       * با وضعیت خالی ذخیره شود — وگرنه روز «ثبت‌نشده» باز هم در شمارش
       * حاضر/غایب و گزارش‌ها می‌ماند.
       */
      /* کارمند باید وجود داشته باشد — وگرنه ردیف حضور «یتیم» ساخته می‌شود
         که در هیچ ورق و گزارشی دیده نمی‌شود ولی در جدول می‌ماند. */
      const emp: any[] = await p.$queryRawUnsafe(
        `SELECT "id" FROM "Employee" WHERE "id"=? AND COALESCE("deletedAt",'')=''`,
        Number(it.employeeId),
      );
      if (!emp?.length) {
        throw new HttpException(`کارمند با شناسه ${it.employeeId} پیدا نشد.`, 400);
      }
      if (it.remove === true || it.status === '' || it.status === null) {
        /*
         * «پاک کردن یک روز» هم نرم شد: کاربر گفته «حذف‌ها نرم باشند... از
         * سابقه قابل بازیابی». ردیف می‌ماند و فقط پنهان می‌شود؛ اگر بعداً
         * همان روز دوباره ثبت شود، `deletedAt` صفر می‌شود و برمی‌گردد
         * (ایندکس یگانه‌ی employeeId+date اجازه‌ی ردیف دوم را نمی‌دهد).
         */
        await p.$executeRawUnsafe(
          `UPDATE "Attendance" SET "deletedAt"=CURRENT_TIMESTAMP WHERE "employeeId"=? AND "date"=?`,
          Number(it.employeeId), iso,
        );
        saved++;
        continue;
      }
      await p.$executeRawUnsafe(
        `INSERT INTO "Attendance" ("employeeId","date","status","checkIn","checkOut","overtime","note")
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT("employeeId","date") DO UPDATE SET "status"=excluded."status","checkIn"=excluded."checkIn",
         "checkOut"=excluded."checkOut","overtime"=excluded."overtime","note"=excluded."note",
         "deletedAt"=NULL, "deletedBy"=NULL`,
        Number(it.employeeId), iso, it.status || 'present', it.checkIn || '', it.checkOut || '',
        Number(it.overtime) || 0, it.note || '',
      );
      saved++;
    }
    await logActivity({ action: 'update', entity: 'Attendance', detail: `${saved} ردیف حضور و غیاب` });
    return { ok: true, saved };
  }

  @Post('attendance/mark-day')
  async markDay(@Body() body: { date: string; employeeIds: number[]; status: string }) {
    const mode = await this.cal();
    let iso = '';
    try { iso = parseUserDate(body.date, mode); }
    catch (e: any) { throw new HttpException(e.message, 400); }
    const p = db();
    /*
     * ── باگ (شکار باگ دور ۲۴) ───────────────────────────────────────────
     *
     * این مسیر هیچ بررسی‌ای نداشت: نه وجود کارمند را می‌سنجید (ردیف حضور
     * «یتیم» ساخته می‌شد — همان چیزی که در `attendance/bulk` صریحاً باگ
     * شمرده شده)، نه وضعیت را محدود می‌کرد، و نه سابقه ثبت می‌کرد (پس
     * «ثبت حضور گروهی» در «سابقه فعالیت‌ها» پیدا نمی‌شد).
     */
    await ensureSchemaAsync();
    const ids = (body.employeeIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) throw new HttpException('هیچ کارمندی انتخاب نشده است.', 400);
    const VALID = ['present', 'absent', 'leave', 'sick', 'official_holiday', 'friday'];
    const status = String(body.status || 'present');
    if (!VALID.includes(status)) throw new HttpException('وضعیت حضور معتبر نیست.', 400);
    const known: any[] = await p.$queryRawUnsafe(
      `SELECT "id" FROM "Employee" WHERE COALESCE("deletedAt",'')=''`, );
    const live = new Set(known.map((k) => Number(k.id)));
    const missing = ids.filter((id) => !live.has(id));
    if (missing.length) {
      throw new HttpException(`کارمند با شناسه ${missing[0]} پیدا نشد.`, 400);
    }
    for (const id of ids) {
      await p.$executeRawUnsafe(
        `INSERT INTO "Attendance" ("employeeId","date","status") VALUES (?,?,?)
         ON CONFLICT("employeeId","date") DO UPDATE SET "status"=excluded."status",
           "deletedAt"=NULL, "deletedBy"=NULL`,
        id, iso, status,
      );
    }
    await logActivity({ action: 'update', entity: 'Attendance', detail: `ثبت گروهی ${ids.length} کارمند` });
    return { ok: true, saved: ids.length };
  }

  /**
   * «کد بعدی» **باید** قبل از `@Get('employees/:id')` بیاید.
   *
   * باگ واقعی: در NestJS اولین مسیر منطبق برنده است. `employees/next-code`
   * با `:id='next-code'` مطابقت می‌کرد و `Number('next-code')` می‌شد `NaN`;
   * کوئری چیز پیدا نمی‌کرد و ۴۰۴ برمی‌گشت. نتیجه در برنامه: دکمه‌ی
   * «کارمند» فورم را باز نمی‌کرد (فقط یک توست خطا) — یعنی بخش ثبت کارمندان
   * عملاً بسته بود.
   */
  @Get('employees/next-code')
  async nextEmployeeCode() {
    return this.nextCodeValue();
  }

  @Get('employees/:id')
  async one(@Param('id') id: string) {
    const eid = idParam(id, 'شناسه‌ی کارمند');
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Employee" WHERE "id"=?`, eid);
    /*
     * ⚠ عمداً حذف‌شده‌ها هم برمی‌گردند: صفحه‌ی «کارمند» با لینک مستقیم
     * (`/employees/12`) باز می‌شود و اگر ردیف در سطل بازیافت باشد، فقط یک
     * «کارمند پیدا نشد» خشک نشان می‌داد. حالا خودِ رکورد با پرچم
     * `deleted: true` برمی‌گردد و UI می‌تواند پیام روشن بدهد (یا مدیر
     * بازیابی کند). فهرست‌ها و گزارش‌ها همچنان حذف‌شده‌ها را نشان نمی‌دهند.
     */
    if (!rows?.length) throw new HttpException('کارمند پیدا نشد.', 404);
    const salary: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Salary" WHERE "employeeId"=? AND COALESCE("deletedAt",'')='' ORDER BY "periodStart" DESC`,
      eid,
    );
    const att: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Attendance" WHERE "employeeId"=? AND COALESCE("deletedAt",'')='' ORDER BY "date" DESC LIMIT 60`,
      eid,
    );
    return {
      employee: rows[0],
      deleted: Boolean(rows[0].deletedAt),
      salaries: salary,
      attendance: att,
    };
  }

  /** کد بعدی کارمند — منطق در یک جا (هم مسیر ثابت و هم مسیر قدیمی) */
  async nextCodeValue() {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Employee"`);
    const nums = rows.map((r) => Number(String(r.code).replace(/\D/g, '')) || 0);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return { code: String(next).padStart(3, '0') };
  }

  @Post('employees')
  async create(@Body() body: any) {
    await ensureSchemaAsync();
    /*
     * ── باگ (شکار باگ دور ۲۵) ───────────────────────────────────────────
     * `if (!body?.name)` رشته‌ی خالیِ پُر از فاصله را قبول می‌کرد، معاش منفی
     * هم ذخیره می‌شد (بعداً «جمع معاش منفی» در ورق معاش خطا می‌داد).
     */
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpException('نام کارمند لازم است.', 400);
    if (name.length > 120) throw new HttpException('نام کارمند حداکثر ۱۲۰ حرف باشد.', 400);
    const baseSalary = numOrZero(body.baseSalary);
    if (baseSalary < 0) throw new HttpException('معاش ثابت نمی‌تواند منفی باشد.', 400);
    const code = String(body.code || '').trim() || await this.autoCode();
    const mode = await this.cal();
    let hireDate = '';
    try {
      hireDate = body.hireDate ? parseUserDate(body.hireDate, mode) : '';
    } catch (e: any) {
      throw new HttpException(e.message, 400);
    }
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "Employee" ("code","name","fatherName","position","hireDate","baseSalary","phone","nationalId","address","contractPeriod","status","note")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        code, name, String(body.fatherName ?? '').slice(0, 80), String(body.position ?? '').slice(0, 80), hireDate,
        baseSalary, String(body.phone ?? '').slice(0, 60), String(body.nationalId ?? '').slice(0, 60),
        String(body.address ?? '').slice(0, 200), String(body.contractPeriod ?? '').slice(0, 60),
        body.status === 'inactive' ? 'inactive' : 'active', String(body.note ?? '').slice(0, 300),
      );
    } catch {
      throw new HttpException('این کد کارمند قبلاً ثبت شده است.', 400);
    }
    await logActivity({ action: 'create', entity: 'Employee', detail: `${code} — ${name}` });
    return { ok: true, code };
  }

  @Put('employees/:id')
  async update(@Param('id') id: string, @Body() body: any) {
    const eid = idParam(id, 'شناسه‌ی کارمند');
    await assertLive('Employee', eid, 'کارمند');
    /*
     * ── باگ (شکار باگ دور ۲۵) ───────────────────────────────────────────
     * ۱) کد بدون بررسی نوشته می‌شد: اگر فورم کد را نمی‌فرستاد، `code` رشته‌ی
     *    **خالی** می‌شد و کارمند بی‌کد می‌ماند — همان چیزی که در چاپ رسید
     *    معاش و فهرست حضور دیده می‌شود. اگر دو کارمند این‌طور بی‌کد می‌شدند،
     *    ایندکس یکتای `Employee_code_key` خطای مبهم «کد تکراری» می‌داد.
     * ۲) نام خالی/فاصله هم پذیرفته می‌شد.
     * ۳) معاش منفی ذخیره می‌شد.
     */
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpException('نام کارمند لازم است.', 400);
    const cur: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Employee" WHERE "id"=?`, eid);
    const code = String(body?.code ?? '').trim() || String(cur?.[0]?.code ?? '');
    if (!code) throw new HttpException('کد کارمند لازم است.', 400);
    const baseSalary = numOrZero(body.baseSalary);
    if (baseSalary < 0) throw new HttpException('معاش ثابت نمی‌تواند منفی باشد.', 400);
    const mode = await this.cal();
    let hireDate = body.hireDate || '';
    try {
      hireDate = hireDate ? parseUserDate(hireDate, mode) : '';
    } catch (e: any) {
      throw new HttpException(e.message, 400);
    }
    try {
      await db().$executeRawUnsafe(
        `UPDATE "Employee" SET "code"=?, "name"=?, "fatherName"=?, "position"=?, "hireDate"=?, "baseSalary"=?,
         "phone"=?, "nationalId"=?, "address"=?, "contractPeriod"=?, "status"=?, "note"=? WHERE "id"=?`,
        code, name, String(body.fatherName ?? '').slice(0, 80), String(body.position ?? '').slice(0, 80), hireDate,
        baseSalary, String(body.phone ?? '').slice(0, 60), String(body.nationalId ?? '').slice(0, 60),
        String(body.address ?? '').slice(0, 200), String(body.contractPeriod ?? '').slice(0, 60),
        body.status === 'inactive' ? 'inactive' : 'active', String(body.note ?? '').slice(0, 300), eid,
      );
    } catch {
      throw new HttpException('کد کارمند تکراری است یا معلومات ناقص است.', 400);
    }
    await logActivity({ action: 'update', entity: 'Employee', entityId: eid, detail: name });
    return { ok: true };
  }

  /**
   * حذف کارمند — فقط اگر هیچ سابقه‌ای (معاش یا حضور) نداشته باشد.
   *
   * باگ: حضور و غیابِ کارمند بی‌سروصدا پاک می‌شد. اگر روزی مدیر حضور یک ماه
   * را ثبت کرده بود و بعد کارمند را حذف می‌کرد، آمار حضور/اضافه‌کاری ماه
   * بی‌خبر کم می‌شد و گزارش با قبل نمی‌خواند. حالا مثل معاش، حذف با سابقه
   * رد می‌شود و پیشنهاد «غیر فعال کردن» داده می‌شود.
   */
  @Delete('employees/:id')
  @ManagerOnly()
  async remove(@Req() req: any, @Param('id') id: string) {
    const eid = idParam(id, 'شناسه‌ی کارمند');
    const used: any[] = await db().$queryRawUnsafe(
      `SELECT COUNT(*) as c FROM "Salary" WHERE "employeeId"=? AND COALESCE("deletedAt",'')=''`, eid);
    if (Number(used?.[0]?.c) > 0) {
      throw new HttpException('این کارمند دارای سابقه معاش است؛ به جای حذف، وضعیت او را «غیر فعال» کنید.', 400);
    }
    const att: any[] = await db().$queryRawUnsafe(
      `SELECT COUNT(*) as c FROM "Attendance" WHERE "employeeId"=? AND COALESCE("deletedAt",'')=''`, eid);
    if (Number(att?.[0]?.c) > 0) {
      throw new HttpException('این کارمند سابقه حضور و غیاب دارد؛ به جای حذف، وضعیت او را «غیر فعال» کنید.', 400);
    }
    /*
     * حذف «نرم» — درخواست کاربر: «حذف‌ها نرم باشند... از سابقه فعالیت‌ها
     * قابل بازیابی بدون آسیب». ردیف می‌ماند، فقط از همه‌ی فهرست‌ها و
     * گزارش‌ها پنهان می‌شود و از «سطل بازیافت» برمی‌گردد.
     */
    const del = await softDelete("Employee", eid, { username: userOf(req) });
    if (!del.ok) throw new HttpException('ردیف پیدا نشد.', 404);
    /*
     * باگ: این ثبت سابقه **بعد از return** بود و هرگز اجرا نمی‌شد؛ یعنی
     * حذف در «سابقه فعالیت‌ها» نمی‌آمد و «قابل بازیابی بودن» فقط روی
     * کاغذ بود. حالا قبل از برگشت ثبت می‌شود.
     */
    await logActivity({ action: 'delete', entity: 'Employee', entityId: eid });
    return { ok: true, softDeleted: true, message: 'حذف شد — از «سطل بازیافت» قابل بازگرداندن است.' };
  }

  private async autoCode(): Promise<string> {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Employee"`);
    const nums = rows.map((r) => Number(String(r.code).replace(/\D/g, '')) || 0);
    return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
  }

  // ------------------------------ attendance -------------------------------
  @Get('attendance/summary')
  async summary(@Query('month') month: string) {
    const mode = await this.cal();
    const m = String(month || '').match(/^(\d{4})[\/\-](\d{1,2})$/);
    let ref = todayISO();
    if (m) {
      const { fromCalendar } = await import('../common/calendar');
      ref = fromCalendar(Number(m[1]), Number(m[2]), 1, mode);
    }
    const bucket = monthBucket(ref, mode);
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT a.*, e."name", e."code" FROM "Attendance" a JOIN "Employee" e ON e."id" = a."employeeId"
       WHERE a."date" >= ? AND a."date" <= ?
         AND COALESCE(a."deletedAt",'')='' AND COALESCE(e."deletedAt",'')=''`,
      bucket.start, bucket.end,
    );
    const byEmp: Record<number, any> = {};
    for (const r of rows) {
      const k = r.employeeId;
      byEmp[k] = byEmp[k] || { employeeId: k, name: r.name, code: r.code, present: 0, absent: 0, leave: 0, sick: 0, holiday: 0, overtime: 0 };
      if (r.status === 'present') byEmp[k].present++;
      else if (r.status === 'absent') byEmp[k].absent++;
      else if (r.status === 'leave') byEmp[k].leave++;
      else if (r.status === 'sick') byEmp[k].sick++;
      else byEmp[k].holiday++;
      byEmp[k].overtime += Number(r.overtime) || 0;
    }
    return { label: bucket.label, start: bucket.start, end: bucket.end, rows: Object.values(byEmp) };
  }
}
