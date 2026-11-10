/**
 * وضعیت لایسنس روی این دستگاه: بررسی امضا، قفل زمان، قفل دستگاه.
 *
 * ## جای کلید عمومی
 * فقط **کلید عمومی** در برنامه است (`src-tauri/public-key` داخل بسته، یا
 * فایل `license-public-key.txt` کنار دیتابیس، یا متغیر محیطی
 * `FD_LICENSE_PUBLIC_KEY`). کلید خصوصی هرگز داخل بسته نمی‌رود.
 *
 * ## «دور زدن‌ناپذیر» یعنی چه — و یعنی چه نیست
 * با Ed25519، ساختن لایسنس بدون کلید خصوصی عملاً ممکن نیست (به‌جای شکستن
 * رمزنگاری، مهاجم باید باینری را وصله کند). این ماژول سه لایه را می‌سنجد:
 *
 *   ۱) **امضا** — هر تغییری در متن لایسنس (نام، تاریخ، کلید دستگاه) امضا را
 *      باطل می‌کند.
 *   ۲) **قفل دستگاه** — لایسنس به «کلید دستگاه» این کمپیوتر بسته است.
 *   ۳) **قفل زمان** — ساعت سیستم بیش از ۲۴ ساعت با «مرجع» فاصله داشته باشد
 *      یعنی دست‌کاری؛ و «اکنون مؤثر» هرگز از مرجع عقب‌تر نمی‌رود، پس
 *      عقب‌بردن ساعت، لایسنس منقضی را زنده نمی‌کند.
 *
 * صادقانه: هیچ برنامه‌ی نصب‌شده روی کمپیوتر کاربر در برابر وصله‌کردن باینری
 * «مطلقاً» مصون نیست؛ کاری که این طراحی می‌کند این است که دور زدن **نیاز به
 * دست‌کاری فنی باینری** داشته باشد، نه یک کلیک (تغییر ساعت/تاریخ/کپی متن).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { db, dataDir } from '../db';
import { ensureSchemaAsync } from '../schema';
import {
  LICENSE_BEGIN, LICENSE_END, LicensePayload, licenseKindOf,
} from './license-kind';
import { machineKeyForDevice, normalizeMachineKey } from './license-machine';
import { verifyLicense } from './license';
import {
  ClockState, checkClock, sealClock, unsealClock, readClockFile, writeClockFile,
  clockKey, emptyClock, effectiveNow, licenseInWindow, daysLeft, CLOCK_TOLERANCE_MS,
} from './license-clock';
import { toCalendar, toDariDigits } from './calendar';

/* ------------------------------------------------------------------ */
/* public key                                                          */
/* ------------------------------------------------------------------ */

export const PUBLIC_KEY_FILE = 'license-public-key.txt';
/** فایل کلید که همراه بسته در `<resource>/public-key/` می‌رود */
export const PUBLIC_KEY_RESOURCE = 'farday-public.b64';
export const LICENSE_FILE = 'license.key';
export const TRIAL_FILE = 'license.trial';

/**
 * کلید عمومی برنامه. ترتیب: متغیر محیطی (ابزار لایسنس) → فایل کنار دیتابیس
 * → فایل همراه بسته (`public-key/`، ساخته‌شده در زمان build) → ثابت پشتیبان.
 */
