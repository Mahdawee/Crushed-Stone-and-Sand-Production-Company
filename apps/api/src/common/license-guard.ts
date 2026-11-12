/**
 * نگهبان لایسنس — «بدون لایسنس معتبر، هیچ کاری انجام نمی‌شود».
 *
 * چرا در سطح API و نه در UI: هر محافظی که فقط در رابط کاربری باشد، با یک
 * درخواست ساده (fetch از کنسول DevTools یا از بیرون) دور زده می‌شود. این
 * نگهبان **قبل از** هر کنترلر دیگری اجرا می‌شود و همه‌ی مسیرها را می‌بندد
 * به‌جز مسیرهای لایسنس و ورود.
 *
 * چه چیزهایی باز می‌مانند و چرا:
 *   • `/api/license/*`  → کاربر باید بتواند وضعیت را ببیند و لایسنس وارد کند.
 *   • `/api/auth/login` → صفحه‌ی ورود نباید خطای عجیب بدهد؛ ولی حتی اگر
 *     کاربر وارد شود، بقیه‌ی API بسته است (یعنی ورود بی‌فایده است و UI خودش
 *     صفحه‌ی لایسنس را نشان می‌دهد).
 *   • `/api/health` و ریشه → برای تشخیص «سرویس زنده است».
 *
 * نکته‌ی کارایی: `licenseStatus()` هر بار رجستری/فایل/دیتابیس می‌خواند،
 * پس نتیجه ۵ ثانیه کش می‌شود (همان الگوی کش تنظیمات).
 */
import {
  CanActivate, ExecutionContext, HttpException, Injectable,
} from '@nestjs/common';
import { licenseStatus, activateLicenseText, LicenseStatus } from './license-state';

/** مسیرهایی که در حالت قفل هم باز هستند (پیشوند میانگین) */
export const LICENSE_EXEMPT = [
  '/license/',
  '/auth/login',
  '/auth/health',
  '/health',
];

export function isLicenseExempt(urlPath: string): boolean {
  const p = String(urlPath || '').split('?')[0];
  if (!p.startsWith('/api')) return true; // فایل‌های UI/استاتیک
  const inner = p.slice(4) || '/';
  if (inner === '/' || inner === '') return true;
  return LICENSE_EXEMPT.some((e) => inner.startsWith(e));
}

let cached: { at: number; status: LicenseStatus } | null = null;
const CACHE_MS = 5000;

export function clearLicenseCache() {
  cached = null;
}

export async function cachedLicenseStatus(force = false): Promise<LicenseStatus> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.status;
  const status = await licenseStatus();
  cached = { at: Date.now(), status };
  return status;
}

@Injectable()
export class LicenseGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: any = context.switchToHttp().getRequest();
    const url: string = req.originalUrl || req.url || '';
    if (isLicenseExempt(url)) return true;

    const status = await cachedLicenseStatus();
    if (status.ok) return true;

    /*
     * ۴۲۳ (Locked) با بدنه‌ی ساختاریافته: UI با `code: 'LICENSE_REQUIRED'`
     * مستقیم صفحه‌ی لایسنس را باز می‌کند و پیام فارسی را نشان می‌دهد.
     */
    throw new HttpException(
      {
        statusCode: 423,
        code: 'LICENSE_REQUIRED',
        licenseState: status.state,
        message: status.message,
        license: status,
      },
      423,
    );
  }
}

/* ------------------------------------------------------------------ */
/* محدودیت تلاش فعال‌سازی (جلوگیری از حدس‌زدن/حمله)                     */
/* ------------------------------------------------------------------ */

const attempts: number[] = [];
const MAX_ATTEMPTS = 12;
const WINDOW_MS = 5 * 60 * 1000;

export function activationAllowed(): boolean {
  const now = Date.now();
  while (attempts.length && now - attempts[0] > WINDOW_MS) attempts.shift();
  return attempts.length < MAX_ATTEMPTS;
}

export function recordActivationAttempt() {
  attempts.push(Date.now());
}

/** فعال‌سازی + پاک‌کردن کش وضعیت (تا اثرش فوری دیده شود) */
export async function activateAndRefresh(text: string, allowClockReset = false) {
  const res = await activateLicenseText(text, { allowClockReset });
  clearLicenseCache();
  return res;
}
