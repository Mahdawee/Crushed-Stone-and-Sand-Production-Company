/**
 * قفل زمان (ضد عقب‌بردن ساعت).
 *
 * ## چرا این لازم است
 * بدون قفل زمان، کاربری که لایسنسش تمام شده کافی است ساعت ویندوز را به عقب
 * ببرد و برنامه دوباره باز شود. هر قفلی که فقط «امروز ≤ پایان» را بسنجد،
 * با یک کلیک قابل دور زدن است.
 *
 * ## راهکار
 * ۱) **ساعت مرجع (بودجه‌ی زمان):** هر بار که برنامه باز می‌شود یک «امضا» با
 *    زمان واقعی ثبت می‌شود. بزرگ‌ترین زمانی که تا حالا دیده‌ایم = مرجع.
 * ۲) **تلورانس ۲۴ ساعت:** عقب‌رفتن ساعت بیش از تلورانس قفل می‌شود.
 *    جلو رفتن ممکن است صرفاً چند روز خاموش بودن برنامه باشد؛ در حالت آفلاین
 *    نمی‌توان آن را از تغییر عمدی ساعت تشخیص داد. مرجع جلو می‌رود و تاریخ
 *    پایان همچنان بررسی می‌شود؛ برگشت بعدی ساعت همچنان قفل خواهد شد.
 * ۳) **راه‌حل برای ساعت اشتباه واقعی:** کاربر می‌تواند با *همان* لایسنس دوباره
 *    فعال‌سازی کند؛ در این صورت ساعت مرجع با ساعت فعلی هم‌تراز می‌شود — ولی
 *    تاریخ پایان لایسنس هرگز جلو نمی‌رود (امضاشده است).
 * ۴) **ضد برگشت (یاد می‌ماند):** رکورد ساعت در *دو* جا ذخیره می‌شود:
 *    دیتابیس محلی و فایل `license.clock` کنار دیتابیس، هر دو با امضای HMAC
 *    که کلیدش از خودِ امضای لایسنس مشتق می‌شود. پاک کردن یکی بی‌فایده است؛
 *    پاک کردن هر دو یعنی «اولین اجرا» → و آن هم فقط یک بار جواب می‌دهد
 *    چون تاریخ پایان لایسنس امضاشده است و «الان» را نمی‌توان جابه‌جا کرد.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { hmac256, safeEqual, sha256 } from './license';

export const CLOCK_TOLERANCE_MS = 24 * 60 * 60 * 1000; // ۲۴ ساعت
export const CLOCK_FILE = 'license.clock';

export type ClockState = {
  /** بزرگ‌ترین زمانی که تا حالا دیده‌ایم (ms) — «مرجع» */
  anchor: number;
  /** آخرین اجرا — برای نمایش در تنظیمات */
  lastSeen: number;
  /** چند بار جابه‌جایی ساعت تشخیص داده شد */
  violations: number;
  /** آخرین جابه‌جایی (ms یا 0) */
  lastViolationAt: number;
};

export const emptyClock = (): ClockState => ({ anchor: 0, lastSeen: 0, violations: 0, lastViolationAt: 0 });

/** کلید HMAC برای مهر ساعت — از امضای لایسنس مشتق می‌شود (هر لایسنس کلید خودش). */
export function clockKey(licenseSignature: string): string {
  return sha256('farday:clock:' + String(licenseSignature || 'none'));
}

function signClock(key: string, state: ClockState, nonce: string): string {
  return hmac256(key, `${state.anchor}|${state.lastSeen}|${state.violations}|${state.lastViolationAt}|${nonce}`).slice(0, 32);
}

export type SealedClock = ClockState & { nonce: string; mac: string };

export function sealClock(key: string, state: ClockState, nonce = ''): SealedClock {
  const n = nonce || sha256(String(Date.now()) + Math.random()).slice(0, 16);
  return { ...state, nonce: n, mac: signClock(key, state, n) };
}

/** باز کردن مهر — اگر دست‌کاری شده باشد `null` */
export function unsealClock(key: string, raw: string): ClockState | null {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    const state: ClockState = {
      anchor: Number(o.anchor) || 0,
      lastSeen: Number(o.lastSeen) || 0,
      violations: Number(o.violations) || 0,
      lastViolationAt: Number(o.lastViolationAt) || 0,
    };
    if (!o.nonce || typeof o.mac !== 'string') return null;
    if (!safeEqual(o.mac, signClock(key, state, String(o.nonce)))) return null;
    return state;
  } catch {
    return null;
  }
}

