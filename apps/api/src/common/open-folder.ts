import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * باز کردن پوشه در فایل‌منیجر — پیشنهاد C2، دور ۴۰.
 *
 * ── چرا سرور و نه مرورگر ────────────────────────────────────────────────
 * مرورگر نمی‌تواند پوشه‌ای در کمپیوتر باز کند (و نباید بتواند). ولی پوشه‌ی
 * داده **همیشه روی همان ماشینی است که سرور رویش اجرا می‌شود** — چه نصب
 * دسکتاپ باشد و چه نسخه‌ی وب محلی. پس سرور می‌تواند و این کار در هر دو
 * حالت یکی است، بدون نیاز به API اضافه‌ی Tauri.
 *
 * ── چه چیزی خطرناک است و چطور بسته شد ───────────────────────────────────
 * اگر آدرس پوشه از درخواست گرفته می‌شد، یک مدیرِ لاگین‌شده می‌توانست هر
 * پوشه‌ای را باز کند (`C:\Windows`). اینجا **مسیر از کلاینت پذیرفته
 * نمی‌شود**؛ فقط سه پوشه‌ی شناخته‌شده با کلید باز می‌شوند.
 *
 * ── چرا execFile و نه exec ──────────────────────────────────────────────
 * `exec` یک شل باز می‌کند؛ اگر روزی مسیر از input بیاید، تزریق فرمان ممکن
 * می‌شود. `execFile` بدون شل اجرا می‌کند و هر آرگومان جدا می‌رود.
 *
 * ── چرا «خطا» بلعیده نمی‌شود ────────────────────────────────────────────
 * اگر باز شدن شکست بخورد، کاربر باید بداند — نه اینکه دکمه بی‌صدا هیچ
 * نکند. مسیر هم در پاسخ برمی‌گردد تا کاربر دستی برود.
 */

export type FolderKey = 'data' | 'backups' | 'logs';

export interface OpenResult {
  ok: boolean;
  key: FolderKey;
  path: string;
  /** روشی که واقعاً استفاده شد — برای عیب‌یابی و نمایش صادقانه */
  via: 'explorer' | 'open' | 'xdg-open' | 'none';
  message?: string;
}

/**
 * باز کردن یک پوشه در فایل‌منیجر سیستم.
 *
 * در لینوکسِ بدون محیط گرافیکی (سرور، Docker، این سندباکس) هیچ فایل‌منیجری
 * نیست؛ آن حالت `via:'none'` با پیام روشن برمی‌گرداند، نه استثنا — چون
 * مسیر باز هم ارزش نمایش دارد.
 */
export function openFolder(dir: string): Promise<Omit<OpenResult, 'key'>> {
  return new Promise((resolve) => {
    if (!dir || !fs.existsSync(dir)) {
      resolve({ ok: false, path: dir || '', via: 'none', message: 'پوشه موجود نیست.' });
      return;
    }
    const platform = os.platform();
    let cmd: string;
    let args: string[];
    let via: OpenResult['via'];
    if (platform === 'win32') {
      /*
       * `/select,` فایل یا پوشه را در Explorer **انتخاب** می‌کند. برای
       * پوشه، `explorer.exe "path"` ساده‌تر است و پنجره‌ی تازه باز می‌کند.
       * `windowsVerbatimArguments` لازم نیست چون execFile خودش نقل‌قول
       * درست را می‌گذارد.
       */
      cmd = 'explorer.exe';
      args = [dir];
      via = 'explorer';
    } else if (platform === 'darwin') {
      cmd = 'open';
      args = [dir];
      via = 'open';
    } else {
      cmd = 'xdg-open';
      args = [dir];
      via = 'xdg-open';
    }
    execFile(cmd, args, { timeout: 5000, windowsHide: false }, (err) => {
      if (!err) {
        resolve({ ok: true, path: dir, via });
        return;
      }
      /*
       * explorer.exe روی ویندوز گاهی با کد ۱ برمی‌گردد در حالی که پنجره
       * باز شده است — این رفتار مستندشده‌ی Explorer است، نه خطای ما.
       * پیام را نمی‌توانیم قطعی بدانیم، پس صادقانه می‌گوییم «باز شد ولی
       * تأیید نشد» و مسیر را می‌دهیم.
       */
      const noOpener = (err as any)?.code === 'ENOENT';
      resolve({
        ok: false,
        path: dir,
        via: noOpener ? 'none' : via,
        message: noOpener
          ? 'برنامه‌ای برای باز کردن پوشه روی این سیستم پیدا نشد. مسیر را دستی باز کنید.'
          : 'فایل‌منیجر پاسخ قطعی نداد. اگر پنجره باز نشد، مسیر را دستی باز کنید.',
      });
    });
  });
}

/** فقط این پوشه‌ها قابل باز کردن‌اند — کلید ثابت، نه مسیر از کلاینت. */
export function isFolderKey(v: unknown): v is FolderKey {
  return v === 'data' || v === 'backups' || v === 'logs';
}
