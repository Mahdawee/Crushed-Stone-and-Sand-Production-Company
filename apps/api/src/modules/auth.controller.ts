import { Body, Controller, Get, Post, Req, Delete, Param, HttpException } from '@nestjs/common';
import { db } from '../db';
import { idParam } from '../common/params';
import { ensureSchemaAsync } from '../schema';
import {
  AuthGuard, Public, ManagerOnly, hashPassword, verifyPassword, createSession, destroySession,
  destroySessionsOf, getSession,
} from '../common/auth';
import { logActivity } from '../common/activity';
import { UseGuards } from '@nestjs/common';

@UseGuards(AuthGuard)
@Controller()
export class AuthController {
  @Public()
  @Get('health')
  async health() {
    await ensureSchemaAsync();
    const rows: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) as c FROM "User"`);
    return {
      ok: true,
      needsSetup: Number(rows?.[0]?.c ?? 0) === 0,
      version: '0.1.0',
      time: new Date().toISOString(),
    };
  }

  @Public()
  @Post('auth/login')
  async login(@Body() body: { username: string; password: string }) {
    await ensureSchemaAsync();
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "User" WHERE "username" = ?`,
      String(body?.username || '').trim(),
    );
    const u = rows?.[0];
    if (!u || !u.active) throw new HttpException('نام کاربری یا رمز اشتباه است.', 401);
    const check = verifyPassword(body?.password || '', u.passwordHash);
    if (!check.ok) throw new HttpException('نام کاربری یا رمز اشتباه است.', 401);
    /*
     * ارتقای بی‌صدا: اگر این کاربر هنوز هشِ قدیمی (SHA-256 با نمک ثابت) دارد،
     * همین حالا با رمزی که درست وارد شد، به `scrypt` تبدیل می‌شود. کاربر
     * چیزی متوجه نمی‌شود و رمزش را عوض نمی‌کند.
     */
    if (check.needsUpgrade) {
      try {
        await db().$executeRawUnsafe(
          `UPDATE "User" SET "passwordHash"=? WHERE "id"=?`, hashPassword(String(body?.password || '')), u.id,
        );
      } catch { /* ارتقا نباید ورود را بشکند */ }
    }
    await db().$executeRawUnsafe(
      `UPDATE "User" SET "lastLoginAt" = CURRENT_TIMESTAMP WHERE "id" = ?`,
      u.id,
    );
    const session = createSession(u);
    await logActivity({ username: u.username, action: 'login', entity: 'User', entityId: u.id, detail: 'ورود به سیستم' });
    return {
      token: session.token,
      user: { id: u.id, username: u.username, fullName: u.fullName, role: u.role },
    };
  }

  @Public()
  @Post('auth/logout')
  async logout(@Req() req: any) {
    const token = (req.headers['x-auth-token'] as string) || '';
    const s = getSession(token);
    if (s) await logActivity({ username: s.username, action: 'logout', detail: 'خروج از سیستم' });
    destroySession(token);
    return { ok: true };
  }

  @Get('auth/me')
  async me(@Req() req: any) {
    return { user: req.session ?? null };
  }

  @Post('auth/change-password')
  async changePassword(
    @Req() req: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT * FROM "User" WHERE "id" = ?`,
      req.session.userId,
    );
    const u = rows?.[0];
    if (!u || !verifyPassword(body?.currentPassword || '', u.passwordHash).ok) {
      throw new HttpException('رمز فعلی اشتباه است.', 400);
    }
    if (!body?.newPassword || body.newPassword.length < 5) {
      throw new HttpException('رمز تازه باید حداقل ۵ حرف باشد.', 400);
    }
    /*
     * باگ (شکار باگ دور ۲۷): رمز تازه می‌توانست **همان رمز فعلی** باشد.
     * کاربر فکر می‌کرد رمز را عوض کرده (پیام «ذخیره شد») در حالی که هیچ
     * چیزی عوض نشده بود — و اگر رمزش لو رفته بود، لو رفتن ادامه داشت.
     */
    if (String(body.newPassword) === String(body.currentPassword || '')) {
      throw new HttpException('رمز تازه با رمز فعلی یکسان است — رمز دیگری انتخاب کنید.', 400);
    }
    await db().$executeRawUnsafe(
      `UPDATE "User" SET "passwordHash" = ? WHERE "id" = ?`,
      hashPassword(body.newPassword),
      u.id,
    );
    await logActivity({ username: u.username, action: 'update', entity: 'User', entityId: u.id, detail: 'تغییر رمز خود' });
    return { ok: true };
  }

  // ------------------------------ users (manager) --------------------------
  @Get('users')
  @ManagerOnly()
  async list() {
    return db().$queryRawUnsafe(
      `SELECT "id","username","fullName","role","active","lastLoginAt","createdAt" FROM "User" ORDER BY "id"`,
    );
  }

  /**
   * نقش‌های مجاز.
   *
   * باگ (شکار باگ دور ۲۷): کد قبلی هر نقش ناشناخته‌ای را **مدیر** می‌کرد
   * (`body.role === 'employee' ? 'employee' : 'manager'`). یعنی اشتباه تایپی
   * یا یک مقدار دستکاری‌شده، حساب **مدیر** می‌ساخت. حالا نقش باید یکی از
   * همین دو باشد؛ وگرنه ۴۰۰.
   */
  private static roleOf(value: unknown, fallback: string): string {
    if (value === undefined || value === null || value === '') return fallback;
    const r = String(value);
    if (r !== 'manager' && r !== 'employee') throw new HttpException('نقش کاربر باید «مدیر» یا «کارمند» باشد.', 400);
    return r;
  }

  @Post('users')
  @ManagerOnly()
  async create(@Req() req: any, @Body() body: any) {
    if (!body?.username || !body?.password) throw new HttpException('نام کاربری و رمز لازم است.', 400);
    const role = AuthController.roleOf(body?.role, 'employee');
    if (String(body.password).length < 5) throw new HttpException('رمز عبور باید حداقل ۵ حرف باشد.', 400);
    if (!/^[a-zA-Z0-9._-]{3,}$/.test(String(body.username).trim())) {
      throw new HttpException('نام کاربری حداقل ۳ حرف و فقط انگلیسی/عدد/نقطه باشد.', 400);
    }
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO "User" ("username","fullName","passwordHash","role","active") VALUES (?,?,?,?,?)`,
        body.username.trim(),
        String(body.fullName || '').slice(0, 80),
        hashPassword(body.password),
        role,
        body.active === false ? 0 : 1,
      );
    } catch (e: any) {
      if (/UNIQUE|constraint failed/i.test(String(e?.message || ''))) {
        throw new HttpException('این نام کاربری قبلاً ثبت شده است.', 400);
      }
      throw new HttpException(`ساخت کاربر انجام نشد: ${e?.message || e}`, 500);
    }
    await logActivity({ username: req.session.username, action: 'create', entity: 'User', detail: `کاربر ${body.username}` });
    return { ok: true };
  }

  @Post('users/:id')
  @ManagerOnly()
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const uid = idParam(id, 'شناسه‌ی کاربر');
    const p = db();
    const current: any[] = await p.$queryRawUnsafe(`SELECT * FROM "User" WHERE "id"=?`, uid);
    if (!current?.length) throw new HttpException('کاربر پیدا نشد.', 404);
    /* نقش نامعتبر باید ۴۰۰ بدهد — نه اینکه بی‌صدا «مدیر» شود */
    const newRole = AuthController.roleOf(body?.role, current[0].role);
    const becomingNonManager = current[0].role === 'manager' && newRole === 'employee';
    const becomingInactive = Boolean(current[0].active) && body.active === false;
    if ((becomingNonManager || becomingInactive) && current[0].role === 'manager') {
      const man: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "User" WHERE "role"='manager' AND "active"=1`);
      if (Number(man?.[0]?.c ?? 0) <= 1) {
        throw new HttpException('این تنها مدیر فعال سیستم است — اول مدیر دیگری بسازید.', 400);
      }
    }
    if (body.password && String(body.password).length < 5) {
      throw new HttpException('رمز عبور باید حداقل ۵ حرف باشد.', 400);
    }
    await p.$executeRawUnsafe(
      `UPDATE "User" SET "fullName"=?, "role"=?, "active"=? WHERE "id"=?`,
      String(body.fullName || '').slice(0, 80),
      newRole,
      body.active === false ? 0 : 1,
      uid,
    );
    if (body.password) {
      await p.$executeRawUnsafe(`UPDATE "User" SET "passwordHash"=? WHERE "id"=?`, hashPassword(body.password), uid);
    }
    /*
     * باگ (شکار باگ دور ۲۷): تغییر رمز/نقش/فعال‌بودن، نشست‌های بازِ آن کاربر
     * را باطل نمی‌کرد. مدیر رمز کارمندی را عوض می‌کرد تا او بیرون برود، ولی
     * آن کارمند با توکن قدیمی تا ۱۲ ساعت کار می‌کرد. حالا:
     *   • با تغییر رمز یا غیرفعال‌شدن → همه‌ی نشست‌های او باطل می‌شود؛
     *   • با تغییر نقش → نشست‌ها باطل می‌شود تا نقش تازه اعمال شود
     *     (وگرنه کارمندِ ارتقایافته تا ۱۲ ساعت دسترسی قدیمی داشت).
     */
    const roleChanged = String(current[0].role) !== String(newRole);
    const deactivated = Boolean(current[0].active) && body.active === false;
    if (body.password || roleChanged || deactivated) destroySessionsOf(uid);
    await logActivity({ username: req.session.username, action: 'update', entity: 'User', entityId: uid, detail: `کاربر ${body.username || ''}` });
    return { ok: true, sessionsCleared: Boolean(body.password || roleChanged || deactivated) };
  }

  @Delete('users/:id')
  @ManagerOnly()
  async remove(@Req() req: any, @Param('id') id: string) {
    const uid = idParam(id, 'شناسه‌ی کاربر');
    const target: any[] = await db().$queryRawUnsafe(`SELECT * FROM "User" WHERE "id"=?`, uid);
    if (!target?.length) throw new HttpException('کاربر پیدا نشد.', 404);
    if (target[0].id === req.session.userId) {
      throw new HttpException('حساب خودتان را نمی‌توانید حذف کنید.', 400);
    }
    if (target[0].role === 'manager') {
      const man: any[] = await db().$queryRawUnsafe(`SELECT COUNT(*) c FROM "User" WHERE "role"='manager' AND "active"=1`);
      if (Number(man?.[0]?.c ?? 0) <= 1) throw new HttpException('آخرین مدیر فعال را نمی‌توان حذف کرد.', 400);
    }
    await db().$executeRawUnsafe(`DELETE FROM "User" WHERE "id"=?`, uid);
    /* نشست‌های کاربر حذف‌شده باید همان لحظه بی‌اعتبار شوند */
    destroySessionsOf(uid);
    await logActivity({ username: req.session.username, action: 'delete', entity: 'User', entityId: uid });
    return { ok: true };
  }
}
