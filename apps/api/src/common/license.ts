/**
 * موتور لایسنس — امضای دیجیتال Ed25519، متن لایسنس و کلید دستگاه.
 *
 * ## چرا Ed25519
 * تنها چیزی که لایسنس را «دور زدن‌ناپذیر» می‌کند این است که **برنامه فقط
 * کلید عمومی** داشته باشد. با Ed25519 (RFC 8032) کلید عمومی ۳۲ بایت است و
 * در صورتی که کلید خصوصی (که روی کمپیوتر شما می‌ماند) درز نکند، ساختن
 * لایسنس بدون آن از نظر محاسباتی ممکن نیست. برخلاف RSA/ECDSA، امضا کوتاه
 * (۶۴ بایت) و تصادفی‌سازی وابسته به پیام است، پس امضای یک لایسنس روی
 * لایسنس دیگر قابل استفاده نیست.
 *
 * ## تنها نقطه‌ی حقیقت
 * هر متن لایسنس (بلوک `-----BEGIN FARDAY LICENSE-----`) دقیقاً همین شکل را
 * دارد:
 *
 *   FR-1                       ← نسخه‌ی قالب
 *   base64url(payload)         ← بدنه‌ی JSON
 *   base64url(signature)       ← امضای Ed25519 روی **رشته‌ی payload**
 *
 * امضا روی **بایت‌های همان رشته** زده می‌شود (نه روی JSON دوباره‌سازی‌شده)،
 * بنابراین فاصله/ترتیب کلیدها هیچ‌وقت باعث رد شدن لایسنس نمی‌شود.
 *
 * ## متن لایسنس از دید کاربر
 * بدنه شامل نام مشتری، نوع دوره (سالانه/ماهوار/ابد/دلخواه)، بازه‌ی تاریخ،
 * کلید قفل دستگاه و شناسه‌ی یکتاست. کاربر فقط رشته‌ی base64 را کپی می‌کند؛
 * هیچ چیزی را نمی‌تواند تغییر دهد چون امضا با آن نمی‌خواند.
 */
import * as crypto from 'node:crypto';
import {
  LICENSE_BEGIN, LICENSE_END, LICENSE_FORMAT, LICENSE_KINDS, KIND_DAYS,
} from './license-kind';
import type { LicenseKind, LicensePayload } from './license-kind';

export { LICENSE_BEGIN, LICENSE_END, LICENSE_FORMAT, LICENSE_KINDS, KIND_DAYS };
export type { LicenseKind, LicensePayload };

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export const b64u = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function unb64u(s: string): Buffer {
  const t = String(s || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t)) throw new Error('رشته‌ی base64 نامعتبر است.');
  return Buffer.from(t, 'base64');
}

/** hmac256 — برای مشتق‌کردن «کلید دستگاه» از شناسه‌های سخت‌افزاری. */
export function hmac256(key: string, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

export function sha256(s: string | Buffer): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** مقایسه‌ی مقاوم به زمان (جلوگیری از حدس‌زدن با اندازه‌گیری زمان پاسخ) */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/* ------------------------------------------------------------------ */
/* Ed25519 keys                                                        */
/* ------------------------------------------------------------------ */

export type KeyPairB64 = { publicKey: string; privateKey: string; createdAt: string; label: string };

/** ساخت جفت‌کلید تازه — فقط در ابزار مالک (keygen). */
export function generateKeyPair(label = ''): KeyPairB64 {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: b64u(publicKey.export({ type: 'spki', format: 'der' })),
    privateKey: b64u(privateKey.export({ type: 'pkcs8', format: 'der' })),
    createdAt: new Date().toISOString(),
    label,
  };
}

export function importPrivateKey(privateKeyB64: string): crypto.KeyObject {
  const der = unb64u(privateKeyB64);
  const key = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('کلید خصوصی Ed25519 نیست.');
  return key;
}

export function importPublicKey(publicKeyB64: string): crypto.KeyObject {
  const der = unb64u(publicKeyB64);
  const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('کلید عمومی Ed25519 نیست.');
  return key;
}

