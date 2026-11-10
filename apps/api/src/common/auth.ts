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

export function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(String(pw) + 'farday::salt').digest('hex');
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
