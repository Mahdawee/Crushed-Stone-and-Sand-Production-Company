import { Body, Controller, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { logActivity } from '../common/activity';
import { softDelete } from '../common/soft-delete';
import { settingsService } from '../common/settings';
import { parseUserDate, monthBucket, todayISO, CalendarMode, daysBetween } from '../common/calendar';

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
    const enriched = [];
    for (const r of rows) {
      const s: any[] = await db().$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM "Salary" WHERE "employeeId"=?`,
        r.id,
      );
      enriched.push({ ...r, salaryCount: Number(s?.[0]?.c ?? 0), hireDateDisplay: r.hireDate });
    }
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
      `SELECT * FROM "Employee" WHERE "status"='active' ORDER BY "code"`,
    );
    if (date) {
      let iso = '';
      try { iso = parseUserDate(date, mode); }
      catch (e: any) { throw new HttpException(e.message, 400); }
      const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Attendance" WHERE "date"=?`, iso);
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
      `SELECT * FROM "Attendance" WHERE "date" >= ? AND "date" <= ? ORDER BY "date"`,
      bucket.start,
      bucket.end,
    );
    const salaries: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Salary" WHERE "periodStart" = ?`,
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
      const emp: any[] = await p.$queryRawUnsafe(`SELECT "id" FROM "Employee" WHERE "id"=?`, Number(it.employeeId));
      if (!emp?.length) {
        throw new HttpException(`کارمند با شناسه ${it.employeeId} پیدا نشد.`, 400);
      }
      if (it.remove === true || it.status === '' || it.status === null) {
        await p.$executeRawUnsafe(`DELETE FROM "Attendance" WHERE "employeeId"=? AND "date"=?`, Number(it.employeeId), iso);
        saved++;
        continue;
      }
      await p.$executeRawUnsafe(
        `INSERT INTO "Attendance" ("employeeId","date","status","checkIn","checkOut","overtime","note")
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT("employeeId","date") DO UPDATE SET "status"=excluded."status","checkIn"=excluded."checkIn",
         "checkOut"=excluded."checkOut","overtime"=excluded."overtime","note"=excluded."note"`,
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
    for (const id of body.employeeIds || []) {
      await p.$executeRawUnsafe(
        `INSERT INTO "Attendance" ("employeeId","date","status") VALUES (?,?,?)
         ON CONFLICT("employeeId","date") DO UPDATE SET "status"=excluded."status"`,
        Number(id), iso, body.status || 'present',
      );
    }
    return { ok: true };
  }

  @Get('employees/:id')
  async one(@Param('id') id: string) {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Employee" WHERE "id"=?`, Number(id));
    if (!rows?.length) throw new HttpException('کارمند پیدا نشد.', 404);
    const salary: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Salary" WHERE "employeeId"=? ORDER BY "periodStart" DESC`,
      Number(id),
    );
    const att: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Attendance" WHERE "employeeId"=? ORDER BY "date" DESC LIMIT 60`,
      Number(id),
    );
    return { employee: rows[0], salaries: salary, attendance: att };
  }

  @Get('employees/:id/next-code')
  async nextCode() {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT "code" FROM "Employee"`);
    const nums = rows.map((r) => Number(String(r.code).replace(/\D/g, '')) || 0);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return { code: String(next).padStart(3, '0') };
  }

  @Post('employees')
  async create(@Body() body: any) {
    await ensureSchemaAsync();
    if (!body?.name) throw new HttpException('نام کارمند لازم است.', 400);
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
        code, body.name, body.fatherName || '', body.position || '', hireDate,
        Number(body.baseSalary) || 0, body.phone || '', body.nationalId || '',
        body.address || '', body.contractPeriod || '', body.status === 'inactive' ? 'inactive' : 'active', body.note || '',
      );
    } catch {
      throw new HttpException('این کد کارمند قبلاً ثبت شده است.', 400);
    }
    await logActivity({ action: 'create', entity: 'Employee', detail: `${code} — ${body.name}` });
    return { ok: true, code };
  }

  @Put('employees/:id')
  async update(@Param('id') id: string, @Body() body: any) {
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
        String(body.code || '').trim(), body.name, body.fatherName || '', body.position || '', hireDate,
        Number(body.baseSalary) || 0, body.phone || '', body.nationalId || '', body.address || '',
        body.contractPeriod || '', body.status === 'inactive' ? 'inactive' : 'active', body.note || '', Number(id),
      );
    } catch {
      throw new HttpException('کد کارمند تکراری است یا معلومات ناقص است.', 400);
    }
    await logActivity({ action: 'update', entity: 'Employee', entityId: Number(id), detail: body.name });
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
  async remove(@Param('id') id: string) {
    const used: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Salary" WHERE "employeeId"=?`, Number(id));
    if (Number(used?.[0]?.c) > 0) {
      throw new HttpException('این کارمند دارای سابقه معاش است؛ به جای حذف، وضعیت او را «غیر فعال» کنید.', 400);
    }
    const att: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Attendance" WHERE "employeeId"=?`, Number(id));
    if (Number(att?.[0]?.c) > 0) {
      throw new HttpException('این کارمند سابقه حضور و غیاب دارد؛ به جای حذف، وضعیت او را «غیر فعال» کنید.', 400);
    }
    /*
     * حذف «نرم» — درخواست کاربر: «حذف‌ها نرم باشند... از سابقه فعالیت‌ها
     * قابل بازیابی بدون آسیب». ردیف می‌ماند، فقط از همه‌ی فهرست‌ها و
     * گزارش‌ها پنهان می‌شود و از «سطل بازیافت» برمی‌گردد.
     */
    const del = await softDelete("Employee", Number(id));
    if (!del.ok) throw new HttpException('ردیف پیدا نشد.', 404);
    /*
     * باگ: این ثبت سابقه **بعد از return** بود و هرگز اجرا نمی‌شد؛ یعنی
     * حذف در «سابقه فعالیت‌ها» نمی‌آمد و «قابل بازیابی بودن» فقط روی
     * کاغذ بود. حالا قبل از برگشت ثبت می‌شود.
     */
    await logActivity({ action: 'delete', entity: 'Employee', entityId: Number(id) });
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
       WHERE a."date" >= ? AND a."date" <= ?`,
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