/** مسیر فایل مهر ساعت (کنار دیتابیس — همان پوشه‌ای که داده‌ی کاربر است). */
export function clockFilePath(dataDir: string) {
  return path.join(dataDir, CLOCK_FILE);
}

export function readClockFile(key: string, dataDir: string): ClockState | null {
  try {
    return unsealClock(key, fs.readFileSync(clockFilePath(dataDir), 'utf8'));
  } catch {
    return null;
  }
}

export function writeClockFile(key: string, dataDir: string, state: ClockState): void {
  try {
    fs.writeFileSync(clockFilePath(dataDir), JSON.stringify(sealClock(key, state)), 'utf8');
  } catch {
    /* نوشتن فایل نباید برنامه را بیندازد؛ نسخه‌ی دیتابیس هم هست */
  }
}

export type ClockCheck = {
  /** ساعت سیستم قابل اعتماد است؟ */
  ok: boolean;
  /** اختلاف با مرجع (ms) — مثبت = ساعت جلو، منفی = عقب */
  skewMs: number;
  /** ساعت سیستم بیش از تلورانس از مرجع عقب است */
  tampered: boolean;
  state: ClockState;
  message?: string;
};

/**
 * سنجش ساعت. ورودی `now` را تست‌ها می‌دهند؛ در برنامه `Date.now()` است.
 *
 * قاعده:
 *   • ref = max(anchor, lastSeen, savedOnDisk)
 *   • now < ref − 24h → عقب‌بردن ساعت
 *   • وگرنه anchor = max(anchor, now)
 */
export function checkClock(state: ClockState, now: number, toleranceMs = CLOCK_TOLERANCE_MS): ClockCheck {
  const anchors = [state.anchor || 0, state.lastSeen || 0].filter((n) => n > 0);
  const ref = anchors.length ? Math.max(...anchors) : now;
  const skew = now - ref;
  const tampered = skew < -toleranceMs;
  const next: ClockState = {
    anchor: Math.max(state.anchor || 0, ref, now),
    lastSeen: now,
    violations: (state.violations || 0) + (tampered ? 1 : 0),
    lastViolationAt: tampered ? now : state.lastViolationAt || 0,
  };
  if (tampered) {
    const hours = Math.round(Math.abs(skew) / 3600000);
    return {
      ok: false,
      skewMs: skew,
      tampered: true,
      state: next,
      message: `ساعت کمپیوتر ${hours} ساعت عقب‌تر از آخرین اجرای برنامه است (بیش از ۲۴ ساعت) — برنامه قفل شد.`,
    };
  }
  return { ok: true, skewMs: skew, tampered: false, state: next };
}

/**
 * سقف زمانی: حتی اگر همه‌چیز دست‌کاری شود، «اکنون» نمی‌تواند از این بیشتر
 * باشد. استفاده: `hardNow = max(systemNow, anchor)` — یعنی عقب‌بردن ساعت
 * هرگز لایسنس منقضی را زنده نمی‌کند.
 */
export function effectiveNow(state: ClockState, now: number): number {
  return Math.max(now, state.anchor || 0, state.lastSeen || 0);
}

/** آیا لایسنس در زمان `now` معتبر است؟ (پایان شامل همان روز است) */
export function licenseInWindow(
  payload: { start: string; end: string | null },
  nowISO: string,
): { ok: boolean; reason?: string } {
  const today = nowISO.slice(0, 10);
  if (payload.start && today < payload.start) {
    return { ok: false, reason: `لایسنس از تاریخ ${payload.start} شروع می‌شود (امروز ${today}).` };
  }
  if (payload.end && today > payload.end) {
    return { ok: false, reason: `لایسنس در تاریخ ${payload.end} تمام شده است (امروز ${today}).` };
  }
  return { ok: true };
}

/** چند روز مانده؟ null = ابد */
export function daysLeft(end: string | null, nowISO: string): number | null {
  if (!end) return null;
  const a = Date.parse(nowISO.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(end.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}