/** امضای متن → base64url */
export function signText(text: string, privateKeyB64: string): string {
  return b64u(crypto.sign(null, Buffer.from(text, 'utf8'), importPrivateKey(privateKeyB64)));
}

/** بررسی امضا — هر خطایی (کلید خراب، امضای خراب، طول نادرست) یعنی «نامعتبر». */
export function verifyText(text: string, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const pub = importPublicKey(publicKeyB64);
    const sig = unb64u(signatureB64);
    if (sig.length !== 64) return false;
    return crypto.verify(null, Buffer.from(text, 'utf8'), pub, sig);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* machine key                                                         */
/* ------------------------------------------------------------------ */

/**
 * «امضای کلید دستگاه» — پیشوند کوتاه که از پیشوند کلید عمومی مشتق می‌شود.
 *
 * چرا جدا از امضای لایسنس: کاربر برای *گرفتن* لایسنس، این کلید را برای شما
 * می‌فرستد (تلفن/واتساپ). اگر کلید عمومی را کامل بدهد، مشکلی نیست؛ ولی
 * ترجیحاً یک کد کوتاه ۲۵ کاراکتری می‌فرستد که هم راحت خوانده می‌شود، هم
 * طول عمر نسخه‌های بعدی را با تغییر «seed» کوتاه می‌کند.
 */
export const MACHINE_KEY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MACHINE_KEY_LEN = 25;

/** ساخت کلید دستگاه از seed (همان seed داخل لایسنس امضا می‌شود). */
export function machineKeyFromSeed(seedHex: string): string {
  const h = sha256('farday:mk:' + seedHex);
  let out = '';
  for (let i = 0; i < MACHINE_KEY_LEN; i++) {
    out += MACHINE_KEY_ALPHABET[parseInt(h.slice(i * 2, i * 2 + 2), 16) % MACHINE_KEY_ALPHABET.length];
  }
  return out.replace(/(.{5})/g, '$1-').replace(/-$/, '');
}

/** پاک‌سازی ورودی کاربر: فاصله/خط تیره/حروف کوچک → شکل استاندارد */
export function normalizeMachineKey(input: string): string {
  const raw = String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  const body = raw.slice(0, MACHINE_KEY_LEN);
  return body.replace(/(.{5})/g, '$1-').replace(/-$/, '');
}

export const isValidMachineKey = (input: string) =>
  normalizeMachineKey(input).replace(/-/g, '').length === MACHINE_KEY_LEN;

/* ------------------------------------------------------------------ */
/* license text                                                        */
/* ------------------------------------------------------------------ */

export type LicensePayloadInput = Omit<LicensePayload, 'v' | 'issuedAt'> & { issuedAt?: string };

/** ساخت متن لایسنس (امضاشده). فقط ابزار مالک این را صدا می‌زند. */
export function issueLicense(input: LicensePayloadInput, privateKeyB64: string): { text: string; payload: LicensePayload } {
  const payload: LicensePayload = {
    v: 1,
    id: String(input.id || '').trim() || `FR-LIC-${Date.now().toString(36).toUpperCase()}`,
    customer: String(input.customer || '').trim(),
    kind: input.kind,
    start: String(input.start || '').slice(0, 10),
    end: input.end ? String(input.end).slice(0, 10) : null,
    machineKey: input.machineKey ? normalizeMachineKey(input.machineKey) : '',
    seats: Number.isFinite(Number(input.seats)) ? Math.max(0, Math.trunc(Number(input.seats))) : 1,
    note: String(input.note || '').trim(),
    issuedAt: input.issuedAt || new Date().toISOString(),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.start)) throw new Error('تاریخ شروع لایسنس درست نیست.');
  if (payload.end && !/^\d{4}-\d{2}-\d{2}$/.test(payload.end)) throw new Error('تاریخ پایان لایسنس درست نیست.');
  if (payload.end && payload.end < payload.start) throw new Error('تاریخ پایان قبل از شروع است.');
  if (payload.machineKey && !isValidMachineKey(payload.machineKey)) {
    throw new Error(`کلید دستگاه باید ${MACHINE_KEY_LEN} نویسه باشد.`);
  }
  if (payload.kind === 'perpetual' || payload.kind === 'machine') payload.end = null;
  if (payload.kind === 'yearly' && !payload.end) throw new Error('لایسنس سالانه باید تاریخ پایان داشته باشد.');
  if (payload.kind === 'monthly' && !payload.end) throw new Error('لایسنس ماهوار باید تاریخ پایان داشته باشد.');

  const body = b64u(JSON.stringify(payload));
  const sig = signText(body, privateKeyB64);
  const text = `${LICENSE_BEGIN}\n${LICENSE_FORMAT}\n${body}\n${sig}\n${LICENSE_END}`;
  return { text, payload };
}

