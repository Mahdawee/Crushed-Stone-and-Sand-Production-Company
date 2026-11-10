import { Body, Controller, Get, Post, Put, Delete, Param, Query, UseGuards, HttpException } from '@nestjs/common';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { logActivity } from '../common/activity';
import { settingsService } from '../common/settings';
import { nextDocNo } from '../common/sequence';
import {
  parseUserDate, formatDate, todayISO, monthBucket, fromCalendar,
  startOfMonth, startOfYear, endOfMonth, todayISO as today,
} from '../common/calendar';

@UseGuards(AuthGuard)
@Controller('salaries')
export class SalariesController {
  /** Pay sheet for one month: every active employee with the previous values pre-filled. */
  @Get('sheet')
  async sheet(@Query('month') month: string) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const m = String(month || '').match(/^(\d{4})[\/\-](\d{1,2})$/);
    let ref = todayISO();
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      ref = fromCalendar(y, mo, 1, mode);
    }
    const bucket = monthBucket(ref, mode);
    const employees: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Employee" WHERE "status"='active' ORDER BY "code"`,
    );
    const existing: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Salary" WHERE "periodStart"=?`,
      bucket.start,
    );
    const byEmp: Record<number, any> = {};
    for (const e of existing) byEmp[e.employeeId] = e;
    // overtime hours from the attendance sheet of the same month
    const ot: any[] = await db().$queryRawUnsafe(
      `SELECT "employeeId", COALESCE(SUM("overtime"),0) as hours FROM "Attendance" WHERE "date">=? AND "date"<=? GROUP BY "employeeId"`,
      bucket.start, bucket.end,
    );
    const absences: any[] = await db().$queryRawUnsafe(
      `SELECT "employeeId", COUNT(*) as c FROM "Attendance" WHERE "date">=? AND "date"<=? AND "status"='absent' GROUP BY "employeeId"`,
      bucket.start, bucket.end,
    );
    const otMap = Object.fromEntries(ot.map((o) => [o.employeeId, Number(o.hours) || 0]));
    const absMap = Object.fromEntries(absences.map((o) => [o.employeeId, Number(o.c) || 0]));
    const hours = Number(await settingsService.get('attendanceWorkHours')) || 8;
    const rows = employees.map((e) => {
      const ex = byEmp[e.id];
      const base = Number(ex?.baseSalary ?? e.baseSalary) || 0;
      const otHours = otMap[e.id] || 0;
      const otAmount = ex?.overtimeAmount ?? Math.round((otHours * (base / (26 * hours))) * 100) / 100;
      return {
        salaryId: ex?.id ?? null,
        employeeId: e.id,
        code: e.code,
        name: e.name,
        position: e.position,
        baseSalary: base,
        bonus: Number(ex?.bonus ?? 0),
        penalty: Number(ex?.penalty ?? 0),
        overtimeHours: otHours,
        absentDays: absMap[e.id] || 0,
        overtimeAmount: otAmount,
        total: Math.round((base + Number(ex?.bonus ?? 0) + otAmount - Number(ex?.penalty ?? 0)) * 100) / 100,
        payerName: ex?.payerName ?? '',
        paymentType: ex?.paymentType ?? 'cash',
        payDate: ex?.payDate ?? '',
        note: ex?.note ?? '',
        saved: !!ex,
      };
    });
    const totalPaid = existing.reduce((a, e) => a + (Number(e.total) || 0), 0);
    return { mode, month: `${bucket.year}-${String(bucket.month).padStart(2, '0')}`, label: bucket.label, periodStart: bucket.start, rows, totalPaid };
  }

  @Get()
  async list(
    @Query('month') month?: string, @Query('employeeId') employeeId?: string,
    @Query('page') page = '1', @Query('pageSize') pageSize = '25',
  ) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const where: string[] = [];
    const args: any[] = [];
    if (month) {
      const m = String(month).match(/^(\d{4})[\/\-](\d{1,2})$/);
      if (m) {
        const ref = fromCalendar(Number(m[1]), Number(m[2]), 1, mode);
        const b = monthBucket(ref, mode);
        where.push(`"periodStart" = ?`);
        args.push(b.start);
      }
    }
    if (employeeId) { where.push(`"employeeId"=?`); args.push(Number(employeeId)); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) as c, COALESCE(SUM("total"),0) as s FROM "Salary" ${w}`, ...args);
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(500, Math.max(5, Number(pageSize) || 25));
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "Salary" ${w} ORDER BY "periodStart" DESC, "employeeName" LIMIT ? OFFSET ?`,
      ...args, ps, (p - 1) * ps,
    );
    return {
      rows: rows.map((r) => ({ ...r, payDateDisplay: r.payDate ? formatDate(r.payDate, mode) : '' })),
      total: Number(total?.[0]?.c ?? 0), sum: Number(total?.[0]?.s ?? 0), page: p, pageSize: ps, calendar: mode,
    };
  }

  /** Bulk save of the pay sheet (upsert per employee + period). */
  @Post('sheet')
  async saveSheet(@Body() body: { month: string; payDate?: string; rows: any[] }) {
    await ensureSchemaAsync();
    const mode = await settingsService.calendar();
    const m = String(body?.month || '').match(/^(\d{4})[\/\-](\d{1,2})$/);
    if (!m) throw new HttpException('ماه را انتخاب کنید.', 400);
    const ref = fromCalendar(Number(m[1]), Number(m[2]), 1, mode);
    const b = monthBucket(ref, mode);
    const payDate = body.payDate ? parseUserDate(body.payDate, mode) : todayISO();
    const prefix = await settingsService.get('docPrefixSalary');
    const p = db();
    let saved = 0;
    for (const r of body.rows || []) {
      const base = Number(r.baseSalary) || 0;
      const bonus = Number(r.bonus) || 0;
      const penalty = Number(r.penalty) || 0;
      const overtimeAmount = Number(r.overtimeAmount) || 0;
      const total = Math.round((base + bonus + overtimeAmount - penalty) * 100) / 100;
      const ex: any[] = await p.$queryRawUnsafe(
        `SELECT "id","no" FROM "Salary" WHERE "employeeId"=? AND "periodStart"=?`,
        Number(r.employeeId), b.start,
      );
      const no = ex?.[0]?.no || (await nextDocNo(prefix, mode, payDate));
      if (ex?.length) {
        await p.$executeRawUnsafe(
          `UPDATE "Salary" SET "baseSalary"=?, "bonus"=?, "penalty"=?, "overtimeAmount"=?, "total"=?,
           "payerName"=?, "paymentType"=?, "payDate"=?, "note"=? WHERE "id"=?`,
          base, bonus, penalty, overtimeAmount, total, r.payerName || '',
          r.paymentType === 'hawala' ? 'hawala' : 'cash', payDate, r.note || '', ex[0].id,
        );
      } else {
        await p.$executeRawUnsafe(
          `INSERT INTO "Salary" ("no","periodStart","periodLabel","calendar","year","month","payDate","employeeId",
            "employeeName","baseSalary","bonus","penalty","overtimeAmount","total","payerName","paymentType","note")
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          no, b.start, b.label, mode, b.year, b.month, payDate, Number(r.employeeId),
          r.name || '', base, bonus, penalty, overtimeAmount, total, r.payerName || '',
          r.paymentType === 'hawala' ? 'hawala' : 'cash', r.note || '',
        );
      }
      saved++;
    }
    await logActivity({ action: 'update', entity: 'Salary', detail: `معاش ${b.label} — ${saved} کارمند` });
    return { ok: true, saved, label: b.label, payDate };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const rows: any[] = await db().$queryRawUnsafe(`SELECT * FROM "Salary" WHERE "id"=?`, Number(id));
    if (!rows?.length) throw new HttpException('سند معاش پیدا نشد.', 404);
    const mode = await settingsService.calendar();
    return { ...rows[0], payDateDisplay: rows[0].payDate ? formatDate(rows[0].payDate, mode, true) : '' };
  }

  @Delete(':id')
  @ManagerOnly()
  async remove(@Param('id') id: string) {
    await db().$executeRawUnsafe(`DELETE FROM "Salary" WHERE "id"=?`, Number(id));
    await logActivity({ action: 'delete', entity: 'Salary', entityId: Number(id) });
    return { ok: true };
  }
}
