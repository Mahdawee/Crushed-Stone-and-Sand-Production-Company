/**
 * «کلید دستگاه» (machine key) — شناسه‌ای که قفل را به همین کمپیوتر می‌بندد.
 *
 * ## چه چیزی خوانده می‌شود
 * روی ویندوز (که کمپیوتر کاربر است) از سه شناسه‌ی ثابتِ سخت‌افزاری/سیستمی
 * استفاده می‌شود:
 *   • `MachineGuid` در رجستری (`HKLM\SOFTWARE\Microsoft\Cryptography`) —
 *     هنگام نصب ویندوز ساخته می‌شود و با نصب مجدد برنامه عوض نمی‌شود.
 *   • `wmic csproduct get uuid` — UUID تخته‌مادر (روی ویندوزهای قدیمی/جدید).
 *   • نام کمپیوتر + نام کاربری + پلتفرم — به‌عنوان چاشنی.
 *
 * چرا خواندن مستقیم رجستری: هیچ ابزار جانبی (powershell، wmic) لازم نیست و
 * بعد از دست‌کاری `wmic` در ویندوز ۱۱ هم کار می‌کند. همه‌ی این‌ها فقط
 * **خوانده** می‌شوند و هیچ‌جا ارسال نمی‌شوند؛ خروجی فقط یک هش است.
 *
 * ## چرا هش
 * کلید دستگاه = ۲۵ نویسه از یک هش SHA-256 با «چاشنی» ثابت. خودِ شناسه‌های
 * سخت‌افزاری هیچ‌وقت از برنامه بیرون نمی‌روند و از کلید هم بازسازی نمی‌شوند.
 *
 * ## تشخیص «همان دستگاه»
 * `machineKey` روی لایسنس ذخیره می‌شود؛ در هر بار اجرا با کلید فعلی مقایسه
 * می‌شود. تغییر نام کمپیوتر یا نصب مجدد ویندوز می‌تواند کلید را عوض کند —
 * برای همین در تنظیمات یک توضیح کوتاه هست و پشتیبانی می‌تواند لایسنس را با
 * کلید تازه دوباره صادر کند (کلید خصوصی دست شماست).
 */
import * as os from 'node:os';
import { machineKeyFromSeed, normalizeMachineKey, isValidMachineKey } from './license';
export { normalizeMachineKey, isValidMachineKey };
import { sha256 } from './license';

/* ------------------------------------------------------------------ */
/* windows registry (MachineGuid) — بدون ابزار جانبی                   */
/* ------------------------------------------------------------------ */

/**
 * خواندن `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` با `reg query`.
 * `reg.exe` در همه‌ی نسخه‌های ویندوز هست و همان چیزی است که خود ویندوز
 * استفاده می‌کند. خروجی: مقدار GUID یا ''.
 */
function windowsMachineGuid(): string {
  if (process.platform !== 'win32') return '';
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { timeout: 4000, windowsHide: true, encoding: 'utf8' },
    );
    const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{30,40})/.exec(String(out));
    return m ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

/** UUID تخته‌مادر — تلاش اختیاری (اگر نبود، بقیه‌ی شناسه‌ها کافی‌اند). */
function windowsBaseboardUuid(): string {
  if (process.platform !== 'win32') return '';
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const ps = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_ComputerSystemProduct).UUID'],
      { timeout: 6000, windowsHide: true, encoding: 'utf8' },
    );
    const v = String(ps).trim().toLowerCase();
    return /^[0-9a-f-]{30,40}$/.test(v) ? v : '';
  } catch {
    return '';
  }
}

/** جمع‌آوری «بذر» دستگاه از همه‌ی منابع موجود (ثابت‌ترین‌ها اول). */
export function deviceSeed(): string {
  const parts: string[] = [];
  const guid = windowsMachineGuid();
  if (guid) parts.push('guid:' + guid);
  if (process.platform === 'win32') {
    const uuid = windowsBaseboardUuid();
    if (uuid) parts.push('uuid:' + uuid);
  }
  /* چاشنی‌های عمومی — نه شناسه‌ی سخت‌افزاری، ولی تغییرشان نادر است */
  parts.push('host:' + os.hostname().toLowerCase());
  parts.push('user:' + (os.userInfo().username || '').toLowerCase());
  parts.push('plat:' + process.platform + '-' + os.arch());
  /*
   * اگر هیچ شناسه‌ی سخت‌افزاری خوانده نشد (مثلاً لینوکس در تست)، بذر فقط از
   * چاشنی‌های عمومی ساخته می‌شود — همان کلید، ولی ضعیف‌تر. روی ویندوز کاربر
   * همیشه MachineGuid هست.
   */
  return parts.join('|');
}

/** کد ۲۵ نویسه‌ای «کلید دستگاه» — قالبی مثل `A74PA-AW6C7-UAB99-PAPJU-VQWQW` */
export function computeMachineKey(): string {
  return machineKeyFromSeed(sha256(deviceSeed()));
}

/**
 * کلید دستگاه + امکان «جانشینی» صریح با متغیر محیطی (برای تست و برای ابزار
 * پشتیبانی وقتی مشتری کلید را تلفنی می‌خواند).
 */
export async function machineKeyForDevice(): Promise<string> {
  const override = (process.env.FD_MACHINE_KEY || '').trim();
  if (override && isValidMachineKey(override)) return normalizeMachineKey(override);
  return computeMachineKey();
}

/** توضیح کوتاه برای کاربر — چرا کلید دستگاه عوض می‌شود. */
export const MACHINE_KEY_NOTE =
  'کلید دستگاه از شناسه‌های ثابت همین کمپیوتر ساخته می‌شود (هنگام نصب ویندوز). ' +
  'اگر ویندوز را از نو نصب کنید یا نام کمپیوتر را عوض کنید ممکن است کلید تغییر کند؛ ' +
  'در آن صورت همین کلید تازه را برای پشتیبانی بفرستید تا لایسنس دوباره صادر شود. ' +
  'هیچ اطلاعاتی از کمپیوتر شما جایی ارسال نمی‌شود — فقط یک کد کوتاه.';