/** جدا کردن اجزای متن لایسنس — بدون بررسی امضا. */
export function parseLicenseText(text: string): { format: string; body: string; signature: string; payload: LicensePayload } {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  /* کاربر ممکن است فقط رشته‌ی base64 را کپی کند (بدون سرصفحه) */
  const stripped = lines.filter((l) => l !== LICENSE_BEGIN && l !== LICENSE_END);
  if (stripped.length < 2) throw new Error('متن لایسنس ناقص است.');
  let format = LICENSE_FORMAT;
  let body = stripped[0];
  let signature = stripped[1];
  if (/^FR-\d+$/.test(stripped[0])) {
    format = stripped[0];
    body = stripped[1];
    signature = stripped[2];
  }
  if (!body || !signature) throw new Error('متن لایسنس ناقص است.');
  if (body.length > 4096) throw new Error('متن لایسنس بیش از حد بزرگ است.');
  let payload: LicensePayload;
  try {
    payload = JSON.parse(unb64u(body).toString('utf8'));
  } catch {
    throw new Error('بدنه‌ی لایسنس خوانده نشد.');
  }
  if (!payload || typeof payload !== 'object' || payload.v !== 1) throw new Error('نسخه‌ی لایسنس پشتیبانی نمی‌شود.');
  return { format, body, signature, payload };
}

export type VerifyResult = {
  ok: boolean;
  reason?: string;
  payload?: LicensePayload;
  /** آیا امضا معتبر است (ولی ممکن است تاریخ/دستگاه رد شود) */
  signatureOk: boolean;
};

/**
 * بررسی کامل یک لایسنس (امضا + قالب). زمان/دستگاه **اینجا** بررسی نمی‌شود؛
 * آن کار `licenseGuard` است، چون به ساعت و اثرانگشت دستگاه نیاز دارد.
 */
export function verifyLicense(text: string, publicKeyB64: string): VerifyResult {
  let parsed;
  try {
    parsed = parseLicenseText(text);
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'متن لایسنس خوانده نشد.', signatureOk: false };
  }
  if (parsed.format !== LICENSE_FORMAT) {
    return { ok: false, reason: `قالب لایسنس پشتیبانی نمی‌شود (${parsed.format}).`, signatureOk: false };
  }
  if (!verifyText(parsed.body, parsed.signature, publicKeyB64)) {
    return { ok: false, reason: 'امضای لایسنس معتبر نیست.', signatureOk: false };
  }
  return { ok: true, payload: parsed.payload, signatureOk: true };
}

/* ------------------------------------------------------------------ */
/* periods                                                             */
/* ------------------------------------------------------------------ */

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** بازه‌ی پیش‌فرض از روی نوع دوره (ابزار لایسنس از این استفاده می‌کند). */
export function defaultRange(kind: LicenseKind, start: string): { start: string; end: string | null } {
  const days = KIND_DAYS[kind];
  if (days == null) return { start, end: null };
  /* پایان شامل روز آخر است: ۳۰ روزه = start … start+29 */
  return { start, end: addDaysISO(start, days - 1) };
}
