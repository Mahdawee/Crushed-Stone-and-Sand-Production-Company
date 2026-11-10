import { Body, Controller, Get, HttpException, Post } from '@nestjs/common';
import { Public } from '../common/auth';
import {
  licenseStatus, activateLicenseText, licenseEvent, osSummary,
  TRIAL_DAYS, embeddedPublicKey, activeLicenseText,
} from '../common/license-state';
import {
  clearLicenseCache, activationAllowed, recordActivationAttempt,
} from '../common/license-guard';
import { machineKeyForDevice, MACHINE_KEY_NOTE } from '../common/license-machine';
import { LICENSE_KINDS, KIND_DAYS } from '../common/license-kind';
import { CLOCK_TOLERANCE_MS } from '../common/license-clock';
import { databaseFile } from '../db';

/**
 * مسیرهای لایسنس — تنها بخشی از API که در حالت قفل باز است.
 *
 * چرا `@Public()`: کاربر بدون لایسنس نمی‌تواند وارد شود (یا اگر وارد شد،
 * هیچ چیزی نمی‌بیند). صفحه‌ی لایسنس باید بدون نشست کار کند، وگرنه
 * «قفل نصب تازه» به یک حلقه‌ی بسته تبدیل می‌شود.
 *
 * ولی `POST /license/activate` فقط متن **امضاشده با کلید خصوصی** را
 * می‌پذیرد؛ بدون کلید خصوصی هیچ‌کس نمی‌تواند از این مسیر لایسنس بسازد.
 */
@Controller()
export class LicenseController {
  /**
   * وضعیت کامل — UI همین را روی صفحه‌ی لایسنس و در تنظیمات نشان می‌دهد.
   * `fresh=1` کش ۵ ثانیه‌ای را دور می‌زند (بعد از فعال‌سازی).
   */
  @Public()
  @Get('license/status')
  async status() {
    const st = await licenseStatus();
    return {
      ...st,
      platform: osSummary(),
      trialDays: TRIAL_DAYS,
      toleranceHours: CLOCK_TOLERANCE_MS / 3600000,
      kinds: LICENSE_KINDS,
      kindDays: KIND_DAYS,
      machineKeyNote: MACHINE_KEY_NOTE,
      publicKeyPresent: Boolean(embeddedPublicKey()),
      dbFile: databaseFile(),
    };
  }

  /** کلید دستگاه فقط — برای دکمه‌ی «کاپی کن و برای پشتیبانی بفرست» */
  @Public()
  @Get('license/device')
  async device() {
    return {
      machineKey: await machineKeyForDevice(),
      platform: osSummary(),
      note: MACHINE_KEY_NOTE,
    };
  }

  /**
   * فعال‌سازی با متن لایسنس.
   *
   * `allowClockReset: true` فقط وقتی معنا دارد که کاربر ساعت ویندوز را درست
   * کرده باشد؛ مرجع ساعت با ساعت فعلی هم‌تراز می‌شود. تاریخ پایان لایسنس
   * امضاشده است و با این کار جلو نمی‌رود.
   */
  @Public()
  @Post('license/activate')
  async activate(@Body() body: { text?: string; allowClockReset?: boolean }) {
    if (!activationAllowed()) {
      throw new HttpException('تلاش‌های زیاد — چند دقیقه بعد دوباره امتحان کنید.', 429);
    }
    recordActivationAttempt();
    const text = String(body?.text || '').trim();
    if (!text) throw new HttpException('متن لایسنس را وارد کنید.', 400);
    if (text.length > 8192) throw new HttpException('متن لایسنس بیش از حد بزرگ است.', 400);

    const res = await activateLicenseText(text, { allowClockReset: Boolean(body?.allowClockReset) });
    clearLicenseCache();
    if (!res.ok) throw new HttpException(res.message, 400);
    await licenseEvent('activate-http', res.status?.licenseId || '');
    return { ok: true, message: res.message, status: res.status };
  }

  /**
   * متن لایسنس فعال — برای پشتیبان‌گیری.
   * چرا این مسیر هست: اگر دیتابیس بازگردانی شود، لایسنس هم برمی‌گردد؛ ولی
   * اگر کاربر ویندوز را از نو نصب کند، داشتن متن لایسنس لازم است.
   */
  @Public()
  @Get('license/text')
  async text() {
    const t = await activeLicenseText();
    return { ok: Boolean(t), text: t };
  }
}