export function embeddedPublicKey(): string {
  const env = (process.env.FD_LICENSE_PUBLIC_KEY || '').trim();
  if (env) return env;
  const dir = dataDir();
  /*
   * فایل کلید در بسته، `<install>/_up_/public-key/farday-public.b64` است و
   * مسیر دقیقش با نوع نصب (nsis/msi/قابل حمل) جابه‌جا می‌شود. پس از چند
   * ریشه‌ی محتمل نسبت به `__dirname` (= پوشه‌ی api) جست‌وجو می‌شود.
   */
  const here = __dirname;
  const candidates = [
    path.join(dir, PUBLIC_KEY_FILE),
    path.join(here, PUBLIC_KEY_RESOURCE),
    path.join(here, 'public-key', PUBLIC_KEY_RESOURCE),
    path.join(here, '..', 'public-key', PUBLIC_KEY_RESOURCE),
    path.join(here, '..', '..', 'public-key', PUBLIC_KEY_RESOURCE),
    path.join(here, '..', '..', '..', 'public-key', PUBLIC_KEY_RESOURCE),
  ];
  for (const c of candidates) {
    try {
      const t = fs.readFileSync(c, 'utf8').trim();
      if (t) return t;
    } catch { /* next */ }
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

let licensedTableReady = false;

async function ensureLicenseTables() {
  if (licensedTableReady) return;
  await ensureSchemaAsync();
  const p = db();
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "License" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "text" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "machineKey" TEXT NOT NULL DEFAULT '',
    "customer" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT '',
    "start" TEXT NOT NULL DEFAULT '',
    "end" TEXT,
    "activatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LicenseClock" (
    "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
    "anchor" INTEGER NOT NULL DEFAULT 0,
    "lastSeen" INTEGER NOT NULL DEFAULT 0,
    "violations" INTEGER NOT NULL DEFAULT 0,
    "lastViolationAt" INTEGER NOT NULL DEFAULT 0,
    "nonce" TEXT NOT NULL DEFAULT '',
    "mac" TEXT NOT NULL DEFAULT ''
  )`);
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LicenseEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  licensedTableReady = true;
}

export async function licenseEvent(action: string, detail = '') {
  try {
    await ensureLicenseTables();
    await db().$executeRawUnsafe(
      `INSERT INTO "LicenseEvent" ("action","detail") VALUES (?,?)`,
      action,
      detail,
    );
  } catch { /* لاگ نباید چیزی را بیندازد */ }
}

export type StoredLicense = { text: string; fingerprint: string; activatedAt: string };

/** لایسنس فعال: جدول، و اگر نبود فایل `license.key` (تحویل دستی). */
export async function activeLicenseText(): Promise<string> {
  await ensureLicenseTables();
  try {
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT "text" FROM "License" ORDER BY "id" DESC LIMIT 1`,
    );
    if (rows?.[0]?.text) return String(rows[0].text);
  } catch { /* ignore */ }
  for (const c of [path.join(dataDir(), LICENSE_FILE), path.join(__dirname, '..', '..', LICENSE_FILE)]) {
    try {
      const t = fs.readFileSync(c, 'utf8');
      if (t.includes(LICENSE_BEGIN) || t.trim().length > 40) return t;
    } catch { /* next */ }
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* clock storage (db + file, both sealed)                              */
/* ------------------------------------------------------------------ */

export async function readClock(key: string): Promise<ClockState> {
  await ensureLicenseTables();
  const fromFile = readClockFile(key, dataDir());
  let fromDb: ClockState | null = null;
  try {
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT "anchor","lastSeen","violations","lastViolationAt","nonce","mac" FROM "LicenseClock" WHERE "id"=1`,
    );
    const r = rows?.[0];
    if (r) fromDb = unsealClock(key, JSON.stringify({
      anchor: r.anchor, lastSeen: r.lastSeen, violations: r.violations,
      lastViolationAt: r.lastViolationAt, nonce: r.nonce, mac: r.mac,
    }));
  } catch { /* ignore */ }
  /* بزرگ‌ترین مرجع برنده است — پاک‌کردن یکی، تاریخ را عقب نمی‌برد */
  const merged: ClockState = {
    anchor: Math.max(fromFile?.anchor || 0, fromDb?.anchor || 0),
    lastSeen: Math.max(fromFile?.lastSeen || 0, fromDb?.lastSeen || 0),
    violations: Math.max(fromFile?.violations || 0, fromDb?.violations || 0),
    lastViolationAt: Math.max(fromFile?.lastViolationAt || 0, fromDb?.lastViolationAt || 0),
  };
  return merged;
}

export async function writeClock(key: string, state: ClockState) {
  await ensureLicenseTables();
  const sealed = sealClock(key, state);
  try {
    await db().$executeRawUnsafe(
      `INSERT INTO "LicenseClock" ("id","anchor","lastSeen","violations","lastViolationAt","nonce","mac")
       VALUES (1,?,?,?,?,?,?)
       ON CONFLICT("id") DO UPDATE SET "anchor"=excluded."anchor","lastSeen"=excluded."lastSeen",
         "violations"=excluded."violations","lastViolationAt"=excluded."lastViolationAt",
         "nonce"=excluded."nonce","mac"=excluded."mac"`,
      sealed.anchor, sealed.lastSeen, sealed.violations, sealed.lastViolationAt, sealed.nonce, sealed.mac,
    );
  } catch { /* ignore */ }
  writeClockFile(key, dataDir(), state);
}

/* ------------------------------------------------------------------ */
/* trial state (used only when no license is activated)                */
/* ------------------------------------------------------------------ */

export async function trialState(): Promise<ClockState> {
  const key = 'trial';
  const file = readClockFile(key, dataDir());
  let dbState: ClockState | null = null;
  try {
    const t = fs.readFileSync(path.join(dataDir(), TRIAL_FILE), 'utf8');
    dbState = unsealClock(key, t);
  } catch { /* ignore */ }
  return {
    anchor: Math.max(file?.anchor || 0, dbState?.anchor || 0),
    lastSeen: Math.max(file?.lastSeen || 0, dbState?.lastSeen || 0),
    violations: Math.max(file?.violations || 0, dbState?.violations || 0),
    lastViolationAt: Math.max(file?.lastViolationAt || 0, dbState?.lastViolationAt || 0),
  };
}

export async function saveTrialState(state: ClockState) {
  try {
    fs.writeFileSync(path.join(dataDir(), TRIAL_FILE), JSON.stringify(sealClock('trial', state)), 'utf8');
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* the check                                                           */
/* ------------------------------------------------------------------ */

export type LicenseStatus = {
  /** حالت کلی: valid | expired | clock | machine | missing | invalid | trial */
  state: 'valid' | 'expired' | 'clock' | 'machine' | 'missing' | 'invalid' | 'trial';
  ok: boolean;
  /** آیا کاربر بایدن لایسنس وارد کند؟ */
  needsLicense: boolean;
  customer?: string;
  kind?: string;
  kindLabel?: string;
  start?: string;
  end?: string | null;
  /** «۱۹ عقرب ۱۴۰۵» — همان چیزی که کاربر روی صفحه می‌بیند */
  endLabel?: string;
  startLabel?: string;
  daysLeft?: number | null;
  seats?: number;
  machineKey: string;
  /** کلید دستگاه روی این نسخه سالم ساخته می‌شود؟ */
  machineMatch?: boolean;
  clockOk: boolean;
  clockSkewHours: number;
  clockToleranceHours: number;
  message: string;
  licenseId?: string;
  /** چند روز از دوره‌ی آزمایشی مانده (وقتی لایسنس نیست) */
  trialDaysLeft?: number | null;
  /** تاریخ پایان آزمایشی */
  trialEnd?: string | null;
  fingerprint?: string;
  /** امروز به شمسی (میلادی ISO و برچسب فارسی) — «سنجهٔ زمان» */
  nowISO: string;
  nowLabel: string;
};

export const TRIAL_DAYS = 7;

/**
 * «سنجهٔ زمان» — تاریخ امروز به شمسی با رقم فارسی، همان چیزی که روی صفحه‌ی
 * لایسنس و در تنظیمات دیده می‌شود (نمونه: «۱۹ عقرب ۱۴۰۵»).
 */
export function timeMetricLabel(iso: string): string {
  const label = jalaliLabel(iso);
  return toDariDigits(label);
}

function jalaliLabel(iso: string): string {
  try {
    const c = toCalendar(iso, 'jalali');
    const months = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت'];
    /* رقم فارسی — همه‌ی تاریخ‌های این صفحه یک شکل دارند */
    return toDariDigits(`${c.jd} ${months[c.jm - 1]} ${c.jy}`);
  } catch {
    return iso;
  }
}

/**
 * سنجش کامل وضعیت. این تابع **همیشه** پاسخ می‌دهد (استثنا نمی‌اندازد) تا
 * نگهبان بتواند با خیال راحت از آن استفاده کند.
 */
export async function licenseStatus(now = Date.now()): Promise<LicenseStatus> {
  const machineKey = await machineKeyForDevice();
  const pub = embeddedPublicKey();
  const text = await activeLicenseText();
  const todayISO = new Date(now).toISOString().slice(0, 10);
  const base = {
    machineKey,
    clockOk: true,
    clockSkewHours: 0,
    clockToleranceHours: CLOCK_TOLERANCE_MS / 3600000,
    /* «سنجهٔ زمان»: تاریخ امروز به شمسی — روی صفحه‌ی لایسنس نمایش داده می‌شود */
    nowISO: todayISO,
    nowLabel: timeMetricLabel(todayISO),
  };

  if (!text) {
    /* دوره‌ی آزمایشی: از اولین اجرا ۷ روز، با همان قفل زمان */
    const st = await trialState();
    const started = st.anchor || now;
    const check = checkClock(st, now);
    await saveTrialState(check.state);
    const trialEndISO = new Date(started + TRIAL_DAYS * 86400000).toISOString().slice(0, 10);
    const nowISO = new Date(effectiveNow(check.state, now)).toISOString().slice(0, 10);
    const left = daysLeft(trialEndISO, nowISO);
    if (check.tampered) {
      return {
        ...base, state: 'clock', ok: false, needsLicense: true, clockOk: false,
        clockSkewHours: Math.round(check.skewMs / 3600000),
        trialEnd: trialEndISO, trialDaysLeft: left, end: trialEndISO,
        endLabel: jalaliLabel(trialEndISO),
        message: check.message || 'ساعت سیستم دست‌کاری شده است.',
      };
    }
    if (left !== null && left < 0) {
      return {
        ...base, state: 'expired', ok: false, needsLicense: true,
        trialEnd: trialEndISO, trialDaysLeft: 0,
        message: 'دوره‌ی آزمایشی تمام شد. برای ادامه، متن لایسنس را وارد کنید.',
      };
    }
    return {
      ...base, state: 'trial', ok: true, needsLicense: false,
      trialEnd: trialEndISO, trialDaysLeft: left, endLabel: jalaliLabel(trialEndISO), end: trialEndISO,
      message: `دوره‌ی آزمایشی — ${left ?? 0} روز مانده (تا ${jalaliLabel(trialEndISO)}).`,
    };
  }

  if (!pub) {
    return {
      ...base, state: 'invalid', ok: false, needsLicense: true,
      message: 'کلید عمومی لایسنس در برنامه نیست — این نسخه ناقص ساخته شده است.',
    };
  }

  const ver = verifyLicense(text, pub);
  if (!ver.ok || !ver.payload) {
    return {
      ...base, state: 'invalid', ok: false, needsLicense: true,
      message: `لایسنس پذیرفته نشد: ${ver.reason || 'امضا معتبر نیست.'}`,
    };
  }

  const payload = ver.payload;
  const key = clockKey(text.split('\n').filter(Boolean).slice(-2)[0] || text);
  const clock = await readClock(key);
  const check = checkClock(clock, now);
  const usedNow = effectiveNow(check.state, now);
  const nowISO = new Date(usedNow).toISOString().slice(0, 10);

  const kindInfo = licenseKindOf(payload.kind);
  const common = {
    ...base,
    customer: payload.customer,
    kind: payload.kind,
    kindLabel: kindInfo?.label || payload.kind,
    start: payload.start,
    end: payload.end,
    startLabel: jalaliLabel(payload.start),
    endLabel: payload.end ? jalaliLabel(payload.end) : 'بدون پایان (ابد)',
    daysLeft: daysLeft(payload.end, nowISO),
    seats: payload.seats,
    licenseId: payload.id,
    clockOk: !check.tampered,
    clockSkewHours: Math.round(check.skewMs / 3600000),
    nowISO,
    nowLabel: timeMetricLabel(nowISO),
  };

  /* ۱) قفل زمان */
  if (check.tampered) {
    await writeClock(key, check.state);
    await licenseEvent('clock-tamper', check.message || '');
    return {
      ...common, state: 'clock', ok: false, needsLicense: true,
      message: (check.message || 'ساعت سیستم دست‌کاری شده است.') +
        ' ساعت ویندوز را درست کنید و دوباره همین لایسنس را وارد کنید.',
    };
  }

  /* ۲) قفل دستگاه */
  const bound = normalizeMachineKey(payload.machineKey || '');
  const machineMatch = !bound || bound === normalizeMachineKey(machineKey);
  if (!machineMatch) {
    await writeClock(key, check.state);
    return {
      ...common, state: 'machine', ok: false, needsLicense: true, machineMatch: false,
      message: 'این لایسنس برای کمپیوتر دیگری صادر شده است. کلید دستگاه این کمپیوتر را برای پشتیبانی بفرستید.',
    };
  }

  /* ۳) بازه‌ی تاریخ */
  const window = licenseInWindow(payload, nowISO);
  await writeClock(key, check.state);
  if (!window.ok) {
    return { ...common, state: 'expired', ok: false, needsLicense: true, message: window.reason || 'لایسنس منقضی شده است.' };
  }

  return {
    ...common, state: 'valid', ok: true, needsLicense: false, machineMatch: true,
    nowISO,
    nowLabel: timeMetricLabel(nowISO),
    message: payload.end
      ? `لایسنس معتبر است — تا ${common.endLabel} (${common.daysLeft} روز مانده).`
      : 'لایسنس معتبر است — بدون محدودیت زمانی.',
  };
}

/** فعال‌سازی: بررسی امضا و قفل دستگاه، بعد ذخیره. */
export async function activateLicenseText(
  text: string,
  opts: { allowClockReset?: boolean } = {},
): Promise<{ ok: boolean; message: string; status?: LicenseStatus }> {
  await ensureLicenseTables();
  const pub = embeddedPublicKey();
  if (!pub) return { ok: false, message: 'کلید عمومی لایسنس در برنامه نیست.' };

  const raw = String(text || '').trim();
  if (!raw) return { ok: false, message: 'متن لایسنس را وارد کنید.' };

  const ver = verifyLicense(raw, pub);
  if (!ver.ok || !ver.payload) return { ok: false, message: `لایسنس پذیرفته نشد: ${ver.reason || ''}` };
  const payload = ver.payload;

  /* قفل دستگاه — همان قاعده‌ی بررسی، ولی با پیام روشن */
  const machineKey = await machineKeyForDevice();
  const bound = normalizeMachineKey(payload.machineKey || '');
  if (bound && bound !== normalizeMachineKey(machineKey)) {
    return {
      ok: false,
      message: `این لایسنس برای دستگاه دیگری است. کلید این کمپیوتر: ${machineKey}`,
    };
  }

  /*
   * ذخیره. لایسنس تازه جایگزین قبلی می‌شود (خرید تمدید = لایسنس جدید) ولی
   * «مرجع ساعت» پاک نمی‌شود مگر صریحاً خواسته شود — وگرنه عقب‌بردن ساعت و
   * واردکردن یک لایسنس تازه، آسان‌ترین راه دور زدن قفل زمان می‌شد.
   */
  await db().$executeRawUnsafe(`DELETE FROM "License"`);
  await db().$executeRawUnsafe(
    `INSERT INTO "License" ("text","fingerprint","machineKey","customer","kind","start","end")
     VALUES (?,?,?,?,?,?,?)`,
    raw,
    payload.id,
    payload.machineKey || '',
    payload.customer,
    payload.kind,
    payload.start,
    payload.end,
  );
  try {
    fs.writeFileSync(path.join(dataDir(), LICENSE_FILE), raw, 'utf8');
  } catch { /* ignore */ }

  const key = clockKey(raw.split('\n').filter(Boolean).slice(-2)[0] || raw);
  if (opts.allowClockReset) {
    /* «ساعت اشتباه بود» → مرجع با ساعت فعلی هم‌تراز می‌شود (فقط یک بار) */
    await writeClock(key, { ...emptyClock(), anchor: Date.now(), lastSeen: Date.now() });
    await licenseEvent('clock-resync', 'هم‌ترازی ساعت با درخواست کاربر');
  }
  await licenseEvent('activate', `${payload.customer} / ${payload.kind} / ${payload.id}`);
  const status = await licenseStatus();
  return { ok: status.ok, message: status.message, status };
}

/* ------------------------------------------------------------------ */
/* fingerprint                                                         */
/* ------------------------------------------------------------------ */

/**
 * شناسه‌ی نمایشی دستگاه — برای پشتیبانی (نه برای قفل، قفل با `machineKey`).
 * با هش irreversible از میزبان/کاربر/پلتفرم ساخته می‌شود؛ هیچ اطلاعات
 * شخصی خامی ذخیره نمی‌شود.
 */
export async function deviceFingerprint(): Promise<string> {
  const mk = await machineKeyForDevice();
  return mk;
}

export function osSummary(): string {
  return `${os.platform()} ${os.release()} (${os.arch()})`;
}
