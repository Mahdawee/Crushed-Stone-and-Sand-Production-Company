import { Body, Controller, Get, Param, Post, Query, UseGuards, HttpException } from '@nestjs/common';
import { AuthGuard, ManagerOnly } from '../common/auth';
import { SOFT_TABLES, deletedCounts, listDeleted, restore } from '../common/soft-delete';

/**
 * سطل بازیافت — ردیف‌های «حذف نرم»شده.
 *
 * فقط مدیر: چون بازیابی یک بل فروش، مانده‌ی حساب مشتری را تغییر می‌دهد و
 * نباید کارمند عادی بی‌سروصدا این کار را بکند.
 */
@UseGuards(AuthGuard)
@Controller('recycle')
export class RecycleController {
  /**
   * سطل بازیافت برای «سابقه فعالیت» — همه‌ی بخش‌ها با هم.
   *
   * درخواست کاربر: «سطل بازیافت را در بخش سابقه فعالیت ادغام کن».
   *
   * ## چرا تفکیک‌شدن این صفحه یک ایراد بود
   * کاربر برای فهمیدن «چه چیزی حذف شد و چه کسی حذف کرد» باید دو صفحه را
   * می‌دید: «سابقه فعالیت» (که می‌گفت حذف شد، بدون جزئیات) و «سطل بازیافت»
   * (که خود ردیف‌ها را داشت). حالا هر دو در یک صفحه‌اند.
   *
   * ⚠ این مسیر باید **قبل از** `:table` بیاید، وگرنه `:table='bins'` می‌شود
   * و «جدول ناشناخته» برمی‌گردد (همان باگی که تست مسیرها گرفت).
   */
  @Get('bins')
  @ManagerOnly()
  async bins() {
    const counts = await deletedCounts();
    const items = Object.entries(SOFT_TABLES).map(([table, meta]) => ({
      table, label: meta.label, count: counts[table] || 0,
      titleCol: meta.titleCol, extraCols: meta.extraCols || [],
    }));
    const bins: Record<string, any[]> = {};
    for (const table of Object.keys(SOFT_TABLES)) {
      if (!counts[table]) { bins[table] = []; continue; }
      bins[table] = (await listDeleted(table, 50)).map((r) => ({ ...r, deletedAt: r.deletedAt || '' }));
    }
    return { items, total: Object.values(counts).reduce((a, b) => a + b, 0), bins };
  }

  /** فهرست جدول‌ها + تعداد حذف‌شده در هر کدام */
  @Get()
  @ManagerOnly()
  async summary() {
    const counts = await deletedCounts();
    return {
      items: Object.entries(SOFT_TABLES).map(([table, meta]) => ({
        table, label: meta.label, count: counts[table] || 0,
        titleCol: meta.titleCol, extraCols: meta.extraCols || [],
      })),
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    };
  }

  /** ردیف‌های حذف‌شده‌ی یک جدول */
  @Get(':table')
  @ManagerOnly()
  async list(@Param('table') table: string, @Query('limit') limit?: string) {
    if (!SOFT_TABLES[table]) throw new HttpException('جدول ناشناخته است.', 400);
    const rows = await listDeleted(table, Number(limit) || 200);
    return {
      table, label: SOFT_TABLES[table].label,
      titleCol: SOFT_TABLES[table].titleCol,
      extraCols: SOFT_TABLES[table].extraCols || [],
      rows: rows.map((r) => ({
        ...r,
        /* موتور دیتابیس تاریخ ISO می‌دهد؛ UI خودش شمسی می‌کند */
        deletedAt: r.deletedAt || '',
      })),
    };
  }

  /** بازیابی */
  @Post(':table/:id/restore')
  @ManagerOnly()
  async doRestore(@Param('table') table: string, @Param('id') id: string, @Body() body: { username?: string }) {
    if (!SOFT_TABLES[table]) throw new HttpException('جدول ناشناخته است.', 400);
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) throw new HttpException('شناسه نامعتبر است.', 400);
    const res = await restore(table, n, { username: body?.username });
    if (!res.ok) throw new HttpException('ردیف پیدا نشد.', 404);
    return { ok: true, message: 'بازیابی شد.' };
  }
}
