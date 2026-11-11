/**
 * ریشه‌ی پروژه از روی نشانی فایل جاری.
 *
 * ── چرا این فایل وجود دارد (باگ ویندوزی) ────────────────────────────────
 *
 * الگوی غلطی که در دو فایل تکرار شده بود:
 *
 *     path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
 *
 * روی ویندوز `new URL('file:///C:/Users/DELL/proj/scripts/doctor.mjs').pathname`
 * برابر `/C:/Users/DELL/proj/scripts/doctor.mjs` است — **بدون** حرف درایو به
 * شکل درست (یک اسلش اضافه در ابتدا). `path.win32.resolve` روی چنین مسیری
 * آن را «نسبی» می‌بیند و به پوشه‌ی جاری می‌چسباند؛ نتیجه:
 *
 *     C:\C:\Users\DELL\Documents\GitHub\...\src-tauri\tauri.conf.json  → ENOENT
 *
 * و در نتیجه `npm run doctor` **همیشه** می‌گفت «tauri.conf.json خوانده نشد»
 * و «بسته‌های پروژه نصب نیستند» — حتی روی یک نصب سالم.
 *
 * `fileURLToPath` این کار را درست انجام می‌دهد (روی ویندوز `C:\...`، روی
 * لینوکس/مک `/...`) و مسیرهای شامل فاصله یا حروف فارسی را هم خراب نمی‌کند.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** ریشه‌ی پروژه با `up` سطح بالا رفتن از پوشه‌ی فایل جاری. */
export function projectRoot(metaUrl, up = 1) {
  const dir = path.dirname(fileURLToPath(metaUrl));
  let root = dir;
  for (let i = 0; i < up; i++) root = path.dirname(root);
  return root;
}
