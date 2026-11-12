import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, HttpException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'node:crypto';
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { settingsService } from './settings';

/**
 * Sessions are kept in memory: the app runs on ONE machine (the office PC),
 * so a restart of the API simply asks everybody to log in again — which is
 * the safest behaviour for a local system.
 */
export type Session = { token: string; userId: number; username: string; role: string; fullName: string; createdAt: number };
const sessions = new Map<string, Session>();
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12h

/*
 * ── رمز عبور: از SHA-256 به `scrypt` ────────────────────────────────────
 *
 * باگ امنیتی (شکار باگ دور ۲۷): رمزها با یک SHA-256 و نمکِ **ثابت و
 * هاردکدشده** (`'farday::salt'`) ذخیره می‌شدند. نمک ثابت یعنی:
 *   • چند کاربر با رمز یکسان، هشِ یکسان دارند (نشانی برای حدس زدن)؛
 *   • یک جدول رنگین‌کمانی که برای یک نسخه ساخته شود، برای **همه‌ی**
 *     نصب‌های این برنامه کار می‌کند (چون نمک همه‌جا یکی است)؛
 *   • SHA-256 عمداً سریع است — دقیقاً برعکس چیزی که برای رمز لازم است.
 *
 * حالا: `scrypt` با **نمک تصادفی برای هر کاربر** و الگوریتم نسخه‌دار:
 *
 *     scrypt$<N>$<r>$<p>$<salt-hex>$<key-hex>
 *
 * سازگاری: هش‌های قدیمی (۶۴ حرف hex) هنوز پذیرفته می‌شوند و **در همان
 * ورود موفق** بی‌صدا به فرمت تازه ارتقا پیدا می‌کنند — کاربر رمزش را عوض
 * نمی‌کند و چیزی متوجه نمی‌شود.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw ?? ''), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** هش قدیمی (SHA-256 با نمک ثابت) — فقط برای سازگاری خواندن. */
function legacyHash(pw: string): string {
  return crypto.createHash('sha256').update(String(pw) + 'farday::salt').digest('hex');
}

/** آیا این مقدار هشِ فرمت تازه است؟ */
export function isModernHash(stored: string): boolean {
  return /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(String(stored || ''));
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * بررسی رمز. برای هش قدیمی هم کار می‌کند.
 * مقدار `needsUpgrade` می‌گوید ذخیره باید به فرمت تازه ارتقا پیدا کند.
 */
export function verifyPassword(pw: string, stored: string): { ok: boolean; needsUpgrade: boolean } {
  const s = String(stored || '');
  if (isModernHash(s)) {
    const [, n, r, p, saltHex, keyHex] = s.split('$');
    try {
      const key = crypto.scryptSync(String(pw ?? ''), Buffer.from(saltHex, 'hex'), keyHex.length / 2, {
        N: Number(n), r: Number(r), p: Number(p),
      });
      return { ok: safeEqual(key.toString('hex'), keyHex), needsUpgrade: false };
    } catch {
      return { ok: false, needsUpgrade: false };
    }
  }
  /* فرمت قدیمی (۶۴ hex) */
  const ok = safeEqual(legacyHash(pw), s);
  return { ok, needsUpgrade: ok };
}

export function createSession(user: { id: number; username: string; role: string; fullName: string }): Session {
  const token = crypto.randomBytes(24).toString('hex');
  const s: Session = { token, userId: user.id, username: user.username, role: user.role, fullName: user.fullName, createdAt: Date.now() };
  sessions.set(token, s);
  return s;
}

export function destroySession(token: string) {
  sessions.delete(token);
}

/**
 * باطل کردن همه‌ی نشست‌های یک کاربر — باگ (شکار باگ دور ۲۷):
 *
 * وقتی مدیر رمز یک کاربر را عوض می‌کرد، رمز کارمند غیرفعال می‌شد ولی
 * **توکن‌های باز او معتبر می‌ماندند** (تا ۱۲ ساعت). یعنی «تغییر رمز برای
 * بیرون کردن کسی» کار نمی‌کرد. حالا با تغییر/غیرفعال‌سازی/حذف کاربر،
 * نشست‌های او همان لحظه باطل می‌شوند.
 */
export function destroySessionsOf(userId: number) {
  for (const [token, s] of sessions) {
    if (s.userId === Number(userId)) sessions.delete(token);
  }
}

export function getSession(token?: string): Session | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return s;
}

/**
 * کاربر جاری درخواست — «چه کسی این کار را کرد؟»
 *
 * ## باگی که این حل می‌کند
 * `softDelete` نام کاربر را از `opts.username` می‌گرفت، ولی هیچ کنترلری این
 * پارامتر را پر نمی‌کرد. نتیجه: در «سطل بازیافت» ستون «حذف توسط» همیشه
 * `system` بود — دقیقاً همان چیزی که کاربر می‌خواست بداند («چه کسی حذف
 * کرد») خالی بود. حالا نگهبان ورود `req.session` را می‌گذارد و کنترلرها با
 * `userOf(req)` نام واقعی را به لایه‌ی حذف نرم می‌دهند.
 */
export function userOf(req: any): string {
  return String(req?.session?.username || '');
}

export const PUBLIC_KEY = 'farday:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const MANAGER_ONLY = 'farday:managerOnly';
export const ManagerOnly = () => SetMetadata(MANAGER_ONLY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest();
    const token = (req.headers['x-auth-token'] as string) || '';
    const session = getSession(token);
    if (session) {
      req.session = session;
      if (isPublic) return true;
      const managerOnly = this.reflector.getAllAndOverride<boolean>(MANAGER_ONLY, [context.getHandler(), context.getClass()]);
      if (managerOnly && session.role !== 'manager') {
        throw new ForbiddenException('این عملیات فقط برای مدیر سیستم است.');
      }
      return true;
    }
    // First run with no users yet → the setup screen is reachable.
    if (isPublic) return true;
    /*
     * کاربر وارد نشده. اگر لایسنس مشکل دارد، پیام باید **همان** باشد نه
     * «وارد شوید» — وگرنه کاربر در صفحه‌ی ورود گیر می‌کند و نمی‌فهمد مشکل
     * لایسنس است. (LicenseGuard بعد از این نگهبان اجرا می‌شود.)
     */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { licenseStatus } = require('./license-state');
      const st = await licenseStatus();
      if (!st.ok) {
        throw new HttpException(
          { statusCode: 423, code: 'LICENSE_REQUIRED', licenseState: st.state, message: st.message, license: st },
          423,
        );
      }
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      /* خطای غیرمنتظره در خواندن لایسنس: پیام اصلی ورود را بده */
    }
    throw new UnauthorizedException('برای ادامه وارد سیستم شوید.');
  }
}

/** First-run: create the admin user if the table is empty. */
export async function ensureDefaultAdmin() {
  await ensureSchemaAsync();
  await settingsService.ensureDefaults();
  const p = db();
  const rows: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "User"`);
  const count = Number(rows?.[0]?.c ?? 0);
  if (count === 0) {
    await p.$executeRawUnsafe(
      `INSERT INTO "User" ("username","fullName","passwordHash","role","active") VALUES (?,?,?,?,1)`,
      'admin',
      'مدیر سیستم',
      hashPassword('admin123'),
      'manager',
    );
    return { created: true, username: 'admin', password: 'admin123' };
  }
  return { created: false };
}
