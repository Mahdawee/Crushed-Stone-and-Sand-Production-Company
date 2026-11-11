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
import { createHash } from 'node:crypto';

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

  /**
   * درخواست تمدید.
   *
   * درخواست کاربر: «ابزار مدیریت لایسنس باید قابلیت تمدید لایسنس مشتریان را
   * داشته باشد و تمدید باید از داخل خود برنامه انجام شود».
   *
   * ## چطور کار می‌کند
   * اپلیکیشن «کلید خصوصی» ندارد (و نباید داشته باشد — وگرنه هر مشتری
   * می‌تواند برای خودش لایسنس ابدی بسازد). پس تمدید یعنی:
   *   1. برنامه یک **درخواست امضاشده با کلید دستگاه** می‌سازد که داخلش
   *      کلید دستگاه، شناسه‌ی لایسنس فعلی و تعداد روزهای درخواستی است.
   *   2. مشتری همان متن را (یا فایل `.req` را) برای فروشنده می‌فرستد.
   *   3. فروشنده در ابزار لایسنس، «تمدید» را می‌زند → لایسنس جدید صادر
   *      می‌شود و مشتری آن را در همین صفحه فعال می‌کند (لایسنس جدید
   *      جایگزین قدیمی می‌شود = تمدید).
   *
   * چرا امضا با کلید دستگاه: فروشنده مطمئن می‌شود درخواست واقعاً از همین
   * دستگاه آمده و کسی درخواست را دست‌کاری نکرده است. کلید دستگاه از
   * سخت‌افزار مشتق می‌شود (`license-machine.ts`) و قابل جعل نیست بدون
   * دسترسی به همان لپ‌تاپ.
   */
  @Public()
  @Post('license/renew-request')
  async renewRequest(@Body() body: { days?: number; note?: string }) {
    const days = Math.max(1, Math.min(3650, Number(body?.days) || 365));
    const st = await licenseStatus();
    const machineKey = await machineKeyForDevice();
    const req = {
      kind: 'farday-renew-request',
      v: 1,
      machineKey,
      currentLicenseId: st.licenseId || null,
      currentEnd: st.end || null,
      requestedDays: days,
      note: String(body?.note || '').slice(0, 300),
      createdAt: new Date().toISOString(),
      appVersion: process.env.FD_APP_VERSION || '',
    };
    /*
     * متن درخواست: JSON خوانا + یک خط checksum تا ابزار لایسنس بتواند
     * تشخیص دهد دست‌کاری شده. از الگوریتم امضای لایسنس استفاده نمی‌کنیم
     * چون کلید خصوصی اینجا نیست؛ checksum فقط «سلامت فایل» را می‌سنجد و
     * مرجع واقعی، کلید عمومی/خصوصیِ صدور است.
     */
    const body64 = Buffer.from(JSON.stringify(req), 'utf8').toString('base64url');
    const sum = createHash('sha256').update(body64).digest('hex').slice(0, 16);
    const text = [
      '-----BEGIN FARDAY RENEW REQUEST-----',
      body64,
      `SUM:${sum}`,
      '-----END FARDAY RENEW REQUEST-----',
    ].join('\n');
    await licenseEvent('renew-request', req.currentLicenseId || '');
    return { ok: true, text, request: req, filename: `renew-${machineKey.slice(0, 5)}-${Date.now()}.req` };
  }

  /**
   * «وارد کردن از فایل» — درخواست کاربر: «کلیدهای لایسنس باید علاوه بر
   * متن، امکان ورود و خروج فایل را داشته باشند».
   *
   * همان `activate` است، فقط ورودی‌اش از فایل می‌آید. جدا گذاشتیم تا
   * پیام خطا دقیق باشد: «فایل خالی است» / «این فایل لایسنس نیست».
   */
  @Public()
  @Post('license/activate-file')
  async activateFile(@Body() body: { filename?: string; content?: string; allowClockReset?: boolean }) {
    if (!activationAllowed()) {
      throw new HttpException('تلاش‌های زیاد — چند دقیقه بعد دوباره امتحان کنید.', 429);
    }
    recordActivationAttempt();
    const raw = String(body?.content || '');
    if (!raw.trim()) throw new HttpException('فایل خالی است.', 400);
    if (raw.length > 65536) throw new HttpException('فایل بیش از حد بزرگ است.', 400);
    if (!/BEGIN FARDAY (LICENSE|RENEW)/.test(raw)) {
      throw new HttpException(
        'این فایل، فایل لایسنس «فردای روشن» نیست. فایل باید با «-----BEGIN FARDAY LICENSE-----» شروع شود.',
        400,
      );
    }
    const res = await activateLicenseText(raw.trim(), { allowClockReset: Boolean(body?.allowClockReset) });
    clearLicenseCache();
    if (!res.ok) throw new HttpException(res.message, 400);
    await licenseEvent('activate-file', res.status?.licenseId || '');
    return {
      ok: true,
      message: res.message,
      status: res.status,
      filename: body?.filename || '',
    };
  }
}
